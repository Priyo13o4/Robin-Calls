import test from "node:test";
import assert from "node:assert/strict";
import { computeLiquidityPulled } from "../lib/data/launches.ts";

test("feed: a pulled row carries liquidity_pulled: true", () => {
  const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const lockedTokens = new Set<string>();

  const isPulled = computeLiquidityPulled(
    "25000",
    "0",
    2,
    token,
    lockedTokens
  );
  assert.equal(isPulled, true, "qualifying candidate with 2 zero readings and peak >= $20k must be tagged liquidity_pulled");
});

test("feed: a lock-read fault gives false for the page", () => {
  const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  // When readRemovalLockedTokens throws, lockedTokens is passed as null
  const lockedTokens = null;

  const isPulled = computeLiquidityPulled(
    "25000",
    "0",
    2,
    token,
    lockedTokens
  );
  assert.equal(isPulled, false, "a lock read fault must degrade to false (display only, no false accusation)");
});

test("feed: a removal-locked token gives false even with $0 liquidity and peak", () => {
  const token = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const lockedTokens = new Set<string>([token.toLowerCase()]);

  const isPulled = computeLiquidityPulled(
    "50000",
    "0",
    5,
    token,
    lockedTokens
  );
  assert.equal(isPulled, false, "removal-locked tokens must not be tagged liquidity_pulled");
});

test("feed: a healthy pool with liquidity gives false", () => {
  const token = "0xcccccccccccccccccccccccccccccccccccccccc";
  const lockedTokens = new Set<string>();

  const isPulled = computeLiquidityPulled(
    "50000",
    "25000",
    0,
    token,
    lockedTokens
  );
  assert.equal(isPulled, false, "pool with active liquidity is not pulled");
});
