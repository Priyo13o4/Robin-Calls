"""The Gemini provider — translation in, translation out, offline.

Every test here drives a stub `httpx.AsyncClient` transport, so nothing needs a
key or a network. What is being pinned is the *translation*: the canonical
message shape above `llm.py` is Anthropic's, and a Gemini turn is only correct
if it survives the round trip through a wire format that names things
differently, keys tool results by name instead of id, and rejects two JSON
Schema keywords that appear in every schema this registry generates.

`lib/agent/providers.ts` performs the same translation in the browser for BYOK.
The two are deliberately separate implementations of one documented shape — if
they drift, the same conversation behaves differently depending on whose key
paid for it.
"""

from __future__ import annotations

import json
import os

import httpx
import pytest

os.environ.setdefault("INTERNAL_JOB_SECRET", "test-secret")

from app import llm as llm_module  # noqa: E402
from app.llm import Completion, GeminiClient, ModelUnavailable, ToolCall, Usage  # noqa: E402
from app.llm.anthropic import _strip_foreign_keys  # noqa: E402
from app.llm.gemini import (  # noqa: E402
    _from_gemini,
    _gemini_contents,
    _gemini_schema,
    _gemini_tools,
    _merge_gemini,
)
from app.registry import registry  # noqa: E402
from app.settings import DEFAULT_MODELS, Settings  # noqa: E402


def stub(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def client_for(handler, **overrides) -> GeminiClient:
    fields: dict[str, object] = {
        "INTERNAL_JOB_SECRET": "test-secret",
        "GEMINI_API_KEY": "test-key",
        "AGENT_PROVIDER": "gemini",
    }
    fields.update(overrides)
    c = GeminiClient(stub(handler))
    c._cfg = Settings(**fields)  # type: ignore[arg-type]
    return c


def reply(parts: list[dict], usage: dict | None = None, finish: str = "STOP") -> dict:
    return {
        "candidates": [{"content": {"role": "model", "parts": parts}, "finishReason": finish}],
        "usageMetadata": usage or {"promptTokenCount": 10, "candidatesTokenCount": 5},
    }


# ── Schema sanitisation ─────────────────────────────────────────────────────


def test_the_two_keywords_gemini_rejects_are_stripped_from_every_real_schema() -> None:
    """`additionalProperties` and `pattern` are in every schema we generate.

    Sent as-is, *every* tool call 400s — and the error names the schema, not the
    tool, so the failure reads like a Gemini outage rather than our bug.
    """
    for tool in registry().tools.values():
        rendered = json.dumps(_gemini_schema(tool.input_schema) or {})
        assert "additionalProperties" not in rendered, tool.name
        assert '"pattern"' not in rendered, tool.name


def test_an_address_pattern_survives_as_prose() -> None:
    """Stripped from the schema, kept where the model still reads it.

    The regex was never the enforcement — `lib/internal/reads.ts` revalidates
    every address and rejects a bad one with a 400 — so losing it costs
    guidance, not safety. Losing it silently would cost accuracy.
    """
    schema = _gemini_schema(registry().tools["get_latest_verdict"].input_schema)
    assert schema is not None
    assert "0x" in schema["properties"]["address"]["description"]


def test_a_no_argument_tool_sends_no_parameters_key() -> None:
    """Gemini wants `parameters` omitted, not an empty object."""
    assert _gemini_schema(registry().tools["get_methodology"].input_schema) is None
    declared = _gemini_tools([registry().tools["get_methodology"]])[0]["functionDeclarations"]
    assert "parameters" not in declared[0]


# ── Transcript translation ──────────────────────────────────────────────────


def test_a_tool_result_is_rekeyed_from_id_to_name() -> None:
    """Gemini's functionResponse carries no call id — only a name.

    The name has to be recovered from the earlier `tool_use` block in the same
    transcript. Get this wrong and the model receives a result labelled with
    the wrong tool, which is worse than no result at all.
    """
    contents = _gemini_contents(
        [
            {"role": "user", "content": "check it"},
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "abc", "name": "get_verdict", "input": {"id": 7}}
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "abc",
                        "content": json.dumps({"ok": True, "value": {"score": 91}}),
                    }
                ],
            },
        ]
    )
    assert contents[0] == {"role": "user", "parts": [{"text": "check it"}]}
    assert contents[1]["role"] == "model"
    assert contents[1]["parts"][0]["functionCall"]["name"] == "get_verdict"
    response = contents[2]["parts"][0]["functionResponse"]
    assert response["name"] == "get_verdict"
    assert response["response"]["value"]["score"] == 91


def test_a_non_json_tool_result_is_wrapped_rather_than_dropped() -> None:
    """Gemini requires an object. A bare string must not become nothing."""
    contents = _gemini_contents(
        [
            {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": "x", "name": "t", "input": {}}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "x", "content": "plain"}
                ],
            },
        ]
    )
    assert contents[1]["parts"][0]["functionResponse"]["response"] == {"result": "plain"}


# ── Thought signatures: the round-trip requirement ──────────────────────────
#
# Found live, not in review. The first turn succeeded and the second failed
# with a hard 400 — "Function call is missing a thought_signature in
# functionCall parts" — because the requirement only exists on the round trip.
# No amount of single-request testing would have surfaced it.


def test_a_signature_is_captured_from_the_response_part() -> None:
    """It is a SIBLING of functionCall on the part, not a field inside it."""
    completion = _from_gemini(
        reply(
            [
                {
                    "functionCall": {"name": "get_verdict", "args": {"id": 7}, "id": "JnkoJL1N"},
                    "thoughtSignature": "EjQKMgER-opaque",
                }
            ]
        )
    )
    call = completion.tool_calls[0]
    assert call.signature == "EjQKMgER-opaque"
    # And the model's OWN id is preferred over a minted one — an earlier note
    # in this file claimed Gemini returns none. It does.
    assert call.id == "JnkoJL1N"


def test_a_minted_id_still_covers_a_response_without_one() -> None:
    """Belt and braces for any model or API version that omits the id."""
    completion = _from_gemini(reply([{"functionCall": {"name": "get_verdict", "args": {}}}]))
    assert completion.tool_calls[0].id == "get_verdict-0"


def test_the_signature_is_replayed_alongside_the_function_call() -> None:
    contents = _gemini_contents(
        [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "abc",
                        "name": "get_verdict",
                        "input": {"id": 7},
                        "signature": "SIG",
                    }
                ],
            }
        ]
    )
    part = contents[0]["parts"][0]
    assert part["thoughtSignature"] == "SIG"
    assert part["functionCall"]["id"] == "abc"
    assert "thoughtSignature" not in part["functionCall"], "sibling, not nested"


def test_a_tool_result_echoes_the_call_id() -> None:
    """Name alone is ambiguous once a model calls one tool twice in a turn,
    and the two results are not interchangeable."""
    contents = _gemini_contents(
        [
            {
                "role": "assistant",
                "content": [
                    {"type": "tool_use", "id": "c1", "name": "get_verdict", "input": {"id": 1}},
                    {"type": "tool_use", "id": "c2", "name": "get_verdict", "input": {"id": 2}},
                ],
            },
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "c1", "content": "{}"},
                    {"type": "tool_result", "tool_use_id": "c2", "content": "{}"},
                ],
            },
        ]
    )
    responses = [p["functionResponse"] for p in contents[1]["parts"]]
    assert [r["id"] for r in responses] == ["c1", "c2"]
    assert {r["name"] for r in responses} == {"get_verdict"}


def test_anthropic_strips_the_signature_so_transcripts_stay_portable() -> None:
    """Anthropic validates block shape rather than ignoring unknown keys, so a
    conversation started under Gemini would 400 on every turn after someone
    changed AGENT_PROVIDER — for users mid-conversation only."""
    cleaned = _strip_foreign_keys(
        [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "abc",
                        "name": "t",
                        "input": {},
                        "signature": "SIG",
                    }
                ],
            }
        ]
    )
    block = cleaned[0]["content"][0]
    assert "signature" not in block
    assert block["id"] == "abc" and block["name"] == "t"


def test_chat_puts_the_signature_where_the_next_turn_will_find_it() -> None:
    """The transcript round-trips through the browser between turns, so state
    the next request needs has to live in the transcript itself."""
    from app.chat import _assistant_blocks

    completion = Completion(
        text="",
        tool_calls=[ToolCall(id="abc", name="get_verdict", args={}, signature="SIG")],
        stop_reason="STOP",
        usage=Usage(),
    )
    block = _assistant_blocks(completion)[0]
    assert block["signature"] == "SIG"
    # Round trip: what chat.py wrote is what the Gemini client reads back.
    replayed = _gemini_contents([{"role": "assistant", "content": [block]}])
    assert replayed[0]["parts"][0]["thoughtSignature"] == "SIG"


def test_the_assistant_role_is_renamed_to_model() -> None:
    contents = _gemini_contents(
        [{"role": "assistant", "content": [{"type": "text", "text": "hi"}]}]
    )
    assert contents[0]["role"] == "model"


# ── The request body ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_key_travels_in_a_header_never_the_url() -> None:
    """The quickstart shows `?key=`. Query strings reach access logs, proxies
    and error reports; `reportError` cannot redact what it never sees."""
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["header"] = request.headers.get("x-goog-api-key")
        return httpx.Response(200, json=reply([{"text": "ok"}]))

    await client_for(handler).complete(
        messages=[{"role": "user", "content": "hi"}],
        static_prose="prose",
        persona_prompt="persona",
        tools=[],
    )
    assert seen["header"] == "test-key"
    assert "test-key" not in str(seen["url"])
    assert "key=" not in str(seen["url"])


@pytest.mark.asyncio
async def test_both_system_blocks_reach_the_model() -> None:
    """Anthropic splits these for a cache breakpoint. Gemini has no
    breakpoints, so they merge — but neither may be silently dropped."""
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=reply([{"text": "ok"}]))

    await client_for(handler).complete(
        messages=[{"role": "user", "content": "hi"}],
        static_prose="STATIC-PROSE",
        persona_prompt="PERSONA-PROMPT",
        tools=[registry().tools["get_methodology"]],
    )
    body = seen["body"]
    assert isinstance(body, dict)
    texts = [p["text"] for p in body["systemInstruction"]["parts"]]
    assert texts == ["STATIC-PROSE", "PERSONA-PROMPT"]
    assert body["generationConfig"]["maxOutputTokens"] > 0
    assert body["tools"][0]["functionDeclarations"][0]["name"] == "get_methodology"


@pytest.mark.asyncio
async def test_the_default_model_is_the_gemini_one_not_anthropics() -> None:
    """A shared AGENT_MODEL default cannot serve two providers: `claude-sonnet-5`
    sent to Gemini is a 404 at request time, not a config error at boot."""
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json=reply([{"text": "ok"}]))

    await client_for(handler).complete(
        messages=[], static_prose="", persona_prompt="", tools=[]
    )
    assert DEFAULT_MODELS["gemini"] in str(seen["url"])
    assert "claude" not in str(seen["url"])


# ── Responses ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_function_call_becomes_a_toolcall_with_a_minted_id() -> None:
    """Gemini mints no ids; everything above this file matches results on one."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=reply(
                [{"functionCall": {"name": "get_verdict", "args": {"id": 7}}}],
                finish="STOP",
            ),
        )

    completion = await client_for(handler).complete(
        messages=[], static_prose="", persona_prompt="", tools=[]
    )
    assert len(completion.tool_calls) == 1
    call = completion.tool_calls[0]
    assert call.name == "get_verdict"
    assert call.args == {"id": 7}
    assert call.id, "a blank id would collide across parallel calls"


@pytest.mark.asyncio
async def test_two_calls_to_the_same_tool_get_distinct_ids() -> None:
    """Position-derived, so a model asking twice does not produce one id twice
    — which would silently drop one result on the way back."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=reply(
                [
                    {"functionCall": {"name": "get_verdict", "args": {"id": 1}}},
                    {"functionCall": {"name": "get_verdict", "args": {"id": 2}}},
                ]
            ),
        )

    completion = await client_for(handler).complete(
        messages=[], static_prose="", persona_prompt="", tools=[]
    )
    ids = [c.id for c in completion.tool_calls]
    assert len(set(ids)) == 2, ids


@pytest.mark.asyncio
async def test_usage_maps_onto_the_shared_dataclass() -> None:
    """cachedContentTokenCount is Gemini's only cache signal, and 0 is the
    expected value at our prompt size — implicit caching needs 2-4k tokens and
    knowledge.core is ~1.25k. Zero here is not a misconfiguration."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=reply(
                [{"text": "hi"}],
                usage={
                    "promptTokenCount": 1200,
                    "candidatesTokenCount": 40,
                    "cachedContentTokenCount": 0,
                },
            ),
        )

    usage = (
        await client_for(handler).complete(
            messages=[], static_prose="", persona_prompt="", tools=[]
        )
    ).usage
    assert usage.input_tokens == 1200
    assert usage.output_tokens == 40
    assert usage.cache_read_tokens == 0
    assert usage.cache_write_tokens == 0


@pytest.mark.asyncio
async def test_an_http_error_becomes_a_readable_modelunavailable() -> None:
    """The raw body is a nested envelope; an operator needs the message."""

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400, json={"error": {"code": 400, "message": "API key not valid."}}
        )

    with pytest.raises(ModelUnavailable, match="API key not valid"):
        await client_for(handler).complete(
            messages=[], static_prose="", persona_prompt="", tools=[]
        )


def test_streamed_chunks_fold_into_one_completion() -> None:
    """Text spreads across chunks; usage and finishReason arrive only on the
    last. Neither the first nor the last chunk alone is the answer."""
    merged = _merge_gemini(
        [
            reply([{"text": "The "}], usage={}, finish=""),
            reply([{"text": "score "}], usage={}, finish=""),
            reply(
                [{"text": "is 91."}],
                usage={"promptTokenCount": 900, "candidatesTokenCount": 12},
                finish="STOP",
            ),
        ]
    )
    assert merged.text == "The score is 91."
    assert merged.stop_reason == "STOP"
    assert merged.usage.input_tokens == 900


# ── Provider selection ──────────────────────────────────────────────────────


def test_the_provider_seam_returns_the_configured_client(monkeypatch) -> None:
    for provider, expected in (("gemini", "GeminiClient"), ("anthropic", "AnthropicClient")):
        cfg = Settings(  # type: ignore[arg-type]
            INTERNAL_JOB_SECRET="s", GEMINI_API_KEY="g", ANTHROPIC_API_KEY="a",
            AGENT_PROVIDER=provider,
        )
        monkeypatch.setattr(llm_module, "settings", lambda cfg=cfg: cfg)
        llm_module._reset_llm_for_tests()
        assert type(llm_module.llm()).__name__ == expected
    llm_module._reset_llm_for_tests()


def test_our_models_key_is_never_the_other_providers() -> None:
    """The selected provider's key, or nothing. Falling back to whichever key
    happens to be set would send an Anthropic key to Google."""
    cfg = Settings(  # type: ignore[arg-type]
        INTERNAL_JOB_SECRET="s", ANTHROPIC_API_KEY="anthropic-key", AGENT_PROVIDER="gemini"
    )
    assert cfg.our_models_key == ""
    assert cfg.our_models_enabled is False


def test_production_refuses_a_gemini_key_until_metering_lands() -> None:
    """The tripwire named ANTHROPIC_API_KEY until a second provider existed.

    Written that way it would have let GEMINI_API_KEY boot straight past it
    into the exact state it exists to prevent: an unauthenticated, unmetered
    spend endpoint on our own account.
    """
    cfg = Settings(  # type: ignore[arg-type]
        INTERNAL_JOB_SECRET="s", GEMINI_API_KEY="g", AGENT_ENV="production",
        MCP_AUTH_TOKEN="t",
    )
    with pytest.raises(RuntimeError, match="metering is not implemented"):
        cfg.assert_serveable()


def test_an_unknown_provider_is_refused_at_load() -> None:
    with pytest.raises(ValueError, match="AGENT_PROVIDER"):
        Settings(INTERNAL_JOB_SECRET="s", AGENT_PROVIDER="openai")  # type: ignore[arg-type]
