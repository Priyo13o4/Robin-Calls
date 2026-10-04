"""Bounding the transcript that rides each request.

Conversation state is **not stored server-side**. The browser holds the
transcript and posts it back, which keeps this process stateless: a restart
mid-conversation costs nothing, and there is no session store to scale, expire
or leak. Durable conversations are a later concern with their own table, and
they change nothing here — this trimming would still be needed, because a
stored conversation grows exactly the same way.

What that leaves is a real failure with no natural stopping point: the
transcript grows every turn, and at some point the model call fails outright on
context length. That failure lands mid-conversation, after the user has already
invested a session, and it does not get better on retry. So the history is
bounded here rather than left to discover its own ceiling.

**Two rules, and the second one is the subtle one.**

1. Trim from the *oldest* end. Recent turns carry the thread; the opening
   question rarely does by turn twenty.

2. **Never split a `tool_use` from its `tool_result`.** The Messages API
   rejects an assistant `tool_use` block with no matching `tool_result` in the
   next message, and rejects an orphan `tool_result` just as hard. A naive
   "drop the first N messages" is therefore not a smaller conversation, it is a
   400 — a worse failure than the one being prevented, and one that only shows
   up on long conversations with tool calls, which is to say in production. So
   the cut is only ever made at a **turn boundary**: a plain user message with
   no tool blocks in it.

The trim is never silent. The user can see history on screen that the model was
not given, and a divergence between what the page shows and what the model knew
is exactly the kind of thing that produces "why did it forget?" with no
explanation available.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

log = logging.getLogger("agent.history")

#: Rough characters-per-token. Deliberately conservative (real English is ~4).
#: This is a budget guard, not an accounting system — the cost of guessing low
#: is a slightly shorter history, and the cost of guessing high is the hard
#: failure this module exists to prevent. `count_tokens` would be exact but
#: costs a network round trip per turn to protect against an edge case.
CHARS_PER_TOKEN = 3


@dataclass(frozen=True)
class Trimmed:
    messages: list[dict[str, Any]]
    dropped: int
    approx_tokens: int

    @property
    def was_trimmed(self) -> bool:
        return self.dropped > 0


def approx_tokens(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        content = message.get("content")
        total += len(content) if isinstance(content, str) else len(json.dumps(content, default=str))
    return total // CHARS_PER_TOKEN


def _is_turn_boundary(message: dict[str, Any]) -> bool:
    """True when this message can legally be the first one in a transcript.

    A plain user message. Anything carrying tool blocks is mid-exchange: an
    assistant `tool_use` needs its result, and a user `tool_result` needs the
    `tool_use` that asked for it. Starting a conversation on either is a 400.
    """
    if message.get("role") != "user":
        return False
    content = message.get("content")
    if isinstance(content, str):
        return True
    if isinstance(content, list):
        return not any(
            isinstance(block, dict) and block.get("type") == "tool_result" for block in content
        )
    return False


def trim(messages: list[dict[str, Any]], max_tokens: int) -> Trimmed:
    """Drop whole turns off the front until the transcript fits.

    Returns the transcript unchanged when it already fits, which is the common
    case — this costs one length calculation on a typical turn.
    """
    if not messages:
        return Trimmed(messages=[], dropped=0, approx_tokens=0)

    current = approx_tokens(messages)
    if current <= max_tokens:
        return Trimmed(messages=messages, dropped=0, approx_tokens=current)

    # Every index where a transcript could legally begin, oldest first.
    boundaries = [i for i, m in enumerate(messages) if _is_turn_boundary(m)]

    for cut in boundaries[1:]:
        candidate = messages[cut:]
        size = approx_tokens(candidate)
        if size <= max_tokens:
            log.warning(
                "history.trimmed",
                extra={"dropped": cut, "kept": len(candidate), "approx_tokens": size},
            )
            return Trimmed(messages=candidate, dropped=cut, approx_tokens=size)

    # Even the last complete turn is over budget — a single enormous message,
    # usually one huge tool result. Keeping it whole and letting the provider
    # reject it is the honest outcome: silently truncating a tool result would
    # hand the model a partial verdict that still looks complete, which is the
    # one thing this system must never do.
    if boundaries:
        last = boundaries[-1]
        candidate = messages[last:]
        log.error(
            "history.irreducible",
            extra={"kept": len(candidate), "approx_tokens": approx_tokens(candidate)},
        )
        return Trimmed(
            messages=candidate, dropped=last, approx_tokens=approx_tokens(candidate)
        )

    # No turn boundary at all — a malformed transcript. Pass it through rather
    # than invent one; the provider's own error is more useful than ours.
    return Trimmed(messages=messages, dropped=0, approx_tokens=current)
