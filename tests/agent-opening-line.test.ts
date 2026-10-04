import test from "node:test";
import assert from "node:assert/strict";

import { openingLineFor } from "../lib/agent/opening-line";
import type { CheckResult, CheckStatus, Verdict } from "../lib/types";

/**
 * This line is the first sentence a reader sees in the agent's voice, and it is
 * rendered before any turn is spent — so nothing here may say more than
 * `verdict.checks[]` supports. The load-bearing case is the last one: a verdict
 * that deducted nothing because nothing could be read is NOT clean (CLAUDE.md §4).
 */

function check(over: Partial<CheckResult> & { id: string; status: CheckStatus }): CheckResult {
  return {
    name: over.id.toUpperCase(),
    deduction: 0,
    weight: 10,
    reason: "",
    source: "chain",
    evidence: {},
    ...over,
  } as CheckResult;
}

function verdict(checks: CheckResult[], over: Partial<Verdict> = {}): Verdict {
  return {
    tokenAddress: "0x" + "ab".repeat(20),
    tokenName: "Feather",
    tokenSymbol: "FEATHER",
    score: 80,
    tier: "CAUTION",
    criticalOverride: null,
    scoreVersion: "1.17",
    checks,
    market: null,
    ...over,
  };
}

test("a CRITICAL leads, even when another check deducted more", () => {
  const line = openingLineFor(
    verdict([
      check({ id: "wash_trading", status: "FAIL", deduction: 41 }),
      check({ id: "honeypot", status: "CRITICAL", deduction: 0, weight: null }),
    ])
  );
  assert.equal(line.kind, "critical");
  assert.equal(line.checkId, "honeypot");
  assert.match(line.text, /HONEYPOT/);
  assert.match(line.text, /capped it outright/);
});

test("otherwise the heaviest deduction leads, and the figure matches the check", () => {
  const line = openingLineFor(
    verdict([
      check({ id: "lp_custody", status: "WARN", deduction: 9 }),
      check({ id: "wash_trading", status: "FAIL", deduction: 41 }),
      check({ id: "holders", status: "PASS" }),
    ])
  );
  assert.equal(line.kind, "deduction");
  assert.equal(line.checkId, "wash_trading");
  assert.match(line.text, /41 points off/);
  assert.match(line.prompt, /41 points/);
});

test("equal deductions break on weight, so the heavier check is named", () => {
  const line = openingLineFor(
    verdict([
      check({ id: "light", status: "WARN", deduction: 6, weight: 12 }),
      check({ id: "heavy", status: "WARN", deduction: 6, weight: 30 }),
    ])
  );
  assert.equal(line.checkId, "heavy");
});

test("a SKIP outranks a clean sweep — nothing deducted is not the same as nothing wrong", () => {
  const line = openingLineFor(
    verdict(
      [
        check({ id: "holders", status: "PASS" }),
        check({ id: "lp_custody", status: "SKIP" }),
        check({ id: "honeypot", status: "SKIP" }),
      ],
      { score: 100, tier: "CLEAR" }
    )
  );
  assert.equal(line.kind, "incomplete");
  assert.equal(line.checkId, "lp_custody");
  assert.match(line.text, /2 checks could not complete/);
  assert.match(line.text, /not the same as clean/);
  // The failure this test exists to prevent: an all-clear sentence over a pool
  // nobody could read.
  assert.doesNotMatch(line.text, /Every check ran/);
});

test("one SKIP is singular", () => {
  const line = openingLineFor(
    verdict([check({ id: "lp_custody", status: "SKIP" })], { score: 100, tier: "CLEAR" })
  );
  assert.match(line.text, /1 check could not complete/);
});

test("clean only when every check ran and none deducted", () => {
  const line = openingLineFor(
    verdict(
      [check({ id: "holders", status: "PASS" }), check({ id: "lp_custody", status: "PASS" })],
      { score: 100, tier: "CLEAR" }
    )
  );
  assert.equal(line.kind, "clean");
  assert.equal(line.checkId, null);
  assert.match(line.text, /Every check ran/);
});

test("a WARN that took points is a deduction, not a clean sweep", () => {
  const line = openingLineFor(
    verdict([check({ id: "lp_custody", status: "WARN", deduction: 9 })], { score: 91 })
  );
  assert.equal(line.kind, "deduction");
});

test("the score and tier on the line are the verdict's own", () => {
  const line = openingLineFor(verdict([check({ id: "holders", status: "PASS" })], { score: 73, tier: "CAUTION" }));
  assert.match(line.text, /scores 73 — CAUTION/);
});

test("no symbol falls back to the name, then to a neutral subject", () => {
  const named = openingLineFor(
    verdict([check({ id: "holders", status: "PASS" })], { tokenSymbol: "  ", tokenName: "Feather" })
  );
  assert.match(named.text, /^Feather scores/);

  const anonymous = openingLineFor(
    verdict([check({ id: "holders", status: "PASS" })], { tokenSymbol: null, tokenName: null })
  );
  assert.match(anonymous.text, /^This token scores/);
});

test("a verdict with no checks at all does not claim everything ran", () => {
  // Not reachable through the pipeline today, but the clean branch is the
  // default arm — so it must not turn an empty list into an all-clear.
  const line = openingLineFor(verdict([]));
  assert.equal(line.kind, "empty");
  assert.match(line.text, /no checks/i);
});
