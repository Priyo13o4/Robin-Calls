"""Citation-or-silence.

The failure this guards against is specific: RobinCalls sells a deterministic,
re-derivable verdict, and a chatbot attaching an invented score to that promise
is worse than having no chatbot. So the tests below are mostly about the
*invention* case, and a few about not being so aggressive that ordinary English
stops surviving.
"""

from __future__ import annotations

from app.citations import Citations, validate


def cited(*payloads: object) -> Citations:
    c = Citations()
    for p in payloads:
        c.add_result(p)
    return c


def test_a_supported_number_survives() -> None:
    c = cited({"ok": True, "value": {"score": 72, "tier": "CAUTION"}})
    result = validate("The score is 72, which places it in CAUTION.", c)
    assert result.clean
    assert "72" in result.text


def test_an_invented_number_is_stripped() -> None:
    c = cited({"ok": True, "value": {"score": 72}})
    result = validate("The score is 72. Liquidity is $48,300.", c)
    assert not result.clean
    assert "48,300" not in result.text
    assert "72" in result.text


def test_a_number_nested_deep_in_a_result_counts() -> None:
    """Harvesting from serialized JSON means new tool shapes are covered free."""
    c = cited({"value": {"checks": [{"id": "lp_custody", "evidence": {"sharePct": 61.4}}]}})
    assert validate("The controlling wallet holds 61.4% of that pool.", c).clean


def test_rounding_is_allowed() -> None:
    c = cited({"value": {"liquidityUsd": 48317.44}})
    assert validate("Liquidity is about $48,317.", c).clean


def test_a_different_number_is_not_rounding() -> None:
    c = cited({"value": {"liquidityUsd": 48317.44}})
    assert not validate("Liquidity is about $91,000.", c).clean


def test_small_counts_in_prose_are_left_alone() -> None:
    """Otherwise ordinary English gets shredded and nothing is gained."""
    c = cited({"value": {"score": 72}})
    result = validate("There are 3 things worth noting here. The score is 72.", c)
    assert result.clean


def test_the_chain_id_is_always_allowed() -> None:
    assert validate("Robinhood Chain is chain id 4663.", cited({})).clean


def test_addresses_and_hashes_are_not_numeric_claims() -> None:
    """Hex identifiers are not measurements; their digits must not read as claims."""
    c = cited({"value": {"deployer": "0xa4f8c19d5b7e2103fa9c8b6d4e1f0273a5c9d8b6"}})
    result = validate(
        "The deployer is 0xa4f8c19d5b7e2103fa9c8b6d4e1f0273a5c9d8b6 on this chain.", c
    )
    assert result.clean


def test_an_all_invented_reply_becomes_a_refusal() -> None:
    """Empty text would read as a glitch. A refusal reads as a refusal."""
    result = validate("The score is 91 and liquidity is $250,000.", cited({}))
    assert not result.clean
    assert "can't answer" in result.text


def test_prose_with_no_numbers_is_untouched() -> None:
    text = "The deployer has no confirmed rugs on record, which is not the same as clean."
    assert validate(text, cited({})).text == text


def test_a_transient_failure_payload_does_not_license_claims() -> None:
    """An outage payload carries no findings, so nothing in it supports a score."""
    c = cited({"ok": False, "transient": True, "code": "RC_AGENT_UPSTREAM_TIMEOUT"})
    assert not validate("The score is 88.", c).clean


# ── Identifiers are not measurements (2026-08-06) ───────────────────────────
#
# From a live export: the Robin Knight was asked to explain proxy patterns, a
# general-knowledge question that calls no tools, so every number in the answer
# was "unsupported". Two defects fired together — `_ALWAYS_ALLOWED` happened to
# list 1967/20/721/1155, so exactly four standards were sayable and EIP-1167 and
# EIP-2535 were censored; and the splitter treated a heading plus its bullets as
# one sentence, so one bad token deleted the whole section. The user's export
# ends at a bare "### 4.".
#
# Mirrored in tests/agent-citations-identifiers.test.ts — the BYOK path runs the
# TypeScript port and the two must not drift.

SECTIONS = """### 3. Minimal Proxy / Clone Pattern (EIP-1167)
*   **How it works:** A fixed-size contract that delegatecalls to one implementation.

### 4. Diamond Pattern (EIP-2535)
*   **How it works:** Many facets behind one address, routed per selector."""


def test_standards_versions_and_type_names_are_identifiers():
    result = validate(
        "A proxy may follow EIP-1167, EIP 2535, ERC-4626 or ERC20, compiled with "
        "v0.8.28+commit.7893614a, returning uint256 and bytes32 on Uniswap v3.",
        Citations(),
    )
    assert result.stripped == []


def test_a_whole_markdown_section_is_not_deleted_for_one_number():
    result = validate(SECTIONS, Citations())
    assert result.stripped == []
    assert "EIP-2535" in result.text
    assert "routed per selector" in result.text


def test_markdown_structure_survives_the_rejoin():
    # The rejoin used to normalise every separator to a single space, so a
    # passing answer still rendered as one run-on paragraph.
    result = validate(SECTIONS, Citations())
    assert "\n" in result.text
    assert result.text.startswith("### 3.")
    assert any(line.strip().startswith("*") for line in result.text.splitlines())


def test_an_uncited_figure_still_dies_and_costs_one_line():
    text = (
        "### 1. Custody\n"
        "*   The pool is held by a locker contract.\n"
        "*   It holds 77.4% of the supply.\n"
        "*   The locker is permanent."
    )
    result = validate(text, Citations())
    assert len(result.stripped) == 1
    assert "77.4" in result.stripped[0]
    assert "77.4" not in result.text
    assert "held by a locker contract" in result.text
    assert "locker is permanent" in result.text


def test_a_cited_figure_is_still_allowed_through():
    citations = Citations()
    citations.add_result({"evidence": {"whalePct": 77.4}})
    assert validate("The pool holds 77.4% of supply.", citations).stripped == []


def test_an_erc_number_cannot_smuggle_a_verdict_figure_past():
    result = validate("Under ERC-20 the pool holds 93.2% of supply.", Citations())
    assert len(result.stripped) == 1
    assert "93.2" in result.stripped[0]
