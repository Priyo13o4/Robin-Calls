import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimKey, reasonsRetracted } from "../lib/data/wanted";

// L177: figure-only changes in reason strings must not trigger hourly rug row churn.

test("claimKey: $14,240 and $13,207 'still trapped' sentences give the same key", () => {
  const trapped1 = "Confirmed honeypot: buyers could not sell, and $14,240 of liquidity is still trapped in the pool.";
  const trapped2 = "Confirmed honeypot: buyers could not sell, and $13,207 of liquidity is still trapped in the pool.";
  assert.equal(claimKey(trapped1), claimKey(trapped2));
  assert.equal(claimKey(trapped1), "Confirmed honeypot: buyers could not sell, and $N of liquidity is still trapped in the pool.");
});

test("claimKey: 'still trapped' vs 'while liquidity was present' give different keys", () => {
  const trapped = "Confirmed honeypot: buyers could not sell, and $14,240 of liquidity is still trapped in the pool.";
  const drained = "Confirmed honeypot: buyers could not sell while liquidity was present.";
  assert.notEqual(claimKey(trapped), claimKey(drained));
});

test("claimKey: criterion A sentence with two figures normalises both", () => {
  const criterionA = "Deployer pulled controlled liquidity (1 tx) and the pool collapsed from $16,861 to $0.";
  assert.equal(claimKey(criterionA), "Deployer pulled controlled liquidity (1 tx) and the pool collapsed from $N to $N.");
  assert.equal(claimKey("collapsed from $16,861 to $0"), "collapsed from $N to $N");
});

test("claimKey: a sentence with no figure is unchanged", () => {
  const plain = "Confirmed honeypot: buyers could not sell while liquidity was present.";
  assert.equal(claimKey(plain), plain);
  const other = "Deployer funded from untracked bridge.";
  assert.equal(claimKey(other), other);
});

test("reasonsRetracted: HONOR's hourly sequence ($14,240 -> $13,207 -> $15,629) is false each step", () => {
  const h1 = ["Confirmed honeypot: buyers could not sell, and $14,240 of liquidity is still trapped in the pool."];
  const h2 = ["Confirmed honeypot: buyers could not sell, and $13,207 of liquidity is still trapped in the pool."];
  const h3 = ["Confirmed honeypot: buyers could not sell, and $15,629 of liquidity is still trapped in the pool."];
  assert.equal(reasonsRetracted(h1, h2), false);
  assert.equal(reasonsRetracted(h2, h3), false);
});

test("reasonsRetracted: $15,629 'still trapped' -> 'while liquidity was present' is true", () => {
  const trapped = ["Confirmed honeypot: buyers could not sell, and $15,629 of liquidity is still trapped in the pool."];
  const drained = ["Confirmed honeypot: buyers could not sell while liquidity was present."];
  assert.equal(reasonsRetracted(trapped, drained), true);
});

test("reasonsRetracted: old [A, B] -> new [A] is true", () => {
  assert.equal(reasonsRetracted(["Reason A", "Reason B"], ["Reason A"]), true);
});

test("reasonsRetracted: non-array old reasons is false", () => {
  const newReasons = ["Confirmed honeypot: buyers could not sell, and $14,240 of liquidity is still trapped in the pool."];
  assert.equal(reasonsRetracted(null, newReasons), false);
  assert.equal(reasonsRetracted(undefined, newReasons), false);
  assert.equal(reasonsRetracted("not-an-array", newReasons), false);
  assert.equal(reasonsRetracted(12345, newReasons), false);
  assert.equal(reasonsRetracted({}, newReasons), false);
});

test("WIRING: recordRug calls reasonsRetracted and no longer does exact string compare", () => {
  const src = readFileSync(new URL("../lib/data/wanted.ts", import.meta.url), "utf8");
  assert.ok(src.length > 500, "lib/data/wanted.ts read successfully");

  // Assert the extraction found const claimRetracted first (§8 #22)
  const match = src.match(/const\s+claimRetracted\s*=\s*([^;\n]+);/);
  assert.ok(match, "found const claimRetracted declaration in lib/data/wanted.ts");
  assert.ok(match[1].length > 0, "extracted claimRetracted expression is non-empty");

  // Assert that it calls reasonsRetracted(
  assert.match(match[1], /reasonsRetracted\(/, "claimRetracted calls reasonsRetracted");

  // Assert that wanted.ts no longer contains !match.reasons.includes(r as string)
  assert.doesNotMatch(src, /!match\.reasons\.includes\(r\s+as\s+string\)/, "no longer contains raw string inclusion compare");
});
