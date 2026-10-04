"""Provider-neutral types for the model seam.

Every provider client returns these, so nothing above `llm/` learns which
provider answered. `chat.py` reads `Completion.text`, `.tool_calls` and
`.usage` and never branches on the provider.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class ModelUnavailable(RuntimeError):
    """Our-models is not configured, or the provider refused."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def cache_hit(self) -> bool:
        return self.cache_read_tokens > 0


@dataclass
class ToolCall:
    id: str
    name: str
    args: dict[str, Any]
    #: Opaque provider continuation state, echoed back verbatim on the next
    #: request or the provider refuses the turn.
    #:
    #: This exists because of Gemini 3.x `thoughtSignature`: the model returns
    #: an encrypted signature alongside every `functionCall`, and replaying that
    #: call in history without it is a hard 400 — "Function call is missing a
    #: thought_signature in functionCall parts". Measured, not read: the first
    #: live turn succeeded and the second failed, because the failure only
    #: exists on the round trip. Anthropic has no equivalent and its client
    #: strips the field, so a transcript stays portable between providers.
    signature: str | None = None


@dataclass
class Completion:
    text: str
    tool_calls: list[ToolCall]
    stop_reason: str | None
    usage: Usage
