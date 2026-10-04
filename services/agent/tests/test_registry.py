"""Referential integrity for tools.toml and personas.toml.

This is what keeps "adding a tool" at two files. Every cross-reference a human
could typo is checked here so it fails in CI rather than at runtime, where a
mis-wired tool looks like an RPC hiccup.

The checks that reach outside Python — into `lib/internal/reads.ts` and
`lib/agent/client-tools.ts` — are text scans, not imports. Deliberately crude:
a regex over a source file cannot be fooled by a stale build artifact, and this
runs in a container with no Node in it.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import pytest

from app.registry import SCAN_SENTINEL, RegistryError, load_registry, registry

REPO_ROOT = Path(__file__).resolve().parents[3]
READS_TS = REPO_ROOT / "lib" / "internal" / "reads.ts"
CLIENT_TOOLS_TS = REPO_ROOT / "lib" / "agent" / "client-tools.ts"
PARITY_SNAPSHOT = REPO_ROOT / "tests" / "fixtures" / "mcp-tools-list.snapshot.json"


def declared_reads() -> set[str]:
    """The keys of the READS object in lib/internal/reads.ts."""
    source = READS_TS.read_text(encoding="utf-8")
    body = source.split("export const READS = {", 1)[1]
    # Top-level keys only: two spaces of indent, then `name:`.
    return set(re.findall(r"^  ([a-z0-9_]+):", body, flags=re.MULTILINE))


def declared_client_executors() -> set[str]:
    source = CLIENT_TOOLS_TS.read_text(encoding="utf-8")
    body = source.split("export const CLIENT_TOOLS: Record<string, Executor> = {", 1)[1]
    # Stop at the object literal's own closing brace, or the scan runs on into
    # the rest of the file and picks up function parameters as tool names.
    body = body.split("\n};", 1)[0]
    return set(re.findall(r"^  ([a-z0-9_]+):", body, flags=re.MULTILINE))


def test_registry_loads() -> None:
    reg = registry()
    assert reg.tools, "no tools declared"
    assert reg.personas, "no personas declared"


def test_every_read_resolves_against_the_live_dispatcher() -> None:
    """A tool naming a read Next does not expose fails on every call.

    Silently, from the user's side: it looks like the lookup failed, not like
    the tool was never wired up.
    """
    available = declared_reads()
    assert available, "could not parse READS out of lib/internal/reads.ts"

    for tool in registry().tools.values():
        if tool.read is None or tool.read == SCAN_SENTINEL:
            continue
        assert tool.read in available, (
            f"tool {tool.name!r} names read {tool.read!r}, which lib/internal/reads.ts "
            f"does not export. Available: {sorted(available)}"
        )


def test_every_client_tool_has_a_browser_executor() -> None:
    """A client-locale tool with no executor fails every browser call.

    And it fails the way an RPC hiccup looks, so nobody files a bug for it.
    """
    executors = declared_client_executors()
    for tool in registry().tools.values():
        if tool.locale != "client":
            continue
        assert tool.name in executors, (
            f"tool {tool.name!r} is client-locale but lib/agent/client-tools.ts has no "
            "executor for it"
        )


def test_every_declared_executor_has_a_tool() -> None:
    """The other direction — dead browser code nobody will notice is dead."""
    names = {t.name for t in registry().tools.values()}
    for executor in declared_client_executors():
        assert executor in names, (
            f"lib/agent/client-tools.ts exports an executor for {executor!r}, which is "
            "not a declared tool"
        )


def test_cost_is_declared_on_every_tool() -> None:
    """Fail-closed metering: a missing cost must never default to free."""
    for tool in registry().tools.values():
        assert tool.cost in {"free", "cached", "fresh"}


def test_only_the_scan_route_is_cost_fresh() -> None:
    """`fresh` means "this can mint a receipt". A plain read cannot."""
    for tool in registry().tools.values():
        if tool.cost == "fresh":
            assert tool.read == SCAN_SENTINEL, (
                f"{tool.name!r} claims cost 'fresh' but is not the scan route"
            )


def test_no_chat_persona_can_reach_scan_token() -> None:
    """A chat turn must never spend fresh-scan quota or write to the ledger.

    This used to grant the Bodyguard an exception, on the reasoning that a
    persona consulted before a trade should be able to get a fresh answer. The
    exception was withdrawn once its real shape was visible: `scan_token` is
    server-locale, so a BYOK user running the whole agent loop in their own
    browser with their own model key was still spending OUR scan budget and
    appending to OUR ledger — a write, from an unauthenticated surface, that no
    one had chosen to make. Fresh scans belong to /scan, where the person
    asking for one can see what it costs.

    Asserted over every persona rather than by name, so a persona added later
    inherits the rule instead of quietly reopening the hole.
    """
    reg = registry()
    for persona in reg.personas.values():
        assert "scan_token" not in persona.allowed_tools, (
            f"persona {persona.name!r} can reach scan_token — chat cannot write to the ledger"
        )
    # And the reverse direction, since an empty `personas` list is exactly what
    # registry._validate warns becomes silently unreachable. Here it is meant.
    assert reg.tools["scan_token"].personas == frozenset()


def test_scan_token_is_still_reachable_over_mcp() -> None:
    """The other half of the rule: MCP keeps it, and keeps it deliberately.

    MCP is bearer-gated on MCP_AUTH_TOKEN and carries no persona at all, so the
    allowlist never runs there — the token IS the gate. Losing this tool would
    reduce the MCP surface to discussing tokens somebody already scanned through
    the website, so its absence would be a product regression, not a tightening.
    """
    assert registry().tools["scan_token"].exposed_over("mcp")


def test_an_internal_tool_is_never_listed_by_a_public_persona() -> None:
    """The containment rule, asserted on the real registry.

    This replaces an earlier test that asserted no persona declared a non-public
    collection at all. That was true only while no internal persona existed, and
    it was the weaker claim: it would have gone green forever by nobody ever
    adding one, and said nothing about what happens when someone does. What
    actually protects us is containment — an internal tool reachable from a
    public persona is publicly reachable, because a public persona is served to
    anyone who asks.
    """
    reg = registry()
    for persona in reg.personas.values():
        if persona.is_internal:
            continue
        leaked = sorted(t for t in persona.allowed_tools if reg.tools[t].internal)
        assert not leaked, (
            f"public persona {persona.name!r} lists internal tool(s) {leaked} — "
            "that publishes them to every unauthenticated caller"
        )


def test_internal_tools_are_withheld_from_mcp() -> None:
    """MCP calls carry no persona, so the allowlist never runs on that transport.

    The bearer is the only gate there, and the MCP token is meant to be given to
    external agents — so bearer-holder is not the same set as us. A tool that
    maps our discovery blind spots must not be one `tools/list` away.
    """
    reg = registry()
    internal = {t.name for t in reg.tools.values() if t.internal}
    assert internal, "no internal tools declared — this test would pass vacuously"
    listed = {t.name for t in reg.tools_over("mcp")}
    assert not (internal & listed)


def test_the_tracer_cannot_scan_or_write() -> None:
    """It reconciles the record; it never adds to it.

    A fresh scan mints a ledger receipt and spends the daily budget, and an
    audit persona that can rewrite the thing it is auditing produces evidence
    about itself.
    """
    tracer = registry().personas["tracer"]
    assert tracer.is_internal
    assert "scan_token" not in tracer.allowed_tools


def test_trade_assistant_has_read_only_market_and_public_research_tools() -> None:
    persona = registry().personas["trade_assistant"]
    assert "scan_token" not in persona.allowed_tools
    assert "search_token_market" in persona.allowed_tools
    assert {"web_search", "web_fetch"} <= persona.allowed_tools
    assert not any(
        tool.is_scan for tool in registry().tools.values() if tool.name in persona.allowed_tools
    )


def test_public_research_personas_handle_recent_social_posts_carefully() -> None:
    reg = registry()
    for name in ("rwa_analyst", "trade_assistant"):
        prompt = reg.personas[name].prompt.lower()
        assert "site:x.com" in prompt
        assert "post date" in prompt
        assert "couldn't verify recent posts" in prompt
        assert "claimed" in prompt
        assert "exact" in prompt and "contract" in prompt


def test_mcp_never_advertises_a_tool_it_cannot_run() -> None:
    """There is no browser behind MCP, so a client tool needs a server read."""
    for tool in registry().tools_over("mcp"):
        if tool.locale == "client":
            assert tool.read is not None


def test_parity_with_the_retired_typescript_server() -> None:
    """Every tool the old server exposed still exists, with the same inputs.

    Superset, not equality: new tools are the point. What is forbidden is a
    narrowed schema or a dropped name, because an MCP client discovers those
    only by breaking.
    """
    import json

    snapshot = json.loads(PARITY_SNAPSHOT.read_text(encoding="utf-8"))
    reg = registry()
    current = {t.name: t for t in reg.tools_over("mcp")}

    for old in snapshot["tools"]:
        name = old["name"]
        assert name in current, f"retired server exposed {name!r}; the new one does not"

        old_required = set(old["inputSchema"].get("required", []))
        new_required = set(current[name].input_schema.get("required", []))
        assert old_required == new_required, (
            f"{name!r} changed its required arguments: {sorted(old_required)} -> "
            f"{sorted(new_required)}"
        )

        old_props = set(old["inputSchema"].get("properties", {}))
        new_props = set(current[name].input_schema.get("properties", {}))
        assert old_props <= new_props, (
            f"{name!r} dropped argument(s) {sorted(old_props - new_props)}"
        )


# ── The validator itself ────────────────────────────────────────────────────


def _write(tmp_path: Path, tools: str, personas: str) -> tuple[Path, Path]:
    t = tmp_path / "tools.toml"
    p = tmp_path / "personas.toml"
    t.write_text(tools, encoding="utf-8")
    p.write_text(personas, encoding="utf-8")
    return t, p


MINIMAL_PERSONA = """
[[persona]]
name = "tester"
title = "Tester"
prompt = "test"
allowed_tools = ["thing"]
"""


def test_missing_cost_is_rejected(tmp_path: Path) -> None:
    tools, personas = _write(
        tmp_path,
        """
[[tool]]
name = "thing"
title = "Thing"
description = "d"
locale = "server"
read = "get_methodology"
personas = ["tester"]
""",
        MINIMAL_PERSONA,
    )
    with pytest.raises(RegistryError, match="cost"):
        load_registry(tools, personas)


def test_persona_naming_a_missing_tool_is_rejected(tmp_path: Path) -> None:
    tools, personas = _write(
        tmp_path,
        """
[[tool]]
name = "thing"
title = "Thing"
description = "d"
locale = "server"
read = "get_methodology"
cost = "free"
personas = ["tester"]
""",
        MINIMAL_PERSONA + '\nallowed_tools = ["thing"]\n',
    )
    # Re-declare with a typo'd tool name.
    personas.write_text(
        """
[[persona]]
name = "tester"
title = "Tester"
prompt = "test"
allowed_tools = ["thign"]
""",
        encoding="utf-8",
    )
    with pytest.raises(RegistryError, match="thign"):
        load_registry(tools, personas)


def test_tool_naming_a_missing_persona_is_rejected(tmp_path: Path) -> None:
    """The silent direction: the tool simply becomes unreachable."""
    tools, personas = _write(
        tmp_path,
        """
[[tool]]
name = "thing"
title = "Thing"
description = "d"
locale = "server"
read = "get_methodology"
cost = "free"
personas = ["tsetser"]
""",
        MINIMAL_PERSONA,
    )
    with pytest.raises(RegistryError):
        load_registry(tools, personas)


def test_one_sided_agreement_is_rejected(tmp_path: Path) -> None:
    """A persona allowing a tool the tool does not list is a real disagreement."""
    tools, personas = _write(
        tmp_path,
        """
[[tool]]
name = "thing"
title = "Thing"
description = "d"
locale = "server"
read = "get_methodology"
cost = "free"
personas = []
""",
        MINIMAL_PERSONA,
    )
    with pytest.raises(RegistryError, match="disagree"):
        load_registry(tools, personas)


def test_client_locale_without_a_read_is_rejected(tmp_path: Path) -> None:
    tools, personas = _write(
        tmp_path,
        """
[[tool]]
name = "thing"
title = "Thing"
description = "d"
locale = "client"
cost = "free"
personas = ["tester"]
""",
        MINIMAL_PERSONA,
    )
    with pytest.raises(RegistryError, match="requires a read"):
        load_registry(tools, personas)


def test_tools_toml_is_valid_toml() -> None:
    """Cheap guard against a `//` comment or an unescaped quote."""
    from app.registry import PERSONAS_PATH, TOOLS_PATH

    tomllib.loads(TOOLS_PATH.read_text(encoding="utf-8"))
    tomllib.loads(PERSONAS_PATH.read_text(encoding="utf-8"))
