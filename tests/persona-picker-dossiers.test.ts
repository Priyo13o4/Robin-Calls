import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * The persona "i" panels.
 *
 * `personas.toml` is the source of truth — the picker only renders what
 * `GET /agent/config` serves — so the copy tables in PersonaPicker.tsx are
 * pinned against that file rather than against each other. A persona added
 * server-side otherwise falls through to the generic fallback in silence,
 * which is exactly the kind of drift nobody notices until a user reads it.
 */

const TOML = readFileSync("services/agent/app/personas.toml", "utf8");
const PICKER = readFileSync("app/components/agent/PersonaPicker.tsx", "utf8");

/** name -> collection, straight out of the toml's `[[persona]]` blocks. */
function personasFromToml(): { name: string; collection: string }[] {
  return TOML.split(/^\[\[persona\]\]$/m)
    .slice(1)
    .map((block) => ({
      name: /^name = "([^"]+)"/m.exec(block)?.[1] ?? "",
      collection: /^collection = "([^"]+)"/m.exec(block)?.[1] ?? "",
    }))
    .filter((p) => p.name);
}

/** Keys of a `const X: Record<string, string> = { … }` table in the picker. */
function tableKeys(name: string): string[] {
  const start = PICKER.indexOf(`const ${name}: Record<string, string> = {`);
  assert.notEqual(start, -1, `${name} table not found in PersonaPicker.tsx`);
  const body = PICKER.slice(start, PICKER.indexOf("\n};", start));
  return [...body.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

const publicPersonas = personasFromToml().filter((p) => p.collection === "public");

test("the toml still parses into the personas we think it has", () => {
  assert.ok(publicPersonas.length >= 5, "expected at least five public personas");
  assert.ok(publicPersonas.some((p) => p.name === "interrogator"));
});

test("every public persona has a dossier behind its i", () => {
  const keys = tableKeys("DOSSIERS");
  for (const p of publicPersonas) {
    assert.ok(keys.includes(p.name), `persona "${p.name}" has no DOSSIERS entry`);
  }
});

test("every public persona still has a card blurb", () => {
  const keys = tableKeys("BLURBS");
  for (const p of publicPersonas) {
    assert.ok(keys.includes(p.name), `persona "${p.name}" has no BLURBS entry`);
  }
});

// An internal persona reaches the picker only for a caller holding
// MCP_AUTH_TOKEN, so it is deliberately NOT required to have copy — but the
// fallback has to exist, or it renders `undefined` and InfoTooltip vanishes.
test("a persona with no copy falls back rather than rendering nothing", () => {
  assert.match(PICKER, /DOSSIERS\[persona\.name\] \?\? "/);
  assert.match(PICKER, /BLURBS\[persona\.name\] \?\? "/);
});

/**
 * The doctrine this file already had for BLURBS, now load-bearing for the
 * longer copy too: capability is DERIVED from the allowlist, never written
 * down. A hand-written "cannot run a fresh scan" is true until a persona
 * regains the tool, and then the server contradicts our own UI.
 */
test("no dossier asserts a capability in prose", () => {
  const start = PICKER.indexOf("const DOSSIERS: Record<string, string> = {");
  const body = PICKER.slice(start, PICKER.indexOf("\n};", start));
  for (const phrase of ["cannot ", "can run", "can scan", "is allowed", "read-only", "reads only"]) {
    assert.ok(
      !body.toLowerCase().includes(phrase),
      `DOSSIERS contains the capability claim "${phrase}" — derive it in capabilityClause instead`
    );
  }
});

test("the capability clause is built from the allowlist, not from copy", () => {
  assert.match(PICKER, /function capabilityClause\(persona: PersonaSummary\)/);
  // It must read the persona's own tools, and decide on SCAN_TOOL membership.
  const start = PICKER.indexOf("function capabilityClause(");
  const body = PICKER.slice(start, PICKER.indexOf("\n}", start));
  assert.match(body, /persona\.tools\.length/);
  assert.match(body, /persona\.tools\.includes\(SCAN_TOOL\)/);
});

/**
 * InfoTooltip renders a real <button>. The persona card is also a button, and
 * a button inside a button is invalid HTML whose inner click never fires — the
 * picker would stop changing personas. Pin that they are siblings.
 */
test("the persona i is a sibling of the card button, never nested inside it", () => {
  const start = PICKER.indexOf("{personas.map((persona) => {");
  const cell = PICKER.slice(start, PICKER.indexOf("})}", start));
  const closeButton = cell.lastIndexOf("</button>");
  const tooltip = cell.indexOf("<InfoTooltip");
  assert.ok(closeButton !== -1 && tooltip !== -1);
  assert.ok(
    tooltip > closeButton,
    "InfoTooltip is inside the persona <button> — nested buttons break the click"
  );
});

/**
 * Stacking. The panel overhangs neighbouring cards by design, so it has to
 * paint above them — and it did not: every cell carried the same `z-30`, which
 * both CAPPED the panel inside its own cell and let the cards after it in DOM
 * order win the tie. Reported from the live page: the Auditor's badge punched
 * through the Interrogator's open panel.
 *
 * The fix belongs to the trigger, not the cell — so assert both halves.
 */
test("the persona cell sets no z-index of its own", () => {
  const start = PICKER.indexOf("{personas.map((persona) => {");
  const cell = PICKER.slice(start, PICKER.indexOf("})}", start));
  const wrapper = /<span className={`absolute ([^`]*)`}>/.exec(cell)?.[1] ?? "";
  assert.ok(
    !/\bz-\d/.test(wrapper),
    `the tooltip cell declares a z-index (${wrapper}) — that caps the panel inside the cell and lets later cards paint over it`
  );
});

test("InfoTooltip raises its own trigger while open, and only while open", () => {
  const tip = readFileSync("app/components/ui/InfoTooltip.tsx", "utf8");
  assert.match(
    tip,
    /className={`relative inline-flex \$\{open \? "z-50" : ""\}`}/,
    "the trigger must carry the raised z-index, conditionally on open"
  );
});
