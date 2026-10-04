import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── KNOWN-PROBLEMS L194 ──
//
// `assembleRugCandidatesData` runs three nomination queries, each with its own
// `limit`, then cuts the union back to one `limit`. The union was built in
// source order — Watch rows, then honeypot marks, then recorded pulls — so with
// enough Watch rows the whole budget goes to criterion C, which is RETIRED as an
// indictment source, and criteria A and B are cut entirely.
//
// Criterion A is the one that hurts: it exists because "a deployer who pulled
// once, cleanly, was nominated by nothing at all", and it was last in line.
//
// §8 #18: a capped list must be ranked by the quantity that decides the outcome
// before it is sliced, and what it drops must be reported.

const DATA = readFileSync(new URL("../lib/data/wanted.ts", import.meta.url), "utf8");
const PRODUCER = readFileSync(new URL("../lib/wanted/producer.ts", import.meta.url), "utf8");

/** The union expression that feeds the cut, isolated so order can be read off it. */
function nominationUnion(): string {
  const start = DATA.indexOf("const nominated = [");
  assert.ok(start > 0, "guard: the nomination union must still be found by this test");
  const end = DATA.indexOf("];", start);
  assert.ok(end > start, "guard: the union must be a readable array literal");
  return DATA.slice(start, end);
}

test("L194 the strongest nomination is ranked first, not the one written first", () => {
  const union = nominationUnion();
  const pulls = union.indexOf("pullRows");
  const marks = union.indexOf("markRows");
  const watch = union.indexOf("watchRows");

  assert.ok(pulls > 0 && marks > 0 && watch > 0, "all three sources must appear in the union");
  assert.ok(
    pulls < marks,
    "a recorded pull (criterion A) is direct evidence and must outrank a honeypot mark",
  );
  assert.ok(
    marks < watch,
    "a standing honeypot mark (B) must outrank a drain-only Watch row (C), which is retired as an indictment source",
  );
});

test("L194 what the cut drops is counted, never silent", () => {
  assert.match(
    DATA,
    /const nominationsTruncated = nominated\.length - candidateAddrs\.length;/,
    "the data layer must measure what it cut",
  );
  // Every return path of the data function carries it, or the count is absent
  // exactly on the paths that cut the most (§8 #9: a missing field reads as 0).
  const fnStart = DATA.indexOf("export async function assembleRugCandidatesData");
  const fnEnd = DATA.indexOf("\nexport ", fnStart + 10);
  const body = DATA.slice(fnStart, fnEnd === -1 ? undefined : fnEnd);
  // Located by index rather than by a balanced-brace regex: the objects here
  // nest, and a regex that quietly matches one of three is how an extraction
  // test passes while asserting almost nothing (§8 #22).
  const starts: number[] = [];
  for (let i = body.indexOf("return {"); i !== -1; i = body.indexOf("return {", i + 1)) {
    starts.push(i);
  }
  assert.equal(starts.length, 3, `guard: expected three return paths, found ${starts.length}`);
  for (const i of starts) {
    const window = body.slice(i, i + 600);
    assert.match(
      window,
      /nominationsTruncated/,
      `a return path omits the count:\n${window.slice(0, 120)}`,
    );
  }
});

test("L194 the count reaches an operator, through the producer and the job", () => {
  assert.match(
    PRODUCER,
    /nominationsTruncated: number;/,
    "the assembly must expose it beside `skipped`, the existing never-silent vocabulary",
  );
  assert.match(
    PRODUCER,
    /data\.nominationsTruncated \+ Math\.max\(0, evidence\.size - tokens\.length\)/,
    "and it must add the producer's own second cut, not just report the data layer's",
  );
  const route = readFileSync(
    new URL("../app/api/jobs/wanted-ingest/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /^\s*nominationsTruncated,$/m, "the job must log it");
});

test("L194 the honeypot-mark query is ordered, so the same run twice picks the same marks", () => {
  const q = DATA.slice(DATA.indexOf(".from(tokenMarks)"), DATA.indexOf(".from(tokenMarks)") + 400);
  assert.match(
    q,
    /\.orderBy\([^)]*tokenMarks\.createdAt[^)]*\)[\s\S]{0,80}\.limit\(limit\)/,
    "an unordered LIMIT lets the planner decide which marks reach the board",
  );
});
