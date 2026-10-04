"""Anonymous per-turn diagnostics. Shape and behaviour only — never content.

**Conversations are not stored.** The browser holds the transcript; this
process is stateless and keeps no history, for either our-models or BYOK. What
it does keep is enough to answer operational questions that are otherwise
unanswerable, none of which need to know what anyone said.

## What this exists to answer

Each field below maps to a question we would otherwise have no way to settle,
and several map to failures that are silent by construction:

- **Is prompt caching actually working?** `cache_read_tokens` on the second and
  later turns. Caching that silently is not happening looks exactly like
  caching that is, and it roughly doubles the cost of every turn. This is the
  §16 validation gate.
- **Is the agent inventing numbers?** `stripped_claims` — how often the
  citation validator had to remove a sentence. Non-zero is a prompt or tool
  problem, and nobody would ever report it: the user just sees a slightly
  shorter answer.
- **Is client-side RPC healthy?** `provenance_rejections` by reason. A rise in
  `stale` means the public endpoint is lagging; a rise in `wrong_chain` means
  users are pointed elsewhere. Both are invisible from the server otherwise.
- **Is the tool-call cap biting?** `budget_exhausted`. If turns routinely hit
  it, the cap is wrong or a tool is unhelpful.
- **Which tools actually get used, and which fail?** `tool_calls` by name and
  outcome. A tool nobody calls is dead weight in the cached prompt prefix.
- **Are conversations outgrowing the context budget?** `history_dropped`.

## What is deliberately NOT here

No message text. No tool arguments. No tool results. No wallet address, no IP,
no user agent, no API key. Not because those are hard to collect but because
collecting them would recreate, in a log, the conversation store we
specifically decided not to build.

**Tool arguments are content.** An address argument is public data, but *which*
address someone asked about is a statement about that person. So tool calls are
recorded by name and outcome only.

`_assert_clean` enforces this rather than trusting the call sites: it scans the
serialized record for address-shaped and long free-text values and raises. A
future field that quietly carries content fails a test instead of shipping.

## Where it goes

One structured JSON line per turn, to stdout — which docker already collects.
No database, no new table, no collector, no second infrastructure component to
run and monitor. `_SINK` is a seam if that ever needs to change; it is not an
abstraction layer, it is one function.

`trace_id` is included and is the one caveat worth stating plainly: it also
appears in Next's logs beside the scan it triggered, so a record is joinable to
a token address by anyone with both logs. That makes this **pseudonymous, not
anonymous** — which is precisely what makes it useful for debugging a specific
report. It carries no user identity and expires with normal log retention. Set
``AGENT_TELEMETRY_TRACE_IDS=0`` to drop it and lose that ability.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

log = logging.getLogger("agent.telemetry")

#: Anything address-shaped must never appear in a record.
_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")

#: Free text long enough to be a message rather than an identifier. Tool names,
#: error codes and persona names are all comfortably under this.
_MAX_STRING = 120

ToolOutcome = Literal["found", "empty", "transient", "denied", "failed"]
ProvenanceRejection = Literal["wrong_chain", "stale", "off_allowlist", "malformed"]


class TelemetryLeak(AssertionError):
    """A diagnostics record carried something that looks like content."""


@dataclass
class TurnDiagnostics:
    """One chat turn or one MCP call. Accumulated during, emitted after."""

    surface: Literal["chat", "mcp"]
    persona: str | None = None
    prompt_version: str = ""
    model: str = ""
    trace_id: str = ""

    # ── Model economics ──
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    model_rounds: int = 0

    # ── Behaviour ──
    tool_calls: Counter[str] = field(default_factory=Counter)
    tool_outcomes: Counter[str] = field(default_factory=Counter)
    provenance_rejections: Counter[str] = field(default_factory=Counter)
    error_codes: Counter[str] = field(default_factory=Counter)

    # ── Quality signals ──
    stripped_claims: int = 0
    budget_exhausted: bool = False
    history_dropped: int = 0
    transient_faults: int = 0
    billable: bool = True

    #: The client went away before the turn finished — a closed tab, a
    #: navigation, a STOP.
    #:
    #: Measured 2026-08-03, closing Q8: a disconnect DOES propagate (the second
    #: model round never happens, which is the good outcome), but the generator
    #: is cancelled at a `yield`, so the terminal `_finish` never ran and the
    #: turn produced **no record at all**. Those are precisely the turns worth
    #: counting: round one's input tokens were already spent, and a rise in them
    #: is what "users are giving up on the latency" looks like from the outside.
    #: Without this the statistics only describe turns that succeeded, which is
    #: the failure mode `_finish`'s own docstring exists to prevent.
    abandoned: bool = False

    duration_ms: int = 0

    def record_tool(self, name: str, outcome: ToolOutcome) -> None:
        self.tool_calls[name] += 1
        self.tool_outcomes[outcome] += 1

    def record_error(self, code: str | None) -> None:
        if code:
            self.error_codes[code] += 1

    def record_provenance_rejection(self, reason: ProvenanceRejection) -> None:
        self.provenance_rejections[reason] += 1

    @property
    def cache_hit(self) -> bool:
        return self.cache_read_tokens > 0

    def as_record(self) -> dict[str, Any]:
        record: dict[str, Any] = {
            "event": "agent.turn",
            "surface": self.surface,
            "persona": self.persona,
            "promptVersion": self.prompt_version,
            "model": self.model,
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "cacheReadTokens": self.cache_read_tokens,
            "cacheWriteTokens": self.cache_write_tokens,
            "cacheHit": self.cache_hit,
            "modelRounds": self.model_rounds,
            "toolCalls": dict(sorted(self.tool_calls.items())),
            "toolOutcomes": dict(sorted(self.tool_outcomes.items())),
            "provenanceRejections": dict(sorted(self.provenance_rejections.items())),
            "errorCodes": dict(sorted(self.error_codes.items())),
            "strippedClaims": self.stripped_claims,
            "budgetExhausted": self.budget_exhausted,
            "historyDropped": self.history_dropped,
            "transientFaults": self.transient_faults,
            "billable": self.billable,
            "abandoned": self.abandoned,
            "durationMs": self.duration_ms,
        }
        if _trace_ids_enabled():
            record["traceId"] = self.trace_id
        return record


def _trace_ids_enabled() -> bool:
    return os.getenv("AGENT_TELEMETRY_TRACE_IDS", "1") != "0"


def _assert_clean(record: dict[str, Any]) -> None:
    """Refuse to emit anything that looks like conversation content.

    Enforcement, not documentation. The call sites are careful today; this is
    what keeps them careful after someone adds a field in a hurry, and it is
    the reason a content leak here fails a test rather than shipping quietly.
    """
    serialized = json.dumps(record, default=str)

    leaked = _ADDRESS.search(serialized)
    if leaked:
        raise TelemetryLeak(
            f"diagnostics record contains an address ({leaked.group()[:6]}…). "
            "Which address a user asked about is a statement about that user — "
            "record tool calls by name and outcome only."
        )

    def walk(value: Any, path: str) -> None:
        if isinstance(value, str):
            if len(value) > _MAX_STRING:
                raise TelemetryLeak(
                    f"{path} is {len(value)} chars — diagnostics carry shape, not text."
                )
        elif isinstance(value, dict):
            for key, item in value.items():
                walk(key, f"{path}.{key}")
                walk(item, f"{path}.{key}")
        elif isinstance(value, list):
            for i, item in enumerate(value):
                walk(item, f"{path}[{i}]")

    walk(record, "record")


#: The sink. One function, swappable in tests and if this ever needs to go
#: somewhere other than stdout. Not a plugin system.
_SINK: Callable[[dict[str, Any]], None] = lambda record: log.info(  # noqa: E731
    "agent.turn %s", json.dumps(record, default=str, sort_keys=True)
)


def set_sink(sink: Callable[[dict[str, Any]], None]) -> None:
    global _SINK
    _SINK = sink


def emit(diagnostics: TurnDiagnostics) -> None:
    """Emit one turn record. Never raises into the request path.

    A diagnostics failure must not fail a user's conversation — that would
    invert the whole point. A leak still fails loudly in tests, where
    `_assert_clean` is called directly.
    """
    try:
        record = diagnostics.as_record()
        _assert_clean(record)
        _SINK(record)
    except TelemetryLeak:
        # Loud, and the record is dropped rather than emitted. Losing one line
        # of diagnostics is strictly better than logging content we promised
        # not to keep.
        log.exception("telemetry.leak_blocked")
    except Exception:
        log.exception("telemetry.emit_failed")
