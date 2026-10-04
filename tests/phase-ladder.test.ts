import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PHASES, currentLivePhase, phase, phaseLabel } from "../lib/config/phases";

/**
 * The phase ladder used to live in five places at once — `FEATURE_TOUR`,
 * `RoadmapData`, `LoadingScreen`, `/compare`, and the tokenomics copy — and all
 * five disagreed. Two were wrong in ways nobody noticed for weeks: the roadmap
 * listed the Robin Knight as *coming soon* while it was live in production, and
 * both the landing page and the roadmap advertised a bot-swarm detector with
 * zero implementation behind it.
 *
 * Centralising it fixes today. This test is what stops it happening again: a
 * hardcoded "PHASE 2" anywhere under `app/` is a sixth source of truth being
 * born, and it would render perfectly while saying something false.
 */

const ROOT = join(import.meta.dirname, "..");

/**
 * Lines that will actually be RENDERED — comments stripped.
 *
 * The first version of this test tested `line.trim().startsWith("//")`, which
 * misses every continuation line of a block comment and every `{/* … *\/}` JSX
 * comment that wraps. It then reported six offenders of which four were prose
 * in comments explaining this very ladder — a check that cries wolf gets
 * muted, so it needs the state machine rather than the heuristic.
 */
function renderedLines(source: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  let inBlock = false;
  source.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    // Strip any complete comments on the line, then detect an unterminated one.
    line = line.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/, " ");
    const open = line.indexOf("/*");
    if (open !== -1) {
      inBlock = true;
      line = line.slice(0, open);
    }
    if (line.trim()) out.push({ line, n: i + 1 });
  });
  return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

test("phase ladder: no surface hardcodes a phase label", () => {
  // Matches PHASE 1 / Phase 2a / PHASE II / Phase 1.5 in rendered strings.
  //
  // The `i` flag is not cosmetic: the first version wrote `[Pp]hase`, which
  // matches "Phase" and "phase" but NOT the SCREAMING CASE this design system
  // uses for every label — so it walked straight past `PHASE II INTELLIGENCE`,
  // the single most visible hardcoded phase string on the site.
  const HARDCODED = /(?:^|[^A-Za-z])phase\s*(?:[0-9]+(?:\.[0-9]+)?[ab]?|I{1,3}V?|IV)\b/i;

  const offenders: string[] = [];
  for (const file of sourceFiles(join(ROOT, "app"))) {
    const rel = file.slice(ROOT.length + 1);
    for (const { line, n } of renderedLines(readFileSync(file, "utf8"))) {
      if (HARDCODED.test(line)) offenders.push(`${rel}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "phase labels must come from lib/config/phases.ts, not be written inline:\n" +
      offenders.join("\n")
  );
});

test("phase ladder: labels and ids are unique", () => {
  assert.equal(new Set(PHASES.map((p) => p.id)).size, PHASES.length, "duplicate phase id");
  assert.equal(
    new Set(PHASES.map((p) => p.label)).size,
    PHASES.length,
    "two phases sharing a label makes the ladder unreadable"
  );
});

test("phase ladder: every phase is reachable by id and throws on an unknown one", () => {
  for (const p of PHASES) {
    assert.equal(phase(p.id).label, p.label);
    assert.equal(phaseLabel(p.id), p.label);
  }
  // @ts-expect-error — deliberately passing an id the union forbids.
  assert.throws(() => phase("swarm"), /unknown phase id/);
});

test("phase ladder: statuses are ordered — nothing live sits after something planned", () => {
  // The ladder is read top-to-bottom on the roadmap. A `live` entry below a
  // `planned` one would tell a reader the roadmap runs backwards.
  const rank = { live: 0, next: 1, planned: 2 } as const;
  const ranks = PHASES.map((p) => rank[p.status]);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(
      ranks[i] >= ranks[i - 1],
      `${PHASES[i].label} (${PHASES[i].status}) follows ${PHASES[i - 1].label} (${PHASES[i - 1].status})`
    );
  }
});

test("phase ladder: currentLivePhase is the furthest shipped phase", () => {
  const live = PHASES.filter((p) => p.status === "live");
  assert.ok(live.length > 0, "something must be live — the site is in production");
  assert.equal(currentLivePhase().id, live[live.length - 1].id);
});

test("phase ladder: the swarm detector is not advertised anywhere", () => {
  // It has no implementation (docs/ways-of-work/plan/swarm-detector/PRD.md).
  // The landing page's "The sniper swarm" card describes the THREAT and is
  // deliberately kept, so match only claims to detect or track it.
  const CLAIM = /(swarm|bot)[\s-]*(detection|detector|tracking|tracker)/i;
  const offenders: string[] = [];
  for (const file of sourceFiles(join(ROOT, "app"))) {
    const rel = file.slice(ROOT.length + 1);
    for (const { line, n } of renderedLines(readFileSync(file, "utf8"))) {
      if (CLAIM.test(line)) offenders.push(`${rel}:${n}  ${line.trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(offenders, [], "unbacked capability claim:\n" + offenders.join("\n"));
});
