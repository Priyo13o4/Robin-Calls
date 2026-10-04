"""Anthropic — the our-models default.

## Cache breakpoints

The static block gets `cache_control: ephemeral`. Everything volatile — the
user's question, tool results, the conversation — goes *after* it, because the
cache key hashes the prompt prefix and one changing byte early invalidates
everything downstream.

Verify rather than assume: `cache_read_input_tokens` must be non-zero on the
second turn. Caching that silently is not happening looks exactly like caching
that is, and roughly doubles the cost of every turn.

Per-organization isolation is why the knowledge block is small and split — see
`knowledge.py`. Under BYOK each user is their own org, so a large shared block
would be re-written per user and amortized by nobody.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from ..settings import settings
from .base import Completion, ModelUnavailable, ToolCall, Usage

log = logging.getLogger("agent.llm.anthropic")


def _system_blocks(static_prose: str, persona_prompt: str) -> list[dict[str, Any]]:
    """Two blocks, TWO breakpoints, in stability order.

    Anthropic builds the cache prefix as ``tools -> system -> messages``, so a
    breakpoint here already covers the tool definitions above it — those were
    never the uncached part, despite being the largest static block for a
    tool-heavy persona (the tracer's 15 specs are ~9.3 KB).

    What WAS uncached is the persona prompt, on the reasoning that it "varies
    per conversation". True across conversations, irrelevant within one — and
    turns within one conversation are exactly what a cache is for. Every turn
    after the first was re-paying for 1.6-3.9 KB that had not changed.

    So both blocks carry a breakpoint:

    - after ``static_prose`` — tools + core, reused by every conversation on
      this persona,
    - after ``persona_prompt`` — the whole static preamble, reused by every
      turn after the first within one conversation.

    Two breakpoints rather than moving the one, because they nest: a cold
    conversation on a warm persona still gets the first, and only pays to write
    the second. Anthropic permits four; we use two.

    The economics differ by path and that is deliberate. On our-models one
    organization cache is shared by every user, so a write amortizes almost
    immediately. Under BYOK each user brings their own cache and pays the write
    premium themselves — but the persona prompt is small, and any user who asks
    a second question inside the TTL comes out ahead.
    """
    return [
        {
            "type": "text",
            "text": static_prose,
            "cache_control": {"type": "ephemeral"},
        },
        {
            "type": "text",
            "text": persona_prompt,
            "cache_control": {"type": "ephemeral"},
        },
    ]


def _tool_specs(tools: list[Any]) -> list[dict[str, Any]]:
    """Registry tools -> Anthropic tool specs, in a deterministic order.

    Sorted because tool JSON is part of the cached prefix: a set-ordering
    change would invalidate every user's cache for no reason at all.
    """
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.input_schema,
        }
        for t in sorted(tools, key=lambda t: t.name)
    ]


#: Keys Anthropic accepts on a `tool_use` block. Anything else is a 400 —
#: Anthropic validates block shape rather than ignoring unknown fields.
_ANTHROPIC_TOOL_USE_KEYS = {"type", "id", "name", "input", "cache_control"}


def _strip_foreign_keys(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop provider-opaque keys the transcript picked up under another provider.

    `signature` (Gemini's `thoughtSignature`) lives on `tool_use` blocks so it
    survives the browser round trip. Anthropic rejects unknown block keys, so a
    conversation started under Gemini and continued after AGENT_PROVIDER
    changed would 400 on every subsequent turn — a failure with no obvious
    cause, appearing only for users mid-conversation at the moment of a config
    change. Cheaper to strip than to explain.
    """
    cleaned: list[dict[str, Any]] = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            cleaned.append(message)
            continue
        blocks = [
            {k: v for k, v in b.items() if k in _ANTHROPIC_TOOL_USE_KEYS}
            if isinstance(b, dict) and b.get("type") == "tool_use"
            else b
            for b in content
        ]
        cleaned.append({**message, "content": blocks})
    return cleaned


class AnthropicClient:
    def __init__(self, client: Any | None = None) -> None:
        self._client = client
        self._cfg = settings()

    def _anthropic(self) -> Any:
        if self._client is not None:
            return self._client
        if not self._cfg.our_models_enabled:
            raise ModelUnavailable(
                "ANTHROPIC_API_KEY is unset, so the our-models path is off. "
                "BYOK conversations are unaffected — those run in the browser."
            )
        # Imported lazily so the MCP surface, which needs no model at all, can
        # run in a container that never installed or configured one.
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=self._cfg.anthropic_api_key)
        return self._client

    async def complete(
        self,
        *,
        messages: list[dict[str, Any]],
        static_prose: str,
        persona_prompt: str,
        tools: list[Any],
    ) -> Completion:
        response = await self._anthropic().messages.create(
            model=self._cfg.model,
            max_tokens=self._cfg.max_output_tokens,
            system=_system_blocks(static_prose, persona_prompt),
            tools=_tool_specs(tools),
            messages=_strip_foreign_keys(messages),
        )
        return _to_completion(response)

    async def stream(
        self,
        *,
        messages: list[dict[str, Any]],
        static_prose: str,
        persona_prompt: str,
        tools: list[Any],
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield `{type: "text", text}` deltas, then one `{type: "final", …}`.

        Text is streamed for latency, but the *validated* text is what the
        client must ultimately render: citation-or-silence runs on the complete
        reply, and a sentence cannot be judged until it has finished arriving.
        The chat layer therefore treats deltas as a preview and replaces them
        with the final validated body.
        """
        async with self._anthropic().messages.stream(
            model=self._cfg.model,
            max_tokens=self._cfg.max_output_tokens,
            system=_system_blocks(static_prose, persona_prompt),
            tools=_tool_specs(tools),
            messages=_strip_foreign_keys(messages),
        ) as stream:
            async for text in stream.text_stream:
                yield {"type": "text", "text": text}
            final = await stream.get_final_message()

        completion = _to_completion(final)
        yield {"type": "final", "completion": completion}


def _to_completion(response: Any) -> Completion:
    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []

    for block in response.content:
        kind = getattr(block, "type", None)
        if kind == "text":
            text_parts.append(block.text)
        elif kind == "tool_use":
            tool_calls.append(
                ToolCall(id=block.id, name=block.name, args=dict(block.input or {}))
            )

    usage = getattr(response, "usage", None)
    parsed = Usage(
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
    )
    if parsed.input_tokens and not parsed.cache_hit and not parsed.cache_write_tokens:
        # Neither read nor written means the static block is not a cacheable
        # prefix at all — usually something volatile drifted above the
        # breakpoint. Silent, and it doubles the cost of every turn.
        log.warning("llm.no_cache_activity", extra={"input_tokens": parsed.input_tokens})

    return Completion(
        text="".join(text_parts),
        tool_calls=tool_calls,
        stop_reason=getattr(response, "stop_reason", None),
        usage=parsed,
    )
