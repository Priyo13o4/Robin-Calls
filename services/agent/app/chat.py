"""The chat surface — SSE, the agent loop, and the client-tool round-trip.

Two modes share this file, and only one of them runs a model here:

- **our-models** — we hold the key, we run the loop, we meter it.
- **BYOK** — the browser calls the user's own provider directly, so the loop
  runs *there*. This process still serves the pieces the browser needs to do
  that: the persona prompt, the knowledge block, the tool specs, and the
  server-locale tool execution. The user's key never touches us, which is the
  whole point and also means we get no server-side visibility into that
  traffic (an accepted, documented trade).

## The client round-trip

When the model asks for a client-locale tool, we do not execute it. We stream
`client_tool_call` and stop. The browser runs it via viem against a public
endpoint, POSTs the result back with a provenance envelope, and the loop
resumes. Free-tier chat therefore costs us no RPC budget at all — which is what
makes a free tier viable and gives the paid tier (failover, circuit breakers,
CU limiting, deadline preservation) something real to sell.

Conversation state lives in the request. The continuation POST carries the
transcript back, so this process stays stateless and a restart mid-conversation
costs nothing. Durable conversations are a later concern with their own table.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import codes
from .auth import is_internal_caller
from .citations import Citations, validate
from .client_bridge import client_config
from .dispatch import ClientExecutionRequired, ToolDenied, TurnBudget, dispatcher
from .history import trim
from .knowledge import knowledge
from .llm import ModelUnavailable, llm
from .registry import RegistryError
from .settings import settings
from .telemetry import ToolOutcome, TurnDiagnostics, emit
from .trace import trace_id

log = logging.getLogger("agent.chat")

router = APIRouter()


class ClientToolResult(BaseModel):
    tool_use_id: str
    name: str
    #: `{value, provenance}` — a bare value is refused (see client_bridge).
    result: Any = None
    error: str | None = None


class ChatRequest(BaseModel):
    persona: str = "interrogator"
    messages: list[dict[str, Any]] = Field(default_factory=list)
    #: Results the browser computed for a previous `client_tool_call`.
    client_results: list[ClientToolResult] = Field(default_factory=list)
    #: The head this process believes the chain is at, used for the staleness
    #: check on client results. Absent = staleness unverifiable, not "fresh".
    head_block: int | None = None
    #: False for MCP-less headless callers; true from a browser with executors.
    client_tools_available: bool = True


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@router.get("/agent/config")
async def agent_config(request: Request) -> JSONResponse:
    """What a browser needs to run either mode.

    Endpoints only — never a credentialed RPC URL. `settings` validates the
    allowlist at load time for exactly this reason: this response is public.

    Internal personas are listed only for a caller that proved it is us. To a
    public caller they do not appear to exist at all, which is the same story
    `/agent/persona/{name}` and the dispatcher tell — three surfaces that
    disagree about whether a name exists is itself the enumeration oracle.
    """
    reg = dispatcher().registry
    internal = is_internal_caller(request)
    return JSONResponse(
        {
            "promptVersion": settings().prompt_version,
            "ourModelsEnabled": settings().our_models_enabled,
            "maxToolCallsPerTurn": settings().max_tool_calls_per_turn,
            "maxFreeToolCallsPerTurn": settings().max_free_tool_calls_per_turn,
            "rpc": client_config(),
            "personas": [
                {
                    "name": p.name,
                    "title": p.title,
                    "internal": p.is_internal,
                    "tools": sorted(p.allowed_tools),
                }
                for p in reg.personas.values()
                if internal or not p.is_internal
            ],
        }
    )


@router.get("/agent/persona/{name}")
async def persona_bundle(name: str, request: Request) -> JSONResponse:
    """Everything the BYOK browser loop needs to build its own request.

    An internal persona is served only to an authenticated caller, and refused
    as *unknown* rather than forbidden otherwise. These personas carry our
    incident history and our unpatched-bug list — `tracer`'s prompt names the
    outages its procedure exists to catch — and a 403 here would confirm the
    name to anyone guessing.
    """
    reg = dispatcher().registry
    persona = reg.personas.get(name)
    if persona is None or (persona.is_internal and not is_internal_caller(request)):
        return JSONResponse({"error": f"unknown persona {name!r}"}, status_code=404)

    return JSONResponse(
        {
            "name": persona.name,
            "title": persona.title,
            "promptVersion": settings().prompt_version,
            "system": [
                {"text": knowledge().core, "cacheable": True},
                {"text": persona.prompt, "cacheable": False},
            ],
            "tools": [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                    "locale": t.locale,
                }
                for t in reg.tools_for(persona.name)
            ],
        }
    )


@router.post("/agent/tool")
async def call_tool(request: Request) -> JSONResponse:
    """Server-locale tool execution for the BYOK loop.

    BYOK runs the model in the browser, but a browser cannot reach the database
    or our RPC pool — and must not, since that would mean shipping the internal
    secret to the client. So the browser's loop calls back here for
    server-locale tools only, and the persona allowlist is enforced on this
    side where it cannot be edited.

    This endpoint carries no bearer and cannot: the caller is a browser holding
    the *user's* provider key, not one of ours. So `persona` is mandatory —
    without it the dispatcher's allowlist would be skipped entirely and every
    tool, `scan_token` included, would be one anonymous POST away. What bounds
    it is the persona allowlist, the per-IP fresh-scan budget on the Next side
    (which is why `x-rc-caller-ip` must be nginx-set, not caller-set), and the
    edge rate limit. There is no per-turn budget here because there is no turn:
    each POST is one call, and the browser owns the loop.
    """
    body = await request.json()
    name = body.get("name")
    args = body.get("args") or {}
    persona = body.get("persona")

    if not isinstance(name, str) or not isinstance(args, dict):
        return JSONResponse({"error": "`name` and `args` are required."}, status_code=400)
    if not isinstance(persona, str) or not persona:
        return JSONResponse(
            {"error": "`persona` is required.", "code": codes.TOOL_DENIED},
            status_code=403,
        )

    try:
        payload = await dispatcher().call(
            name,
            args,
            trace_id=trace_id(),
            transport="chat",
            persona=persona,
            caller_ip=request.headers.get("x-rc-caller-ip"),
            # BYOK's browser runs client-locale tools itself; anything reaching
            # this endpoint is being asked of the server on purpose.
            client_available=False,
            internal_ok=is_internal_caller(request),
        )
    except ToolDenied as exc:
        return JSONResponse({"error": str(exc)}, status_code=403)
    except RegistryError as exc:
        return JSONResponse({"error": str(exc)}, status_code=404)

    return JSONResponse(payload)


@router.post("/agent/chat")
async def chat(request: Request, body: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        _run_turn(
            body,
            caller_ip=request.headers.get("x-rc-caller-ip"),
            internal_ok=is_internal_caller(request),
        ),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-store",
            # nginx buffers proxied responses by default, which would hold the
            # whole stream until the turn ended — the same failure /api/scan
            # already documents. Belt and braces with the nginx config.
            "x-accel-buffering": "no",
        },
    )


async def _run_turn(
    body: ChatRequest, *, caller_ip: str | None, internal_ok: bool = False
) -> AsyncIterator[str]:
    tid = trace_id()
    cfg = settings()
    disp = dispatcher()

    try:
        persona = disp.registry.personas[body.persona]
    except KeyError:
        yield _sse("error", {"error": f"unknown persona {body.persona!r}"})
        return
    # Identical wording to the KeyError above, on purpose: an internal persona
    # must be indistinguishable from one that does not exist.
    if persona.is_internal and not internal_ok:
        yield _sse("error", {"error": f"unknown persona {body.persona!r}"})
        return

    if not cfg.our_models_enabled:
        yield _sse(
            "error",
            {
                "error": (
                    "Our-models chat is not configured on this deployment. "
                    "Connect your own provider key to use the agent."
                ),
                "code": codes.MODEL_UNAVAILABLE,
            },
        )
        return

    started = time.monotonic()
    diag = TurnDiagnostics(
        surface="chat",
        persona=persona.name,
        prompt_version=cfg.prompt_version,
        model=cfg.model,
        trace_id=tid,
    )

    budget = TurnBudget(
        max_tool_calls=cfg.max_tool_calls_per_turn,
        max_free_calls=cfg.max_free_tool_calls_per_turn,
    )

    # A disconnect is a terminal path too, and it was the one path that recorded
    # nothing. Measured 2026-08-03 while closing Q8: dropping the client
    # mid-turn DOES propagate — the next model round never runs, which is the
    # good outcome — but the generator is cancelled at a `yield`, so every
    # branch below is skipped and the turn vanished from diagnostics entirely,
    # after round one's input tokens had already been spent. `_finish`'s own
    # docstring names this failure: a turn recorded only when it succeeds
    # produces statistics that say everything is fine.
    settled = False

    def settle(*, abandoned: bool = False) -> None:
        nonlocal settled
        if settled:
            return
        settled = True
        diag.abandoned = abandoned
        if abandoned:
            # Nothing usable reached the user, so nothing is chargeable.
            diag.billable = False
        _finish(diag, budget, started)

    try:
        citations = Citations()
        tools = disp.registry.tools_for(persona.name)

        # Bound the transcript before anything else touches it. Left unbounded it
        # grows every turn until the model call fails outright on context length —
        # mid-conversation, after the user has invested a session, and not better
        # on retry. Trimming cuts only at turn boundaries so a `tool_use` is never
        # separated from its `tool_result` (see history.py).
        history = trim(list(body.messages), cfg.max_history_tokens)
        messages = history.messages

        # Fold in any client-computed results from the previous round before
        # resuming. Each one is verified before the model can see it.
        if body.client_results:
            blocks: list[dict[str, Any]] = []
            for item in body.client_results:
                if item.error:
                    payload: dict[str, Any] = {
                        "ok": False,
                        "error": item.error,
                        "code": codes.CLIENT_TOOL_FAILED,
                        # The browser's own RPC failing is an outage from the
                        # model's point of view: retryable, and not a finding.
                        "transient": True,
                    }
                    budget.transient_faults += 1
                else:
                    payload = disp.accept_client_result(
                        disp.registry.tool(item.name), item.result, head_block=body.head_block
                    )
                    reason = payload.get("reason")
                    if reason:
                        diag.record_provenance_rejection(reason)
                citations.add_result(payload)
                blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": item.tool_use_id,
                        "content": json.dumps(payload, default=str),
                        "is_error": payload.get("ok") is False,
                    }
                )
            messages.append({"role": "user", "content": blocks})

        yield _sse("start", {"traceId": tid, "persona": persona.name})

        diag.history_dropped = history.dropped

        if history.was_trimmed:
            # Never silent: the page still shows history the model was not given,
            # and an unexplained divergence reads to the user as the agent
            # forgetting things at random.
            yield _sse(
                "notice",
                {
                    "code": codes.HISTORY_TRIMMED,
                    "message": (
                        f"This conversation got long, so the {history.dropped} oldest "
                        "messages were left out of this answer."
                    ),
                    "droppedMessages": history.dropped,
                },
            )

        while True:
            try:
                completion = await llm().complete(
                    messages=messages,
                    static_prose=knowledge().core,
                    persona_prompt=persona.prompt,
                    tools=tools,
                )
            except ModelUnavailable as exc:
                diag.record_error(codes.MODEL_UNAVAILABLE)
                settle()
                yield _sse("error", {"error": str(exc), "code": codes.MODEL_UNAVAILABLE})
                return
            except Exception as exc:  # pragma: no cover - provider-side failure
                log.exception("chat.model_failed")
                diag.record_error(codes.MODEL_FAILED)
                diag.billable = False  # nothing usable was produced
                settle()
                yield _sse(
                    "error",
                    {
                        "error": "The model call failed. Nothing was charged for this turn.",
                        "code": codes.MODEL_FAILED,
                        # The class name, not just str(exc). Several exceptions
                        # worth telling apart stringify to nothing at all —
                        # httpx.ReadTimeout among them — so `str(exc)` alone
                        # produced `"detail": ""` and an operator was left with
                        # "the model call failed" and no cause whatsoever.
                        "detail": f"{type(exc).__name__}: {exc}".strip(": "),
                    },
                )
                return

            diag.model_rounds += 1
            diag.input_tokens += completion.usage.input_tokens
            diag.output_tokens += completion.usage.output_tokens
            diag.cache_read_tokens += completion.usage.cache_read_tokens
            diag.cache_write_tokens += completion.usage.cache_write_tokens

            yield _sse(
                "usage",
                {
                    "inputTokens": completion.usage.input_tokens,
                    "outputTokens": completion.usage.output_tokens,
                    "cacheReadTokens": completion.usage.cache_read_tokens,
                    "cacheWriteTokens": completion.usage.cache_write_tokens,
                },
            )

            if not completion.tool_calls:
                checked = validate(completion.text, citations)
                if checked.stripped:
                    # Never silent. A stripped sentence means the model invented a
                    # number, and that is worth seeing in the logs even though the
                    # user is protected from it.
                    log.warning(
                        "chat.citation_stripped",
                        extra={"trace_id": tid, "count": len(checked.stripped)},
                    )
                diag.stripped_claims = len(checked.stripped)
                settle()

                yield _sse(
                    "message",
                    {
                        "text": checked.text,
                        "strippedClaims": len(checked.stripped),
                        # Metering reads this. A turn whose tools faulted
                        # transiently is not billable: the user paid input tokens
                        # for an answer our infrastructure failed to supply.
                        "billable": budget.billable,
                        "toolCalls": budget.calls_made,
                    },
                )
                yield _sse("done", {"traceId": tid})
                return

            messages.append({"role": "assistant", "content": _assistant_blocks(completion)})

            results: list[dict[str, Any]] = []
            pending_client: list[dict[str, Any]] = []

            for call in completion.tool_calls:
                call_started = time.monotonic()
                try:
                    payload = await disp.call(
                        call.name,
                        call.args,
                        trace_id=tid,
                        transport="chat",
                        persona=persona.name,
                        budget=budget,
                        caller_ip=caller_ip,
                        call_id=call.id,
                        client_available=body.client_tools_available,
                        internal_ok=internal_ok,
                    )
                except ClientExecutionRequired as need:
                    pending_client.append(
                        {"id": need.call_id, "name": need.tool.name, "args": need.tool_args}
                    )
                    continue
                except ToolDenied as exc:
                    # The allowlist held. Tell the model plainly rather than
                    # failing the turn — it can usually answer another way.
                    payload = {"ok": False, "error": str(exc), "code": codes.TOOL_DENIED,
                               "transient": False}
                except RegistryError as exc:
                    payload = {"ok": False, "error": str(exc), "code": codes.UNKNOWN_TOOL,
                               "transient": False}

                outcome = _outcome(payload)
                diag.record_tool(call.name, outcome)
                diag.record_error(payload.get("code"))

                # The trace is the trust surface: being able to watch the agent read
                # the ledger is what makes it unnecessary to decide whether to
                # believe it. On the BYOK path the browser dispatches every call
                # itself and already knows all of this; on this path a server-locale
                # result never reaches the browser at all, so without this frame the
                # our-models UI could only show that *some* tools ran.
                #
                # Name, outcome and duration only — deliberately the same three
                # fields `telemetry` keeps. Arguments are content (which address
                # someone asked about is a statement about that person) and results
                # can be large; neither is needed to show that a read happened.
                yield _sse(
                    "tool",
                    {
                        "id": call.id,
                        "name": call.name,
                        "locale": _locale_of(disp, call.name),
                        "outcome": outcome,
                        "durationMs": int((time.monotonic() - call_started) * 1000),
                    },
                )

                citations.add_result(payload)
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": call.id,
                        "content": json.dumps(payload, default=str),
                        "is_error": payload.get("ok") is False,
                    }
                )

            if pending_client:
                # Hand the loop to the browser. It POSTs back with results and the
                # transcript, and we resume from there — which is why the messages
                # so far go out with it.
                yield _sse(
                    "client_tool_call",
                    {
                        "calls": pending_client,
                        "messages": messages,
                        "rpc": client_config(),
                        "persona": persona.name,
                    },
                )
                settle()
                yield _sse("await_client", {"traceId": tid})
                return

            messages.append({"role": "user", "content": results})

            # BOTH counters, because either one being spent ends the turn: the
            # model cannot make progress once the reads it needs are refused,
            # and looping to discover that costs another completion.
            if budget.exhausted("server") or budget.exhausted("client"):
                diag.budget_exhausted = True
                spent = "server" if budget.exhausted("server") else "browser"
                # Force a final answer rather than looping. The cap is a real
                # ceiling: each iteration spends credits and RPC budget.
                yield _sse(
                    "notice",
                    {
                        "message": (
                            f"Tool-call limit ({budget.limit_for(spent)}) reached "
                            f"for {spent} reads."
                        )
                    },
                )
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "You have reached this turn's tool-call limit. Answer with "
                            "what you already have, and say plainly what you could not "
                            "check rather than implying it was fine."
                        ),
                    }
                )
                tools = []
    finally:
        # On a normal return `settled` is already True and this is a no-op.
        settle(abandoned=True)



def _assistant_blocks(completion: Any) -> list[dict[str, Any]]:
    """The canonical (Anthropic-shaped) transcript blocks for one model turn.

    `signature` is the one non-Anthropic key, and it is carried here rather
    than inside the provider client because the transcript round-trips through
    the browser between turns — provider-side state that is not in the
    transcript does not survive the round trip. It is opaque continuation state
    (Gemini's `thoughtSignature`); `AnthropicClient` strips it on the way out,
    so a transcript stays portable if the provider is switched.
    """
    blocks: list[dict[str, Any]] = []
    if completion.text:
        blocks.append({"type": "text", "text": completion.text})
    for call in completion.tool_calls:
        block: dict[str, Any] = {
            "type": "tool_use",
            "id": call.id,
            "name": call.name,
            "input": call.args,
        }
        if getattr(call, "signature", None):
            block["signature"] = call.signature
        blocks.append(block)
    return blocks


def _locale_of(disp: Any, name: str) -> str:
    """The tool's locale, for the trace frame. Never raises.

    A call that was denied or unknown has no tool to look up, and the trace row
    still has to render — an exception here would kill a turn that otherwise
    answered fine, to decorate one row.
    """
    try:
        return disp.registry.tool(name).locale
    except Exception:
        return "server"


def _outcome(payload: dict[str, Any]) -> ToolOutcome:
    """Classify one tool result for diagnostics — shape only, never content."""
    if payload.get("ok") is False:
        if payload.get("code") == codes.TOOL_DENIED:
            return "denied"
        return "transient" if payload.get("transient") else "failed"
    return "found" if payload.get("found") else "empty"


def _finish(diag: TurnDiagnostics, budget: TurnBudget, started: float) -> None:
    """Stamp the turn and emit exactly one diagnostics line.

    Called on every terminal path — answered, failed, or handed to the browser —
    because a turn that only gets recorded when it succeeds produces statistics
    that say everything is fine.
    """
    diag.transient_faults = budget.transient_faults
    diag.billable = diag.billable and budget.billable
    diag.duration_ms = int((time.monotonic() - started) * 1000)
    emit(diag)
