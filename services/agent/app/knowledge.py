"""File-backed prose, and the startup gate that keeps it honest.

There is no vector store here on purpose. The corpus is small enough that
retrieval over it would be strictly worse than including it: an embedding
model, a chunking strategy and a staleness failure mode, bought in exchange for
dropping content the model could simply have been given.

The split is by **how often content is needed**, not by tier:

- ``core.md`` goes into every turn as a cacheable static block.
- the per-check explainers are behind the ``lookup_check`` tool, so they cost
  nothing until a specific check is under discussion.

That split exists because Anthropic prompt caches are isolated per
organization. Under BYOK every user brings their own key and therefore their
own cache, pays the cache-write premium on their first request, and — at a
five-minute TTL — never amortizes it unless they ask two questions inside the
window. An unconditional large block is only economical on the our-models path.
Splitting by frequency gives one code path with correct economics on both.

**Facts come from tools; concepts come from here.** The prose deliberately
carries no weights or thresholds, so it cannot drift out of agreement with the
engine. The coverage gate below enforces the other half of that bargain.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).parent / "knowledge"

log = logging.getLogger("agent.knowledge")


class KnowledgeGapError(RuntimeError):
    """A live check has no explainer. The agent refuses to serve."""


@dataclass(frozen=True)
class Knowledge:
    core: str
    checks: dict[str, str]

    def check(self, check_id: str) -> str | None:
        return self.checks.get(check_id.strip().lower())


def _parse_sections(markdown: str) -> dict[str, str]:
    """Split on `## <id>` headings. Everything before the first one is preamble."""
    sections: dict[str, str] = {}
    current: str | None = None
    buffer: list[str] = []

    for line in markdown.splitlines():
        heading = re.match(r"^##\s+([a-z0-9_]+)\s*$", line)
        if heading:
            if current:
                sections[current] = "\n".join(buffer).strip()
            current = heading.group(1)
            buffer = []
            continue
        if current:
            buffer.append(line)

    if current:
        sections[current] = "\n".join(buffer).strip()
    return sections


@lru_cache(maxsize=1)
def knowledge(directory: Path = KNOWLEDGE_DIR) -> Knowledge:
    core = (directory / "core.md").read_text(encoding="utf-8").strip()
    checks = _parse_sections((directory / "checks.md").read_text(encoding="utf-8"))
    return Knowledge(core=core, checks=checks)


def assert_check_coverage(methodology: dict) -> None:
    """Every check the engine can publish must have an explainer here.

    Run at startup against **live** ``get_methodology``, not against a
    build-time snapshot, so the gate reacts to the config the running system
    actually has. When check #20 ships, this refuses to boot rather than
    letting the agent answer "I have no information on that check" in
    production — a silent quality regression nobody would file a bug about.

    Extra explainers are fine (a retired check keeps its documentation). Only
    missing ones are fatal.

    ``postScoreRules`` is in this list because leaving it out is what let three
    checks ship undocumented. They are the score CAPS, and two of them are
    emitted into ``verdict.checks[]`` like any other row — so the model was
    receiving ``prior_honeypot: FAIL, weight: null, deduction: 0`` with no
    entry in ``get_methodology`` and nothing behind ``lookup_check``. The gate
    passed because it was only ever asked about two of the three groups. A gate
    that walks a subset of the thing it guards reports success about the part
    it looked at.
    """
    known = knowledge()
    live: set[str] = set()
    for group in ("criticalOverrides", "weightedChecks", "postScoreRules"):
        for entry in methodology.get(group, []) or []:
            check_id = entry.get("id")
            if check_id:
                live.add(str(check_id))

    if not live:
        # An empty methodology is a failed read dressed as a success — exactly
        # the "empty result is not a fact" trap. Passing the gate on it would
        # mean the gate silently stops existing during an outage.
        raise KnowledgeGapError(
            "get_methodology returned no checks. Refusing to treat an empty "
            "read as proof of full coverage."
        )

    missing = sorted(live - set(known.checks))
    if missing:
        raise KnowledgeGapError(
            "No explainer in app/knowledge/checks.md for live check(s): "
            + ", ".join(missing)
            + ". Add a `## <id>` section for each before deploying."
        )

    stale = sorted(set(known.checks) - live)
    if stale:
        log.info("knowledge.stale_explainers", extra={"ids": stale})
