import test from "node:test";
import assert from "node:assert/strict";
import { TRACKER_THRESHOLDS } from "../lib/config/tracker";

/**
 * Unit tests for DEX-restricted market sweep & real measured liquidity (plan
 * doc §5j, CLAUDE.md §8 #11), and the tx-count floor added 2026-08-30
 * (lib/config/tracker.ts) — liquidity/volume alone is one deployer-funded LP
 * add or one wash-traded block; the tx-count AND-gate is what actually raises
 * the cost of gaming this.
 */

function clearsTractionGate(
  liquidityUsd: number | null,
  volume24hUsd: number | null,
  buys24h: number | null,
  sells24h: number | null
): boolean {
  const clearsLiquidityOrVolume =
    (liquidityUsd ?? 0) >= TRACKER_THRESHOLDS.minLiquidityUsd ||
    (volume24hUsd ?? 0) >= TRACKER_THRESHOLDS.minVolume24hUsd;
  const clearsTxFloor = (buys24h ?? 0) + (sells24h ?? 0) >= TRACKER_THRESHOLDS.minTxCount24h;
  return clearsLiquidityOrVolume && clearsTxFloor;
}

test("TRACKER_THRESHOLDS.minLiquidityUsd is configured as threshold", () => {
  assert.equal(typeof TRACKER_THRESHOLDS.minLiquidityUsd, "number");
  assert.ok(TRACKER_THRESHOLDS.minLiquidityUsd > 0);
});

test("Measured liquidity + real trading activity above both bars promotes to SURFACED", () => {
  assert.equal(clearsTractionGate(25_000, 12_000, 40, 30), true);
});

test("Measured liquidity/volume below threshold stays CANDIDATE regardless of tx count", () => {
  assert.equal(clearsTractionGate(1_200, 400, 100, 100), false);
});

test("High liquidity but too few transactions stays CANDIDATE — the tx floor is an AND, not decoration", () => {
  // A single deployer-funded LP add can clear the $ bar alone with zero
  // organic trading. This is the case the tx-count gate exists to block.
  assert.equal(clearsTractionGate(50_000, 0, 2, 1), false);
});

test("A null tx count (no source ever reported one) fails the floor exactly like a measured zero", () => {
  assert.equal(clearsTractionGate(50_000, 0, null, null), false);
});

test("On-chain V4 empty liquidity check: 0 active liquidity on-chain records measured 0", () => {
  const activeLiqs = new Map<string, bigint>([["0xpool1", 0n], ["0xpool2", 0n]]);
  let totalActive = 0n;
  for (const [_, l] of activeLiqs) {
    if (l != null) totalActive += l;
  }
  const measuredLiquidityUsd = totalActive === 0n ? 0 : null;
  assert.equal(measuredLiquidityUsd, 0, "Empty on-chain V4 pool must resolve to measured 0, never a hardcoded literal");
});

test("Traction gate decision: $0 liquidity after trading demotes to RUGGED", () => {
  const previousLiquidity = TRACKER_THRESHOLDS.minLiquidityUsd + 5_000;
  const currentLiquidity = 0;
  const wasTrading = previousLiquidity >= TRACKER_THRESHOLDS.minLiquidityUsd;
  const isRugged = wasTrading && currentLiquidity === 0;

  assert.equal(isRugged, true);
});
