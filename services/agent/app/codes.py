"""Error codes emitted by the agent plane.

The authoritative registry is `lib/observability/codes.ts` — §20.2 of the PRD
says every reportable failure carries one machine code *from that file*, so
dashboards, alerts and tests match on identity rather than on message strings.
This module is the Python-side mirror, and `tests/test_codes.py` fails CI if the
two drift in either direction.

Two directions, two different failures. A code here that is missing from
`codes.ts` cannot be looked up by whoever finds it in a container log. A code in
`codes.ts` that nothing emits is dead vocabulary that reads as coverage.

Codes are **append-only**. Renaming one breaks historical fingerprints in
`app_error_events`; deprecate in a comment and add a new code instead.
"""

from __future__ import annotations

from typing import Final

# ── Egress to Next ──
UPSTREAM_TIMEOUT: Final = "RC_AGENT_UPSTREAM_TIMEOUT"
UPSTREAM_UNREACHABLE: Final = "RC_AGENT_UPSTREAM_UNREACHABLE"
UPSTREAM_INVALID: Final = "RC_AGENT_UPSTREAM_INVALID"

# ── Client-executed tools ──
PROVENANCE_REJECTED: Final = "RC_AGENT_PROVENANCE_REJECTED"
CLIENT_TOOL_FAILED: Final = "RC_AGENT_CLIENT_TOOL_FAILED"

# ── Dispatch ──
TOOL_BUDGET: Final = "RC_AGENT_TOOL_BUDGET"
TOOL_DENIED: Final = "RC_AGENT_TOOL_DENIED"
UNKNOWN_TOOL: Final = "RC_AGENT_UNKNOWN_TOOL"

# ── Model ──
MODEL_UNAVAILABLE: Final = "RC_AGENT_MODEL_UNAVAILABLE"
MODEL_FAILED: Final = "RC_AGENT_MODEL_FAILED"

# ── Knowledge / context ──
KNOWLEDGE_GAP: Final = "RC_AGENT_KNOWLEDGE_GAP"
HISTORY_TRIMMED: Final = "RC_AGENT_HISTORY_TRIMMED"

#: Every code this process can emit. The sync test diffs this against the
#: RC_AGENT_* entries in lib/observability/codes.ts.
ALL: Final[frozenset[str]] = frozenset(
    {
        UPSTREAM_TIMEOUT,
        UPSTREAM_UNREACHABLE,
        UPSTREAM_INVALID,
        PROVENANCE_REJECTED,
        CLIENT_TOOL_FAILED,
        TOOL_BUDGET,
        TOOL_DENIED,
        UNKNOWN_TOOL,
        MODEL_UNAVAILABLE,
        MODEL_FAILED,
        KNOWLEDGE_GAP,
        HISTORY_TRIMMED,
    }
)
