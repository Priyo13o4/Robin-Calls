"""The error-code registry must agree across both languages.

`lib/observability/codes.ts` is the authoritative registry — PRD §20.2 says
every reportable failure carries one code *from that file*, so dashboards,
alerts and tests match on identity instead of on message strings. The Python
plane emits its own codes, and nothing in the type system connects the two.

Both drift directions are real and neither announces itself:

- A code Python emits that `codes.ts` does not know cannot be looked up by
  whoever finds it in a container log, and does not resolve to a category or
  severity when it reaches `app_error_events`.
- A code in `codes.ts` that nothing emits is dead vocabulary that reads as
  coverage — which is how `RC_AGENT_FAULT` was added, never wired to anything,
  and would have sat there looking like instrumentation.
"""

from __future__ import annotations

import re
from pathlib import Path

from app import codes

CODES_TS = Path(__file__).resolve().parents[3] / "lib" / "observability" / "codes.ts"


def declared_in_typescript() -> set[str]:
    source = CODES_TS.read_text(encoding="utf-8")
    body = source.split("export const ERROR_CODES = {", 1)[1]
    return set(re.findall(r"^  (RC_AGENT_[A-Z_]+):", body, flags=re.MULTILINE))


def emitted_in_python() -> set[str]:
    """Scan the source, not `codes.ALL` — that would only prove it agrees with
    itself. A literal written inline somewhere is exactly what this catches."""
    found: set[str] = set()
    for path in (Path(__file__).resolve().parents[1] / "app").glob("*.py"):
        found |= set(re.findall(r'"(RC_AGENT_[A-Z_]+)"', path.read_text(encoding="utf-8")))
    return found


def test_every_python_code_is_in_the_typescript_registry() -> None:
    missing = sorted(emitted_in_python() - declared_in_typescript())
    assert not missing, (
        f"emitted by services/agent but absent from lib/observability/codes.ts: {missing}. "
        "Codes are append-only — add them there rather than renaming here."
    )


def test_every_agent_code_in_the_registry_is_emitted() -> None:
    dead = sorted(declared_in_typescript() - emitted_in_python())
    assert not dead, (
        f"declared in lib/observability/codes.ts but emitted nowhere: {dead}. "
        "Dead vocabulary reads as instrumentation that does not exist."
    )


def test_codes_all_matches_what_the_source_actually_emits() -> None:
    """`codes.ALL` is what the cross-language check is written against."""
    assert emitted_in_python() == codes.ALL


def test_no_module_writes_a_bare_code_literal() -> None:
    """Everything routes through `codes.py`, so there is one place to edit."""
    app_dir = Path(__file__).resolve().parents[1] / "app"
    offenders = [
        path.name
        for path in app_dir.glob("*.py")
        if path.name != "codes.py"
        and re.search(r'"RC_AGENT_[A-Z_]+"', path.read_text(encoding="utf-8"))
    ]
    assert not offenders, f"bare RC_AGENT_* literal in: {offenders}; import from app.codes"
