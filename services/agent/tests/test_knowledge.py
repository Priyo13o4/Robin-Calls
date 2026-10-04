"""The startup coverage gate.

When a new check ships, the agent must refuse to start rather than answer "I
have no information on that check" in production — a quality regression with no
error, no alert, and nobody to file the bug.
"""

from __future__ import annotations

import pytest

from app.knowledge import KnowledgeGapError, assert_check_coverage, knowledge


def methodology(*ids: str) -> dict:
    return {"weightedChecks": [{"id": i} for i in ids], "criticalOverrides": []}


def test_the_shipped_corpus_covers_the_shipped_checks() -> None:
    """Reads the ids straight out of the repo's own formula config."""
    import re
    from pathlib import Path

    formula = (
        Path(__file__).resolve().parents[3] / "lib" / "config" / "formula.ts"
    ).read_text(encoding="utf-8")

    # Only the two groups get_methodology publishes; POST_SCORE_RULES are not
    # per-check explainers and are covered by the core prose instead.
    section = formula.split("export const CRITICAL_OVERRIDES", 1)[1]
    overrides = section.split("export const POST_SCORE_RULES", 1)[0]
    weighted = formula.split("export const WEIGHTED_CHECKS", 1)[1]
    live = set(re.findall(r'id:\s*"([a-z0-9_]+)"', overrides + weighted))

    assert live, "could not parse check ids out of lib/config/formula.ts"
    missing = sorted(live - set(knowledge().checks))
    assert not missing, f"no explainer for live check(s): {missing}"


def test_a_new_check_fails_the_gate() -> None:
    with pytest.raises(KnowledgeGapError, match="brand_new_check"):
        assert_check_coverage(methodology("lp_custody", "brand_new_check"))


def test_an_empty_methodology_fails_rather_than_passing_vacuously() -> None:
    """An empty read is not proof of full coverage — it is a failed read.

    Without this the gate would silently stop existing during an outage, which
    is exactly when a bad deploy is most likely to go out.
    """
    with pytest.raises(KnowledgeGapError, match="Refusing"):
        assert_check_coverage({})


def test_a_retired_check_keeps_its_explainer_without_failing() -> None:
    assert_check_coverage(methodology("lp_custody"))


def test_the_core_block_states_no_numbers() -> None:
    """Prose explains concepts; get_methodology supplies the values.

    Keeping numbers out is what makes it impossible for the two to disagree
    after a formula bump — and formula weights do get bumped.
    """
    import re

    core = knowledge().core
    # Strip the one legitimate numeral: the chain id.
    scrubbed = core.replace("4663", "")
    scrubbed = re.sub(r"ERC-\d+|EIP-\d+|V\d", "", scrubbed)
    numbers = re.findall(r"(?<![\w-])\d+(?:\.\d+)?%?", scrubbed)
    assert not numbers, f"core.md states numbers that could drift from the engine: {numbers}"


def test_the_coverage_gate_walks_the_post_score_rules() -> None:
    """The group that was missing from the gate, and why it mattered.

    `prior_honeypot` and `prior_pump_dump` are emitted into `verdict.checks[]`
    like any other row, carrying a null weight and a zero deduction because
    they CAP the score rather than deduct from it. With no methodology entry
    and no explainer, the only sentence available to the model about a
    permanent DANGER cap was "this check has no weight and deducted nothing".
    """
    with pytest.raises(KnowledgeGapError) as excinfo:
        assert_check_coverage(
            {
                "criticalOverrides": [{"id": "impersonation"}],
                "weightedChecks": [{"id": "lp_custody"}],
                "postScoreRules": [{"id": "a_cap_nobody_documented"}],
            }
        )
    assert "a_cap_nobody_documented" in str(excinfo.value)


def test_every_score_cap_has_an_explainer() -> None:
    """Asserted by name: these three are the ones that shipped undocumented."""
    checks = knowledge().checks
    for check_id in ("prior_honeypot", "prior_pump_dump", "active_wash_trading"):
        assert check_id in checks, f"no explainer for the {check_id!r} score cap"
        explainer = checks[check_id].lower()
        # Each must say it is a cap. An explainer that describes the mark but
        # not the ceiling leaves the same wrong conclusion available.
        assert "cap" in explainer
