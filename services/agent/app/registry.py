"""Loads tools.toml and personas.toml, and validates every cross-reference.

This is what keeps "add a tool" at two files. There is no codegen and no
generated model layer: the ``input`` table in tools.toml becomes a pydantic
model at import time, which becomes the MCP ``inputSchema``. One declaration,
three consumers.

The validation is a test, not a layer (implementation-plan §5). It runs at
import so a typo cannot reach production, and ``tests/test_registry.py`` calls
the same function so a typo cannot reach a merge either.

Tool *outputs* are deliberately unvalidated. An LLM consumes them and handles
arbitrary JSON; a schema there would buy nothing and would create a drift class
between what Next returns and what we declared it returns.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

APP_DIR = Path(__file__).parent
TOOLS_PATH = APP_DIR / "tools.toml"
PERSONAS_PATH = APP_DIR / "personas.toml"

Locale = Literal["server", "client", "local"]
Cost = Literal["free", "cached", "fresh"]
View = Literal["full", "summary"]

VALID_LOCALES: set[str] = {"server", "client", "local"}
VALID_COSTS: set[str] = {"free", "cached", "fresh"}
VALID_VIEWS: set[str] = {"full", "summary"}

#: The scan route rather than a read — the one legal `read` value that is not a
#: lib/internal/reads.ts key.
SCAN_SENTINEL = "@scan"

#: `input` value -> (JSON Schema fragment, description). Deliberately tiny:
#: every argument this system takes is an address, an integer or a short
#: string, and a richer type language here would be a layer earning nothing.
_TYPES: dict[str, dict[str, Any]] = {
    "address": {
        "type": "string",
        "pattern": "^0x[a-fA-F0-9]{40}$",
        "description": "A Robinhood Chain address (0x + 40 hex).",
    },
    "integer": {"type": "integer"},
    "string": {"type": "string"},
}


class RegistryError(RuntimeError):
    """A cross-reference in tools.toml or personas.toml does not resolve."""


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    locale: Locale
    cost: Cost
    view: View
    read: str | None
    personas: frozenset[str]
    input_schema: dict[str, Any]
    #: Reachable only by an internal persona, and never listed over MCP.
    internal: bool = False

    @property
    def is_scan(self) -> bool:
        return self.read == SCAN_SENTINEL

    @property
    def billable(self) -> bool:
        """`free` tools never draw down credits; the other two do."""
        return self.cost != "free"

    def exposed_over(self, transport: Literal["mcp", "chat"]) -> bool:
        """Never expose a tool over a transport that cannot execute it (§7).

        Over MCP there is no browser, so a client-locale tool is executed from
        our own pool via its ``read`` — which is exactly why ``read`` is
        mandatory for that locale.

        Internal tools are withheld from MCP entirely, and the reason is worth
        stating: MCP calls carry no persona (``persona=None``), so the allowlist
        does not run on that transport at all — the bearer is the only gate. The
        MCP token is meant to be handed to external agents (that is ring 1,
        "works with Claude/Cursor"), so bearer-holder is not the same set as
        *us*. A tool that maps our discovery blind spots must not be one
        directory listing away.
        """
        if transport == "mcp":
            if self.internal:
                return False
            return self.locale != "client" or self.read is not None
        return True


@dataclass(frozen=True)
class Persona:
    name: str
    title: str
    collection: str
    prompt: str
    allowed_tools: frozenset[str]

    @property
    def is_internal(self) -> bool:
        """Anything but the public collection requires an authenticated caller.

        Phrased as "not public" rather than "== internal" so that adding a third
        collection later fails closed: a new collection nobody remembered to
        gate is private by default, not exposed by default.
        """
        return self.collection != "public"


@dataclass(frozen=True)
class Registry:
    server_name: str
    server_version: str
    instructions: str
    tools: dict[str, Tool]
    personas: dict[str, Persona]

    def tool(self, name: str) -> Tool:
        try:
            return self.tools[name]
        except KeyError:
            raise RegistryError(f"unknown tool {name!r}") from None

    def tools_for(self, persona: str) -> list[Tool]:
        p = self.personas.get(persona)
        if p is None:
            raise RegistryError(f"unknown persona {persona!r}")
        return [self.tools[n] for n in sorted(p.allowed_tools)]

    def tools_over(self, transport: Literal["mcp", "chat"]) -> list[Tool]:
        return [t for t in self.tools.values() if t.exposed_over(transport)]


def _build_input_schema(name: str, spec: dict[str, Any]) -> dict[str, Any]:
    """`{arg = "type"}` -> JSON Schema. A trailing `?` marks it optional."""
    properties: dict[str, Any] = {}
    required: list[str] = []
    for raw_arg, type_name in spec.items():
        optional = raw_arg.endswith("?")
        arg = raw_arg[:-1] if optional else raw_arg
        base = type_name[:-1] if type_name.endswith("?") else type_name
        if base not in _TYPES:
            raise RegistryError(
                f"tool {name!r}: argument {arg!r} has unknown type {base!r}; "
                f"valid types are {sorted(_TYPES)}"
            )
        properties[arg] = dict(_TYPES[base])
        if not optional and not type_name.endswith("?"):
            required.append(arg)
    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        schema["required"] = required
    return schema


def _require(table: dict[str, Any], key: str, where: str) -> Any:
    if key not in table:
        raise RegistryError(f"{where}: missing required field {key!r}")
    return table[key]


def load_registry(
    tools_path: Path = TOOLS_PATH, personas_path: Path = PERSONAS_PATH
) -> Registry:
    tools_doc = tomllib.loads(tools_path.read_text(encoding="utf-8"))
    personas_doc = tomllib.loads(personas_path.read_text(encoding="utf-8"))

    server = tools_doc.get("server", {})
    tools: dict[str, Tool] = {}

    for entry in tools_doc.get("tool", []):
        name = _require(entry, "name", "tool")
        where = f"tool {name!r}"
        if name in tools:
            raise RegistryError(f"{where}: duplicate tool name")

        locale = _require(entry, "locale", where)
        if locale not in VALID_LOCALES:
            raise RegistryError(f"{where}: locale {locale!r} not in {sorted(VALID_LOCALES)}")

        # Fail-closed on cost: a tool that forgets to declare it must not
        # default to free and start giving away fresh scans (§10).
        cost = _require(entry, "cost", where)
        if cost not in VALID_COSTS:
            raise RegistryError(f"{where}: cost {cost!r} not in {sorted(VALID_COSTS)}")

        view = entry.get("view", "full")
        if view not in VALID_VIEWS:
            raise RegistryError(f"{where}: view {view!r} not in {sorted(VALID_VIEWS)}")

        read = entry.get("read")
        if locale == "local":
            if read is not None:
                raise RegistryError(f"{where}: locale 'local' must not declare a read")
        elif not read:
            raise RegistryError(f"{where}: locale {locale!r} requires a read")

        if entry.get("cost") == "fresh" and read != SCAN_SENTINEL:
            raise RegistryError(
                f"{where}: cost 'fresh' is reserved for the scan route "
                f"({SCAN_SENTINEL}); a read cannot mint a receipt"
            )

        tools[name] = Tool(
            name=name,
            title=_require(entry, "title", where),
            description=_require(entry, "description", where).strip(),
            locale=locale,
            cost=cost,
            view=view,
            read=read,
            personas=frozenset(entry.get("personas", [])),
            input_schema=_build_input_schema(name, entry.get("input", {})),
            internal=bool(entry.get("internal", False)),
        )

    personas: dict[str, Persona] = {}
    for entry in personas_doc.get("persona", []):
        name = _require(entry, "name", "persona")
        where = f"persona {name!r}"
        if name in personas:
            raise RegistryError(f"{where}: duplicate persona name")
        personas[name] = Persona(
            name=name,
            title=_require(entry, "title", where),
            collection=entry.get("collection", "public"),
            prompt=_require(entry, "prompt", where).strip(),
            allowed_tools=frozenset(_require(entry, "allowed_tools", where)),
        )

    _validate(tools, personas)

    return Registry(
        server_name=server.get("name", "robincalls"),
        server_version=server.get("version", "2.0.0"),
        instructions=server.get("instructions", "").strip(),
        tools=tools,
        personas=personas,
    )


def _validate(tools: dict[str, Tool], personas: dict[str, Persona]) -> None:
    """Every cross-reference resolves, in both directions.

    Both directions matter and for different reasons. A persona naming a
    missing tool fails loudly at boot. A tool naming a missing persona fails
    *silently* — it simply becomes unreachable, and nobody notices a tool that
    was never called.
    """
    errors: list[str] = []

    for tool in tools.values():
        for persona_name in sorted(tool.personas):
            if persona_name not in personas:
                errors.append(
                    f"tool {tool.name!r} lists persona {persona_name!r}, which does not exist"
                )
        # A client-locale tool needs a browser executor. We cannot see
        # lib/agent/client-tools.ts from here, so tests/test_registry.py greps
        # it; this catches only the half that is visible in Python.
        if tool.locale == "client" and tool.read is None:
            errors.append(
                f"tool {tool.name!r} is client-locale with no read — it would be "
                "invisible over MCP with no way to run it"
            )

    for persona in personas.values():
        for tool_name in sorted(persona.allowed_tools):
            if tool_name not in tools:
                errors.append(
                    f"persona {persona.name!r} allows tool {tool_name!r}, which does not exist"
                )
                continue
            if persona.name not in tools[tool_name].personas:
                errors.append(
                    f"persona {persona.name!r} allows {tool_name!r} but that tool does not "
                    "list the persona — the two files disagree"
                )
            # The containment rule, checked at boot rather than trusted to
            # review: an internal tool reachable from a public persona is
            # publicly reachable, full stop. `/agent/persona/{name}` and
            # `/agent/chat` gate on the persona's collection, so a public
            # persona is exactly "anyone on the internet", and the enforcement
            # in dispatch.py would never even be consulted.
            if tools[tool_name].internal and not persona.is_internal:
                errors.append(
                    f"persona {persona.name!r} is public but allows internal tool "
                    f"{tool_name!r} — that publishes it to anyone"
                )

    if errors:
        raise RegistryError(
            "tools.toml / personas.toml do not agree:\n  - " + "\n  - ".join(errors)
        )


@lru_cache(maxsize=1)
def registry() -> Registry:
    return load_registry()
