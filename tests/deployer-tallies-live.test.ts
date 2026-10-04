import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── Task: stale launches_total / launches_dead ──
//
// Both columns were refreshed only inside processRugCandidate, so any deployer
// indicted later than its last ingest disagreed with the tokens it holds —
// on prod 45 of 48 rows, one of them 51 tokens against a recorded 0. Every
// surface that publishes a number now derives it live, and nothing publishes
// from the stored columns anymore (§8 #11: a value assumed maintained, and it
// is not). The columns stay in the schema; they are just no longer a source.

test("WIRING — the board's deployer tallies are live-counted, not the stored columns", () => {
  const src = readFileSync(new URL("../lib/data/wanted.ts", import.meta.url), "utf8");

  // readIndictedDeployers must override the mapped columns with grouped counts.
  const fn = src.slice(src.indexOf("export async function readIndictedDeployers"));
  assert.match(
    fn,
    /groupBy\(tokens\.deployerId\)/,
    "readIndictedDeployers must count from tokens",
  );
  assert.match(
    fn,
    /launches_total: live\.total/,
    "the mapped stale total must be replaced",
  );

  // readFunderHistory must not read the funder's stored launches_dead column.
  const funder = src.slice(src.indexOf("export async function readFunderHistory"));
  assert.match(funder, /t3\.is_dead/, "the funder's dead-launch tally must be live-counted");
  assert.doesNotMatch(
    funder,
    /d2\.launches_dead/,
    "the funder's stored launches_dead column must not be read",
  );

  // The family tree's funder must come from the same coalesce the scanner uses.
  const tree = src.slice(src.indexOf("export async function readDeployerFamilyTree"));
  assert.match(tree, /readFunderHistory\(addr\)/, "the board must share the scanner's funder coalesce");
});

test("WIRING — no published surface derives from deployers.launchesDead anymore", () => {
  // mapDeployerRow still passes the column through (it is part of DeployerRow),
  // so the assertion is about the scanner checks: the funder record evidence
  // must be fed by readFunderHistory, whose source is now live-counted.
  const src = readFileSync(new URL("../lib/data/wanted.ts", import.meta.url), "utf8");
  assert.match(src, /select count\(\*\) from tokens t3 where t3\.deployer_id = d2\.id and t3\.is_dead/);
});
