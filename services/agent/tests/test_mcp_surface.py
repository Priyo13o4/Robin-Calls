"""The MCP wire surface, driven end to end through the ASGI app.

Parity with the retired TypeScript server is checked at the registry level in
test_registry.py; this file checks the transport around it — that a real client
speaking JSON-RPC gets what the protocol says it should, and that a failed tool
call is labelled as failed rather than handed over as data.
"""

from __future__ import annotations

import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("INTERNAL_JOB_SECRET", "test-secret")

from app import auth, mcp  # noqa: E402
from app.dispatch import Dispatcher  # noqa: E402
from app.next_client import NextResult  # noqa: E402
from app.registry import registry  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.trace import TraceMiddleware  # noqa: E402


class FakeNext:
    def __init__(self, result: NextResult) -> None:
        self.result = result

    async def read(self, name, args, trace_id):  # type: ignore[no-untyped-def]
        return self.result

    async def scan(self, address, trace_id, caller_ip=None):  # type: ignore[no-untyped-def]
        return self.result


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    """An app whose only outside dependency is stubbed.

    ENABLE_MCP is forced on here: the flag defaults off (K1 is open), so
    without this every test below would be asserting against a 404 and the
    whole file would pass while checking nothing. The flag itself is covered
    by its own tests.
    """

    def make(result: NextResult, **overrides: object) -> TestClient:
        disp = Dispatcher(registry(), FakeNext(result))  # type: ignore[arg-type]
        monkeypatch.setattr(mcp, "dispatcher", lambda: disp)
        fields: dict[str, object] = {"INTERNAL_JOB_SECRET": "test-secret", "ENABLE_MCP": True}
        fields.update(overrides)
        cfg = Settings(**fields)  # type: ignore[arg-type]
        monkeypatch.setattr(mcp, "settings", lambda: cfg)
        # The bearer check moved to `auth`, which reads its own module-level
        # `settings`. Patching only `mcp.settings` left the gate reading the
        # real environment — where no token is set and the process is not
        # production, so `is_internal_caller` returned True and every auth
        # assertion in this file silently stopped testing anything.
        monkeypatch.setattr(auth, "settings", lambda: cfg)
        app = FastAPI()
        app.add_middleware(TraceMiddleware)
        app.include_router(mcp.router)
        return TestClient(app)

    return make


def rpc(c: TestClient, method: str, params: dict | None = None) -> dict:
    return c.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
    ).json()


def test_initialize_advertises_the_protocol_and_server(client) -> None:
    body = rpc(client(NextResult(ok=True, found=True, value={})), "initialize")
    result = body["result"]
    assert result["protocolVersion"] == mcp.PROTOCOL_VERSION
    assert result["serverInfo"]["name"] == "robincalls"
    assert "chain id 4663" in result["instructions"]


def test_tools_list_returns_json_schema_per_tool(client) -> None:
    body = rpc(client(NextResult(ok=True, found=True, value={})), "tools/list")
    tools = {t["name"]: t for t in body["result"]["tools"]}
    assert "scan_token" in tools
    schema = tools["scan_token"]["inputSchema"]
    assert schema["type"] == "object"
    assert schema["required"] == ["address"]
    assert schema["properties"]["address"]["pattern"].startswith("^0x")


def test_a_successful_call_returns_content_and_structured_content(client) -> None:
    c = client(NextResult(ok=True, found=True, value={"score": 72}))
    body = rpc(c, "tools/call", {"name": "get_verdict", "arguments": {"id": 7}})
    result = body["result"]
    assert result["isError"] is False
    assert result["structuredContent"]["value"]["score"] == 72
    assert result["content"][0]["type"] == "text"


def test_a_transient_upstream_failure_is_flagged_as_an_error(client) -> None:
    """`isError` must track the payload, or an outage arrives looking like data."""
    c = client(NextResult(ok=False, transient=True, error="timed out", code="RC_X"))
    body = rpc(c, "tools/call", {"name": "get_verdict", "arguments": {"id": 7}})
    assert body["result"]["isError"] is True
    assert body["result"]["structuredContent"]["transient"] is True


def test_an_empty_record_is_a_success_not_an_error(client) -> None:
    """Nothing on record is a real answer; the note is what stops it reading as clean."""
    c = client(NextResult(ok=True, found=False, value=None))
    args = {"address": "0x" + "a" * 40}
    body = rpc(c, "tools/call", {"name": "lookup_deployer", "arguments": args})
    assert body["result"]["isError"] is False
    assert body["result"]["structuredContent"]["found"] is False


def test_an_unknown_tool_is_a_jsonrpc_error(client) -> None:
    body = rpc(client(NextResult(ok=True, found=True, value={})), "tools/call", {"name": "nope"})
    assert body["error"]["code"] == mcp.METHOD_NOT_FOUND


def test_an_unknown_method_is_a_jsonrpc_error(client) -> None:
    body = rpc(client(NextResult(ok=True, found=True, value={})), "resources/list")
    assert body["error"]["code"] == mcp.METHOD_NOT_FOUND


def test_a_non_jsonrpc_body_is_rejected(client) -> None:
    c = client(NextResult(ok=True, found=True, value={}))
    assert c.post("/mcp", json={"hello": "world"}).json()["error"]["code"] == mcp.INVALID_REQUEST


def test_the_trace_id_comes_back_on_the_response(client) -> None:
    c = client(NextResult(ok=True, found=True, value={}))
    response = c.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"x-rc-trace-id": "abc123"},
    )
    assert response.headers["x-rc-trace-id"] == "abc123"


def test_a_hostile_trace_id_is_replaced_rather_than_echoed(client) -> None:
    """It ends up in log lines; an unbounded caller-supplied value is injection."""
    c = client(NextResult(ok=True, found=True, value={}))
    response = c.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"x-rc-trace-id": "a\nFAKE LOG LINE"},
    )
    assert response.headers["x-rc-trace-id"] != "a\nFAKE LOG LINE"


def test_the_bearer_gate_rejects_a_wrong_token(client) -> None:
    c = client(NextResult(ok=True, found=True, value={}), MCP_AUTH_TOKEN="right")
    assert c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"}).status_code == 401
    ok = c.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"authorization": "Bearer right"},
    )
    assert ok.status_code == 200


def test_the_kill_switch_actually_closes_the_surface(client) -> None:
    """ENABLE_MCP is documented as "off → 404" in four places at once.

    For one release it was true in none of them: nothing read the flag, so the
    admin capacity dashboard rendered "MCP server: off" while the endpoint
    served the internet, and an operator who flipped it and redeployed got the
    tile they expected and no change at all. A control nobody implemented is
    worse than no control, because someone is relying on it.
    """
    c = client(NextResult(ok=True, found=True, value={}), ENABLE_MCP=False)
    response = c.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert response.status_code == 404


def test_the_kill_switch_closes_the_surface_before_the_bearer_gate(client) -> None:
    """A disabled surface must not advertise that it exists and is merely shut."""
    c = client(NextResult(ok=True, found=True, value={}), ENABLE_MCP=False, MCP_AUTH_TOKEN="right")
    response = c.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        headers={"authorization": "Bearer right"},
    )
    assert response.status_code == 404


def test_the_flag_defaults_to_off() -> None:
    """Absent means closed. K1 — no per-caller identity, quota or revocation."""
    assert Settings(INTERNAL_JOB_SECRET="s").enable_mcp is False
