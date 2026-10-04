"""The model seam. One interface, one file per provider.

Two separate problems, and conflating them is what makes this look hard:

- **Our models** run here, server-side, on our key. ``AGENT_PROVIDER`` picks the
  client; no gateway, so no third party sees our prompts and none takes a cut.
- **BYOK** never reaches this process at all. The browser calls the user's own
  provider directly with the user's own key. All three major providers permit
  browser-origin calls (measured, 2026-08-01), so there is nothing for a gateway
  to solve here either.

## The contract a provider file implements

``complete()`` and ``stream()``, returning the provider-neutral types in
``base.py``. **The canonical message shape is Anthropic's on both sides of the
seam** — ``chat.py`` builds ``tool_use``/``tool_result`` blocks, ``history.py``
refuses to split them, and ``lib/agent/providers.ts`` does the same translation
at the browser edge for BYOK. A provider file translates on the way in and back
on the way out, and nothing above this package learns a second provider exists.

Adding a third is one new file plus one entry in ``settings.DEFAULT_MODELS``.
Nothing here is a registry or a plugin system: two providers do not need
discovery, and a dict of two entries is easier to read than the machinery that
would replace it.

## What differs between providers is never cosmetic

Each file documents its own traps, because they are not shared:

- **Anthropic** takes explicit cache breakpoints; Gemini has none and applies
  an implicit cache our prompt is too small to reach.
- **Gemini** requires an opaque ``thoughtSignature`` echoed back on the next
  request, and rejects two JSON Schema keywords present in every schema this
  registry generates.

Both were found by making a real call. Neither is visible in review.
"""

from __future__ import annotations

from ..settings import settings
from .anthropic import AnthropicClient
from .base import Completion, ModelUnavailable, ToolCall, Usage
from .gemini import GeminiClient

__all__ = [
    "AnthropicClient",
    "Completion",
    "GeminiClient",
    "ModelUnavailable",
    "ToolCall",
    "Usage",
    "llm",
]

_client: AnthropicClient | GeminiClient | None = None


def llm() -> AnthropicClient | GeminiClient:
    global _client
    if _client is None:
        _client = GeminiClient() if settings().provider == "gemini" else AnthropicClient()
    return _client


def _reset_llm_for_tests() -> None:
    """Drop the memoized client so a test can vary the provider."""
    global _client
    _client = None
