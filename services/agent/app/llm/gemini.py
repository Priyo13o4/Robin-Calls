"""Gemini — REST, hand-rolled over httpx.

No google-genai SDK, for the reason `mcp.py` gives for hand-rolling JSON-RPC:
the surface is two calls, httpx is already a dependency, and
`lib/agent/providers.ts` hand-rolls the *identical* wire format on the browser
side for BYOK — one shape, described once, in two languages that can be
diffed against each other.

## Caching does not work the way Anthropic's does

There are no breakpoints. Caching is implicit and automatic, and only engages
above a per-model minimum. `knowledge.core` is roughly 1,250 tokens,
deliberately small so BYOK users are not billed for a cache write they never
amortize (`knowledge.py`).

**The documented 4,096 minimum is not the real one.** Measured 2026-08-06
against gemini-3.5-flash-lite on our own key, sending a byte-identical prompt
twice and reading `cachedContentTokenCount` off the second:

    prompt  8,329 → cached      0     (three times running)
    prompt 12,808 → cached      0
    prompt 15,688 → cached      0
    prompt 17,608 → cached 12,262     first hit
    prompt 22,408 → cached 16,356
    prompt 41,609 → cached 32,738     79% of the request

So the floor sits between 15,688 and 17,608 — almost certainly 16,384 — roughly
4x the published figure, and the cached amount is quantised to 4,096-token
blocks (12,262 / 16,356 / 32,738 are each a whole number of blocks, less a few).

This matters because the paragraph it replaces asserted the opposite and was
believed: it said a `cache_read_tokens` of 0 was the *expected* value and not
evidence of a misconfiguration, which is exactly the sentence that stops anyone
from checking. Zero is expected only because every one of our single requests
lands under ~16k, not because caching is unavailable to us. Above that line it
works, and it works well.

Do not 'fix' this by padding the prompt to clear the threshold: the padding
would be sent on every turn forever to win a discount on itself. The honest
consequence runs the other way — a LONGER conversation gets cheaper per token
once it crosses the line, which is the opposite of the intuition that history
growth is purely a cost. Weigh that before trimming history purely to save
money (`history.py`).

## Thought signatures

Gemini 3.x returns an encrypted `thoughtSignature` beside every `functionCall`
and refuses the *next* request if it is not echoed back verbatim. Found live:
the first turn succeeded and the second failed with a hard 400, because the
requirement only exists on the round trip.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..settings import settings
from .base import Completion, ModelUnavailable, ToolCall, Usage

log = logging.getLogger("agent.llm.gemini")


#
# Hand-rolled over httpx rather than the google-genai SDK, for the reason
# `mcp.py` gives for hand-rolling JSON-RPC: the surface is two calls, httpx is
# already a dependency, and `lib/agent/providers.ts` hand-rolls the *identical*
# wire format on the browser side — one shape, described once, in two languages
# that can be diffed against each other.

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

#: JSON Schema keywords Gemini rejects outright. Both appear in every schema
#: this registry generates — `additionalProperties` on all 19 tools and
#: `pattern` on every address argument — so unsanitised, *every* tool call
#: fails with an error naming the schema rather than the tool.
_GEMINI_UNSUPPORTED = ("additionalProperties", "pattern", "$schema", "examples")


def _gemini_schema(schema: dict[str, Any]) -> dict[str, Any] | None:
    """Strip what Gemini rejects; return None when there are no arguments.

    The address `pattern` is folded into the description rather than dropped:
    the model still reads it, and the server revalidates regardless — the
    regex was never the enforcement, `lib/internal/reads.ts` is.

    None (rather than an empty object) is returned for a no-argument tool
    because Gemini wants `parameters` omitted entirely in that case.
    """
    cleaned: dict[str, Any] = {}
    for key, value in schema.items():
        if key in _GEMINI_UNSUPPORTED:
            continue
        if key == "properties" and isinstance(value, dict):
            props: dict[str, Any] = {}
            for prop, spec in value.items():
                if not isinstance(spec, dict):
                    props[prop] = spec
                    continue
                inner = {k: v for k, v in spec.items() if k not in _GEMINI_UNSUPPORTED}
                if "pattern" in spec:
                    desc = inner.get("description", "")
                    inner["description"] = f"{desc} Must match {spec['pattern']}.".strip()
                props[prop] = inner
            cleaned[key] = props
        else:
            cleaned[key] = value
    if not cleaned.get("properties"):
        return None
    return cleaned


def _gemini_tools(tools: list[Any]) -> list[dict[str, Any]]:
    """One `functionDeclarations` block, sorted for a stable request body."""
    declarations = []
    for tool in sorted(tools, key=lambda t: t.name):
        declaration: dict[str, Any] = {
            "name": tool.name,
            "description": tool.description,
        }
        params = _gemini_schema(tool.input_schema)
        if params is not None:
            declaration["parameters"] = params
        declarations.append(declaration)
    return [{"functionDeclarations": declarations}] if declarations else []


def _tool_names_by_id(messages: list[dict[str, Any]]) -> dict[str, str]:
    """Rebuild tool_use_id -> tool name from the transcript.

    `functionResponse` is keyed by NAME, while everything above this file
    matches on `tool_use_id`, so the name has to be recovered from the earlier
    `tool_use` block. Rebuilt from the messages rather than threaded through,
    so this client stays stateless and a resumed conversation behaves
    identically to a fresh one.
    """
    names: dict[str, str] = {}
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_use":
                names[str(block.get("id"))] = str(block.get("name"))
    return names


def _gemini_contents(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Anthropic-shaped transcript -> Gemini `contents`."""
    names = _tool_names_by_id(messages)
    contents: list[dict[str, Any]] = []

    for message in messages:
        role = "model" if message.get("role") == "assistant" else "user"
        content = message.get("content")

        if isinstance(content, str):
            contents.append({"role": role, "parts": [{"text": content}]})
            continue
        if not isinstance(content, list):
            continue

        parts: list[dict[str, Any]] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "text" and block.get("text"):
                parts.append({"text": block["text"]})
            elif kind == "tool_use":
                call: dict[str, Any] = {
                    "name": block.get("name"),
                    "args": block.get("input") or {},
                }
                if block.get("id"):
                    call["id"] = block["id"]
                part: dict[str, Any] = {"functionCall": call}
                # Sibling of functionCall, not a member of it. Replaying a call
                # without its signature is a hard 400 on Gemini 3.x, so a
                # missing one here is worth surfacing rather than silently
                # sending a request that cannot succeed.
                signature = block.get("signature")
                if signature:
                    part["thoughtSignature"] = signature
                else:
                    log.warning(
                        "llm.gemini_missing_signature", extra={"tool": block.get("name")}
                    )
                parts.append(part)
            elif kind == "tool_result":
                raw = block.get("content")
                call_id = str(block.get("tool_use_id") or "")
                # Gemini wants an object; our tool payloads travel as a JSON
                # string. Wrapping a non-object in {"result": …} rather than
                # sending it bare keeps a string payload from being rejected.
                response: dict[str, Any] = {
                    "name": names.get(call_id, "unknown"),
                    "response": _as_object(raw),
                }
                # Echo the id when the model gave us one. Name alone is
                # ambiguous the moment a model calls the same tool twice in one
                # turn, and the two results are not interchangeable.
                if call_id:
                    response["id"] = call_id
                parts.append({"functionResponse": response})
        if parts:
            contents.append({"role": role, "parts": parts})
    return contents


def _as_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {"result": raw}
        return parsed if isinstance(parsed, dict) else {"result": parsed}
    return {"result": raw}


class GeminiClient:
    """Gemini via REST. Same interface as `AnthropicClient`, same dataclasses."""

    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._http = client
        self._cfg = settings()

    def _session(self) -> httpx.AsyncClient:
        if self._http is None:
            if not self._cfg.our_models_enabled:
                raise ModelUnavailable(
                    "GEMINI_API_KEY is unset, so the our-models path is off. "
                    "BYOK conversations are unaffected — those run in the browser."
                )
            self._http = httpx.AsyncClient(timeout=self._cfg.model_timeout_s)
        return self._http

    def _headers(self) -> dict[str, str]:
        # The key goes in a header, never `?key=` as the quickstart shows.
        # Query strings reach access logs, proxies and error reports; a header
        # does not, and `reportError` cannot redact what it never sees.
        return {
            "content-type": "application/json",
            "x-goog-api-key": self._cfg.our_models_key,
        }

    def _body(
        self,
        *,
        messages: list[dict[str, Any]],
        static_prose: str,
        persona_prompt: str,
        tools: list[Any],
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "contents": _gemini_contents(messages),
            # One instruction, both blocks. Gemini has no cache breakpoints, so
            # the Anthropic two-block split has nothing to express here.
            "systemInstruction": {
                "parts": [{"text": static_prose}, {"text": persona_prompt}]
            },
            "generationConfig": {"maxOutputTokens": self._cfg.max_output_tokens},
        }
        declared = _gemini_tools(tools)
        if declared:
            body["tools"] = declared
        return body

    async def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        static_prose: str,
        persona_prompt: str,
        tools: list[Any],
    ) -> Completion:
        response = await self._session().post(
            f"{GEMINI_BASE}/{self._cfg.model}:generateContent",
            headers=self._headers(),
            json=self._body(
                # NOT stripped: `signature` is exactly what Gemini requires
                # back. Sanitising here would reintroduce the 400 this field
                # exists to prevent.
                messages=messages,
                static_prose=static_prose,
                persona_prompt=persona_prompt,
                tools=tools,
            ),
        )
        if response.status_code >= 400:
            raise ModelUnavailable(_gemini_error(response))
        return _from_gemini(response.json())

    async def stream(
        self,
        *,
        messages: list[dict[str, Any]],
        static_prose: str,
        persona_prompt: str,
        tools: list[Any],
    ) -> AsyncIterator[dict[str, Any]]:
        """Text deltas, then one `{type: "final", completion}`.

        Chunks are accumulated and re-parsed as one response at the end rather
        than assembled incrementally: `finishReason` and `usageMetadata` arrive
        on the last chunk, and a partial `functionCall` is not a tool call.
        """
        chunks: list[dict[str, Any]] = []
        async with self._session().stream(
            "POST",
            f"{GEMINI_BASE}/{self._cfg.model}:streamGenerateContent",
            params={"alt": "sse"},
            headers=self._headers(),
            json=self._body(
                # NOT stripped: `signature` is exactly what Gemini requires
                # back. Sanitising here would reintroduce the 400 this field
                # exists to prevent.
                messages=messages,
                static_prose=static_prose,
                persona_prompt=persona_prompt,
                tools=tools,
            ),
        ) as response:
            if response.status_code >= 400:
                await response.aread()
                raise ModelUnavailable(_gemini_error(response))
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    chunk = json.loads(payload)
                except ValueError:
                    continue
                chunks.append(chunk)
                for part in _gemini_parts(chunk):
                    if "text" in part:
                        yield {"type": "text", "text": part["text"]}

        yield {"type": "final", "completion": _merge_gemini(chunks)}


def _gemini_error(response: httpx.Response) -> str:
    """A readable message, because the raw body is a nested error envelope."""
    try:
        body = response.json()
        message = body.get("error", {}).get("message") or str(body)[:300]
    except ValueError:
        message = response.text[:300]
    return f"Gemini refused the request ({response.status_code}): {message}"


def _gemini_parts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = payload.get("candidates") or []
    if not candidates:
        return []
    parts = (candidates[0].get("content") or {}).get("parts") or []
    return [p for p in parts if isinstance(p, dict)]


def _from_gemini(payload: dict[str, Any], *, offset: int = 0) -> Completion:
    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []

    for index, part in enumerate(_gemini_parts(payload)):
        if "text" in part:
            text_parts.append(part["text"])
        elif "functionCall" in part:
            call = part["functionCall"] or {}
            name = str(call.get("name", ""))
            tool_calls.append(
                ToolCall(
                    # Gemini 3.x DOES return an id on the call (measured — an
                    # earlier note here claimed otherwise, from the docs). Use
                    # it when present so results match the model's own
                    # bookkeeping, and fall back to a position-derived id for
                    # any model or API version that omits one: a blank id would
                    # collide across parallel calls and silently drop a result.
                    id=str(call.get("id") or f"{name}-{offset + index}"),
                    name=name,
                    args=dict(call.get("args") or {}),
                    # Sibling of functionCall on the part, not inside it.
                    signature=part.get("thoughtSignature"),
                )
            )

    meta = payload.get("usageMetadata") or {}
    candidates = payload.get("candidates") or []
    return Completion(
        text="".join(text_parts),
        tool_calls=tool_calls,
        stop_reason=(candidates[0].get("finishReason") if candidates else None),
        usage=Usage(
            input_tokens=int(meta.get("promptTokenCount") or 0),
            output_tokens=int(meta.get("candidatesTokenCount") or 0),
            # Implicit caching only, and only above the model's real minimum of
            # ~16k tokens — see the module docstring for the measurements. Zero
            # here means this request was under that line, which today is all of
            # them; it does not mean caching is unavailable.
            cache_read_tokens=int(meta.get("cachedContentTokenCount") or 0),
            # No write concept: nothing is ever explicitly stored, so there is
            # no premium turn to attribute one to.
            cache_write_tokens=0,
        ),
    )


def _merge_gemini(chunks: list[dict[str, Any]]) -> Completion:
    """Fold streamed chunks into one Completion.

    Usage arrives on the final chunk and text arrives spread across all of
    them, so neither the first nor the last chunk alone is the answer.
    """
    if not chunks:
        return Completion(text="", tool_calls=[], stop_reason=None, usage=Usage())

    text: list[str] = []
    calls: list[ToolCall] = []
    for chunk in chunks:
        partial = _from_gemini(chunk, offset=len(calls))
        text.append(partial.text)
        calls.extend(partial.tool_calls)

    final = _from_gemini(chunks[-1])
    return Completion(
        text="".join(text),
        tool_calls=calls,
        stop_reason=final.stop_reason,
        usage=final.usage,
    )
