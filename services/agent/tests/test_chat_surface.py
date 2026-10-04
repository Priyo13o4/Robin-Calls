"""The chat plane's HTTP surface, driven through the ASGI app.

`/agent/tool` is the one endpoint here that both takes a caller-supplied tool
name and cannot carry a bearer: the caller is a browser holding the *user's*
provider key, not one of ours. Its only real gate is the persona allowlist, so
these tests pin that the gate cannot be skipped by omitting a field — which is
exactly how it was skippable when it was written.

`/agent/config` and `/agent/persona/{name}` are public by design, so what
matters for them is what they refuse to publish: a credentialed RPC URL, and
the internal knowledge collection.
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("INTERNAL_JOB_SECRET", "test-secret")

from app import auth, chat, telemetry  # noqa: E402
from app.dispatch import Dispatcher  # noqa: E402
from app.llm.base import Completion, ToolCall, Usage  # noqa: E402
from app.next_client import NextResult  # noqa: E402
from app.registry import registry  # noqa: E402
from app.settings import Settings  # noqa: E402
from app.trace import TraceMiddleware  # noqa: E402

#: The bearer that marks a caller as us. Set explicitly rather than left unset:
#: with no token configured `is_internal_caller` returns True outside
#: production, so a test suite running on the default settings would treat every
#: anonymous request as internal and the gate tests below would pass vacuously.
INTERNAL_TOKEN = "internal-token-for-tests"
INTERNAL = {"authorization": f"Bearer {INTERNAL_TOKEN}"}


class FakeNext:
    def __init__(self, result: NextResult) -> None:
        self.result = result
        self.reads: list[tuple[str, dict]] = []
        self.scans: list[str] = []

    async def read(self, name, args, trace_id):  # type: ignore[no-untyped-def]
        self.reads.append((name, args))
        return self.result

    async def scan(self, address, trace_id, caller_ip=None):  # type: ignore[no-untyped-def]
        self.scans.append(address)
        return self.result


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    def make(result: NextResult) -> tuple[TestClient, FakeNext]:
        fake = FakeNext(result)
        disp = Dispatcher(registry(), fake)  # type: ignore[arg-type]
        monkeypatch.setattr(chat, "dispatcher", lambda: disp)
        cfg = Settings(  # type: ignore[arg-type]
            INTERNAL_JOB_SECRET="test-secret", MCP_AUTH_TOKEN=INTERNAL_TOKEN
        )
        monkeypatch.setattr(auth, "settings", lambda: cfg)
        app = FastAPI()
        app.add_middleware(TraceMiddleware)
        app.include_router(chat.router)
        return TestClient(app), fake

    return make


def test_a_tool_call_without_a_persona_cannot_reach_the_scanner(client) -> None:
    """The hole: `persona` was optional, and absent meant the allowlist was skipped.

    One anonymous POST from the open internet launched a fresh pipeline, spent a
    receipt against the daily budget, and held up to 180s of RPC.
    """
    c, fake = client(NextResult(ok=True, found=True, value={}))
    response = c.post("/agent/tool", json={"name": "scan_token", "args": {"address": "0x0"}})
    assert response.status_code == 403
    assert fake.scans == [], "the call must not reach Next at all"


def test_a_tool_call_outside_the_persona_allowlist_is_refused(client) -> None:
    c, fake = client(NextResult(ok=True, found=True, value={}))
    response = c.post(
        "/agent/tool",
        json={"name": "scan_token", "args": {"address": "0x0"}, "persona": "interrogator"},
    )
    assert response.status_code == 403
    assert fake.scans == []


def test_a_tool_call_inside_the_allowlist_is_served(client) -> None:
    c, fake = client(NextResult(ok=True, found=True, value={"score": 72}))
    response = c.post(
        "/agent/tool",
        json={"name": "get_verdict", "args": {"id": 7}, "persona": "interrogator"},
    )
    assert response.status_code == 200
    assert response.json()["value"]["score"] == 72
    assert fake.reads == [("get_verdict", {"id": 7})]


def test_the_public_config_publishes_no_credentialed_rpc_url(client) -> None:
    """This response is public. `settings` validates the allowlist for that reason."""
    c, _ = client(NextResult(ok=True, found=True, value={}))
    body = c.get("/agent/config").json()
    assert body["rpc"]["endpoints"]
    for url in body["rpc"]["endpoints"]:
        assert url.startswith("https://")
        assert "?" not in url


def test_an_unknown_persona_is_a_404(client) -> None:
    c, _ = client(NextResult(ok=True, found=True, value={}))
    assert c.get("/agent/persona/not_a_persona").status_code == 404


# ── The internal-persona gate ───────────────────────────────────────────────
#
# `tracer` reconciles the registry against the code seed, which means it answers
# "which venues can this scanner not discover". That is a fix list for us and a
# list of places to hide a pool for everyone else, so every one of these
# surfaces has to refuse it to an anonymous caller — and refuse it the same way,
# as UNKNOWN. Three endpoints that disagree about whether a name exists are an
# enumeration oracle no matter what each one returns.


def test_an_internal_persona_is_invisible_to_a_public_caller(client) -> None:
    c, _ = client(NextResult(ok=True, found=True, value={}))
    names = {p["name"] for p in c.get("/agent/config").json()["personas"]}
    assert "tracer" not in names
    assert "interrogator" in names, "the public personas must still be listed"


def test_an_internal_persona_is_listed_for_an_internal_caller(client) -> None:
    c, _ = client(NextResult(ok=True, found=True, value={}))
    listed = {
        p["name"]: p for p in c.get("/agent/config", headers=INTERNAL).json()["personas"]
    }
    assert listed["tracer"]["internal"] is True
    assert listed["interrogator"]["internal"] is False


def test_an_internal_persona_bundle_is_refused_as_unknown(client) -> None:
    """404, not 403 — a 403 confirms the name to anyone guessing it.

    Both bodies are asserted against the same template with only the requested
    name substituted, so a real persona and an invented one are distinguishable
    by nothing but the string the caller themselves supplied.
    """
    c, _ = client(NextResult(ok=True, found=True, value={}))
    for name in ("tracer", "no_such_persona"):
        response = c.get(f"/agent/persona/{name}")
        assert response.status_code == 404
        assert response.json() == {"error": f"unknown persona {name!r}"}


def test_an_internal_persona_bundle_is_served_to_an_internal_caller(client) -> None:
    c, _ = client(NextResult(ok=True, found=True, value={}))
    body = c.get("/agent/persona/tracer", headers=INTERNAL).json()
    assert body["name"] == "tracer"
    assert {t["name"] for t in body["tools"]} >= {"get_dex_registry", "get_pool_identity"}


def test_an_internal_tool_call_without_the_bearer_never_reaches_next(client) -> None:
    """The gate that matters most: /agent/tool carries no bearer by design.

    Without this check, `{"persona": "tracer"}` in an anonymous POST body would
    have been the whole authorisation story for the blind-spot map.
    """
    c, fake = client(NextResult(ok=True, found=True, value={}))
    response = c.post(
        "/agent/tool", json={"name": "get_dex_registry", "args": {}, "persona": "tracer"}
    )
    assert response.status_code == 404
    assert fake.reads == [], "the read must not run at all"


def test_an_internal_tool_call_with_the_bearer_is_served(client) -> None:
    c, fake = client(NextResult(ok=True, found=True, value={"registryRows": []}))
    response = c.post(
        "/agent/tool",
        json={"name": "get_dex_registry", "args": {}, "persona": "tracer"},
        headers=INTERNAL,
    )
    assert response.status_code == 200
    assert fake.reads == [("get_dex_registry", {})]


def test_an_internal_caller_still_cannot_leave_the_allowlist(client) -> None:
    """The bearer opens the persona, not the toolbox. The tracer never scans."""
    c, fake = client(NextResult(ok=True, found=True, value={}))
    response = c.post(
        "/agent/tool",
        json={"name": "scan_token", "args": {"address": "0x0"}, "persona": "tracer"},
        headers=INTERNAL,
    )
    assert response.status_code == 403
    assert fake.scans == []


def test_the_trace_id_survives_into_a_streaming_body() -> None:
    """A chat turn's log lines are emitted while the SSE body is producing.

    If the context variable were reset once the response *headers* were sent,
    every line for the interesting part of a turn — the model calls, the tool
    dispatches, the citation stripping — would carry `-` instead of the id, and
    tracing would be missing exactly where it exists to help.

    This holds under both the old BaseHTTPMiddleware and the pure-ASGI
    TraceMiddleware that replaced it (both were checked), so it is a guard
    against a botched middleware change rather than a regression test for a
    bug that shipped. The reason for the rewrite is disconnect propagation on
    long SSE streams, which cannot be tested through TestClient.
    """
    from fastapi.responses import StreamingResponse

    from app.trace import trace_id

    app = FastAPI()
    app.add_middleware(TraceMiddleware)

    @app.get("/stream")
    async def stream() -> StreamingResponse:
        async def body():
            # Deliberately read AFTER the response has started, which is where
            # the id used to be gone.
            yield f"during-body:{trace_id()}"

        return StreamingResponse(body(), media_type="text/event-stream")

    with TestClient(app) as c:
        response = c.get("/stream", headers={"x-rc-trace-id": "abc123"})

    assert response.text == "during-body:abc123"
    assert response.headers["x-rc-trace-id"] == "abc123"


# ── The chat stream itself ──────────────────────────────────────────────────
#
# The `tool` frame is what lets the our-models UI show a tool trace at all. On
# the BYOK path the browser dispatches every call itself and already knows what
# ran; here the loop is server-side and a server-locale result never reaches the
# browser, so without this frame the page could only say that *some* tools ran —
# and the trace is the trust surface, the thing that makes deciding whether to
# believe the answer unnecessary.
#
# It carries name, outcome and duration: deliberately the same three fields
# `telemetry` keeps, and deliberately not arguments (which address someone asked
# about is a statement about that person) or results.


class FakeLlm:
    """Scripted rounds. `chat.py` must not care which provider answered."""

    def __init__(self, completions: list[Completion]) -> None:
        self.completions = list(completions)
        self.calls = 0

    async def complete(self, **_kwargs: object) -> Completion:
        self.calls += 1
        return self.completions.pop(0)


def _frames(body: str) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        if not block.strip():
            continue
        event = ""
        data = ""
        for line in block.split("\n"):
            if line.startswith("event: "):
                event = line[len("event: ") :]
            elif line.startswith("data: "):
                data = line[len("data: ") :]
        out.append((event, json.loads(data) if data else {}))
    return out


@pytest.fixture
def chat_client(monkeypatch: pytest.MonkeyPatch):
    def make(result: NextResult, completions: list[Completion]) -> tuple[TestClient, FakeLlm]:
        fake_next = FakeNext(result)
        disp = Dispatcher(registry(), fake_next)
        monkeypatch.setattr(chat, "dispatcher", lambda: disp)

        # A key plus a non-production env: `our_models_enabled` needs the key,
        # and production would (correctly) refuse to boot with one while
        # METERING_IMPLEMENTED is False.
        cfg = Settings(  # type: ignore[arg-type]
            INTERNAL_JOB_SECRET="test-secret",
            MCP_AUTH_TOKEN=INTERNAL_TOKEN,
            GEMINI_API_KEY="test-model-key",
            AGENT_ENV="development",
        )
        monkeypatch.setattr(chat, "settings", lambda: cfg)
        monkeypatch.setattr(auth, "settings", lambda: cfg)

        fake_llm = FakeLlm(completions)
        monkeypatch.setattr(chat, "llm", lambda: fake_llm)

        app = FastAPI()
        app.add_middleware(TraceMiddleware)
        app.include_router(chat.router)
        return TestClient(app), fake_llm

    return make


def _asked(name: str = "get_latest_verdict") -> Completion:
    return Completion(
        text="",
        tool_calls=[ToolCall(id="toolu_1", name=name, args={"address": "0x" + "a" * 40})],
        stop_reason="tool_use",
        usage=Usage(input_tokens=2700, output_tokens=12),
    )


def _answered(text: str) -> Completion:
    return Completion(
        text=text,
        tool_calls=[],
        stop_reason="end_turn",
        usage=Usage(input_tokens=2900, output_tokens=40),
    )


def test_every_tool_call_is_reported_by_name_outcome_and_duration(chat_client) -> None:
    c, _ = chat_client(
        NextResult(ok=True, found=True, value={"id": 4187, "score": 91}),
        [_asked(), _answered("The score is 91.")],
    )

    response = c.post(
        "/agent/chat",
        json={"persona": "interrogator", "messages": [{"role": "user", "content": "why?"}]},
    )
    assert response.status_code == 200

    tools = [payload for event, payload in _frames(response.text) if event == "tool"]
    assert len(tools) == 1
    assert tools[0]["name"] == "get_latest_verdict"
    assert tools[0]["outcome"] == "found"
    assert tools[0]["locale"] == "server"
    assert tools[0]["id"] == "toolu_1"
    assert isinstance(tools[0]["durationMs"], int)


def test_the_trace_frame_carries_no_arguments_and_no_result(chat_client) -> None:
    """Shape, never content — the same rule `telemetry._assert_clean` enforces.

    A tool argument IS content: which address someone asked about is a statement
    about that person. The result body can also be large, and on this path it is
    the server's to hold.
    """
    c, _ = chat_client(
        NextResult(
            ok=True, found=True, value={"id": 4187, "secret_looking_value": "0x" + "b" * 40}
        ),
        [_asked(), _answered("Read.")],
    )

    response = c.post(
        "/agent/chat",
        json={"persona": "interrogator", "messages": [{"role": "user", "content": "why?"}]},
    )

    tools = [payload for event, payload in _frames(response.text) if event == "tool"]
    assert set(tools[0]) == {"id", "name", "locale", "outcome", "durationMs"}
    assert "0x" not in json.dumps(tools[0])


def test_an_empty_read_is_reported_as_empty_not_as_found(chat_client) -> None:
    """`found: false` must survive to the UI as its own word.

    "Nothing on record" is not an all-clear, and a trace row that rendered it as
    OK would put a green tick on the absence of a file.
    """
    c, _ = chat_client(
        NextResult(ok=True, found=False),
        [_asked("lookup_deployer"), _answered("There is no file on this deployer.")],
    )

    response = c.post(
        "/agent/chat",
        json={"persona": "interrogator", "messages": [{"role": "user", "content": "who?"}]},
    )

    tools = [payload for event, payload in _frames(response.text) if event == "tool"]
    assert tools[0]["outcome"] == "empty"


def test_a_transient_fault_is_reported_as_transient_and_unbills_the_turn(chat_client) -> None:
    c, _ = chat_client(
        NextResult(
            ok=False,
            transient=True,
            error="upstream timed out",
            code="RC_AGENT_UPSTREAM_TIMEOUT",
        ),
        [_asked(), _answered("The lookup did not complete.")],
    )

    response = c.post(
        "/agent/chat",
        json={"persona": "interrogator", "messages": [{"role": "user", "content": "why?"}]},
    )
    frames = _frames(response.text)

    tools = [payload for event, payload in frames if event == "tool"]
    assert tools[0]["outcome"] == "transient"

    message = next(payload for event, payload in frames if event == "message")
    assert message["billable"] is False, "the user must not pay for our outage"


def test_a_turn_abandoned_mid_stream_is_still_recorded(chat_client, monkeypatch) -> None:
    """Closing the tab must not delete the turn from the diagnostics.

    Measured against the live stack on 2026-08-03 (Q8): a client disconnect DOES
    propagate — the second model round never happens, which is the outcome the
    finding hoped for — but the generator is cancelled at a `yield`, so no
    terminal branch runs and the turn produced no record at all. Those are the
    turns worth counting: round one's input tokens were already spent, and a
    rise in them is what "users are giving up on the latency" looks like from
    outside.

    Simulated here by closing the generator, which is exactly what Starlette
    does to a streaming body when the client goes away.
    """
    emitted: list[dict] = []
    monkeypatch.setattr(telemetry, "_SINK", emitted.append, raising=False)

    c, _ = chat_client(
        NextResult(ok=True, found=True, value={"id": 4187}),
        [_asked(), _answered("Never delivered.")],
    )

    async def drive() -> None:
        request = chat.ChatRequest(
            persona="interrogator", messages=[{"role": "user", "content": "why?"}]
        )
        stream = chat._run_turn(request, caller_ip=None)
        # Take the first frame, then walk away — the tab is gone.
        await stream.__anext__()
        await stream.aclose()

    asyncio.run(drive())

    assert len(emitted) == 1, "an abandoned turn must still produce exactly one line"
    assert emitted[0]["abandoned"] is True
    assert emitted[0]["billable"] is False, "nothing usable reached the user"


def test_a_completed_turn_is_not_marked_abandoned(chat_client, monkeypatch) -> None:
    emitted: list[dict] = []
    monkeypatch.setattr(telemetry, "_SINK", emitted.append, raising=False)

    c, _ = chat_client(
        NextResult(ok=True, found=True, value={"id": 4187, "score": 91}),
        [_asked(), _answered("The score is 91.")],
    )
    c.post(
        "/agent/chat",
        json={"persona": "interrogator", "messages": [{"role": "user", "content": "why?"}]},
    )

    assert len(emitted) == 1, "exactly one line per turn, not one per terminal branch"
    assert emitted[0]["abandoned"] is False
    assert emitted[0]["billable"] is True
