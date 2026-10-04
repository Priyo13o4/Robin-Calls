"""MCP Streamable HTTP surface — the endpoint external agents connect to.

Hand-rolled JSON-RPC rather than a Python MCP SDK, for one reason: the surface
is four methods (`initialize`, `tools/list`, `tools/call`, `ping`) over a
stateless transport where every tool is read-only, and the registry already
produces the JSON Schema that `tools/list` needs. An SDK here would add a
dependency and a session model to serve a switch statement.

Stateless by design — no session store, no Redis. That is what the retired
TypeScript server did too, and it is what makes horizontal scaling and a
restart free.

Parity with that retired server is pinned by
`tests/fixtures/mcp-tools-list.snapshot.json`, captured from the live route
before it was deleted. The rule is *superset*: every tool it exposed still
exists with the same name and the same required inputs. New tools are fine;
a narrowed schema is not, because that breaks a client silently.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .auth import is_internal_caller
from .dispatch import ToolDenied, dispatcher
from .registry import RegistryError
from .settings import settings
from .telemetry import ToolOutcome, TurnDiagnostics, emit
from .trace import trace_id

log = logging.getLogger("agent.mcp")

router = APIRouter()

PROTOCOL_VERSION = "2025-06-18"

# JSON-RPC 2.0 reserved codes.
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


def _result(request_id: Any, result: dict[str, Any]) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})


def _error(request_id: Any, code: int, message: str, status: int = 200) -> JSONResponse:
    # JSON-RPC errors ride a 200 by convention; transport-level refusals
    # (auth) use a real HTTP status instead.
    return JSONResponse(
        {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
        status_code=status,
    )


def _authorized(request: Request) -> bool:
    """Bearer gate — the shared one in `auth.py`.

    Kept as a named function here because it reads as the transport's own
    admission check at the call site, and because this surface's tests target
    it directly.
    """
    return is_internal_caller(request)


def _tool_descriptor(tool: Any) -> dict[str, Any]:
    return {
        "name": tool.name,
        "title": tool.title,
        "description": tool.description,
        "inputSchema": tool.input_schema,
    }


@router.post("/mcp")
async def mcp_endpoint(request: Request) -> JSONResponse:
    if not settings().enable_mcp:
        # A 404, not a 403 — the documented behaviour everywhere this flag is
        # described, and the right one: an operator who has turned the surface
        # off should not be advertising that it exists and is merely closed.
        return JSONResponse({"error": "not found"}, status_code=404)

    if not _authorized(request):
        return JSONResponse(
            {"error": "unauthorized"},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        body = await request.json()
    except Exception:
        return _error(None, PARSE_ERROR, "Request body is not valid JSON.")

    if not isinstance(body, dict) or body.get("jsonrpc") != "2.0":
        return _error(None, INVALID_REQUEST, "Expected a JSON-RPC 2.0 request object.")

    request_id = body.get("id")
    method = body.get("method")
    params = body.get("params") or {}
    reg = dispatcher().registry

    if method == "initialize":
        return _result(
            request_id,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": reg.server_name, "version": reg.server_version},
                "instructions": reg.instructions,
            },
        )

    if method in ("notifications/initialized", "ping"):
        return _result(request_id, {})

    if method == "tools/list":
        # Only tools this transport can actually execute. A client-locale tool
        # with no server read would be listed, called, and fail every time —
        # never advertise a tool the transport cannot run (§7).
        listed = sorted(reg.tools_over("mcp"), key=lambda t: t.name)
        return _result(request_id, {"tools": [_tool_descriptor(t) for t in listed]})

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        if not isinstance(name, str) or not isinstance(args, dict):
            return _error(request_id, INVALID_PARAMS, "`name` and `arguments` are required.")

        started = time.monotonic()
        diag = TurnDiagnostics(surface="mcp", trace_id=trace_id())

        try:
            payload = await dispatcher().call(
                name,
                args,
                trace_id=trace_id(),
                transport="mcp",
                persona=None,
                caller_ip=request.headers.get("x-rc-caller-ip"),
            )
        except (RegistryError, ToolDenied) as exc:
            # Recorded by name only. Which tool an agent asked for is shape;
            # what it asked about is content and never reaches here.
            diag.record_tool(name, "denied")
            _emit(diag, started)
            return _error(request_id, METHOD_NOT_FOUND, str(exc))
        except Exception as exc:  # pragma: no cover - genuinely unexpected
            log.exception("mcp.tool_failed", extra={"tool": name})
            diag.record_tool(name, "failed")
            _emit(diag, started)
            return _error(request_id, INTERNAL_ERROR, f"{name} failed: {exc}")

        diag.record_tool(name, _outcome(payload))
        diag.record_error(payload.get("code"))
        _emit(diag, started)

        # `isError` is the MCP-level signal that the model should treat this as
        # a failed call rather than data. It must track the payload's own `ok`,
        # or an outage arrives looking like a finding.
        failed = payload.get("ok") is False
        return _result(
            request_id,
            {
                "content": [{"type": "text", "text": _json(payload)}],
                "structuredContent": payload,
                "isError": failed,
            },
        )

    return _error(request_id, METHOD_NOT_FOUND, f"Unknown method {method!r}.")


def _json(value: Any) -> str:
    import json

    return json.dumps(value, indent=2, default=str)


def _outcome(payload: dict[str, Any]) -> ToolOutcome:
    if payload.get("ok") is False:
        return "transient" if payload.get("transient") else "failed"
    return "found" if payload.get("found") else "empty"


def _emit(diag: TurnDiagnostics, started: float) -> None:
    diag.duration_ms = int((time.monotonic() - started) * 1000)
    emit(diag)
