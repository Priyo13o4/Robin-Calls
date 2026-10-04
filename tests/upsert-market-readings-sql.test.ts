import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const launchesSrc = readFileSync(join(root, "lib/data/launches.ts"), "utf8");

test("upsertMarketReadings SQL wiring asserts peak and zero-count logic in same statement", () => {
  const startIdx = launchesSrc.indexOf("export async function upsertMarketReadings");
  assert.ok(startIdx !== -1, "must find upsertMarketReadings in lib/data/launches.ts");

  const endIdx = launchesSrc.indexOf("export async function touchMarketReadAt", startIdx);
  assert.ok(endIdx !== -1, "must find boundary after upsertMarketReadings");

  const fnSrc = launchesSrc.slice(startIdx, endIdx);
  // CLAUDE.md §8 #22: assert the slice is non-empty first
  assert.ok(fnSrc.length > 200, "extracted upsertMarketReadings slice must be non-empty");

  // 1. Both columns present in insert values
  assert.ok(
    fnSrc.includes("peakLiquidityUsd: toNumericString(r.liquidityUsd)"),
    "upsertMarketReadings must write peakLiquidityUsd in insert values"
  );
  assert.ok(
    fnSrc.includes("zeroLiquidityReadings: r.liquidityUsd === 0 ? 1 : 0"),
    "upsertMarketReadings must initialize zeroLiquidityReadings in insert values"
  );

  // 2. Both columns present in conflict set
  assert.ok(
    fnSrc.includes("peakLiquidityUsd: sql`case when excluded.liquidity_usd is null then launch_state.peak_liquidity_usd"),
    "upsertMarketReadings conflict set must preserve stored peak when incoming reading is null"
  );
  assert.ok(
    fnSrc.includes("greatest(coalesce(launch_state.peak_liquidity_usd, excluded.liquidity_usd), excluded.liquidity_usd)"),
    "upsertMarketReadings conflict set must calculate greatest peak with null guard"
  );
  assert.ok(
    fnSrc.includes("zeroLiquidityReadings: sql`case when excluded.liquidity_usd is null then launch_state.zero_liquidity_readings"),
    "upsertMarketReadings conflict set must keep zero count when incoming reading is null"
  );
  assert.ok(
    fnSrc.includes("when excluded.liquidity_usd = 0 then launch_state.zero_liquidity_readings + 1"),
    "upsertMarketReadings conflict set must increment zero count when reading is 0"
  );
  assert.ok(
    fnSrc.includes("else 0 end"),
    "upsertMarketReadings conflict set must reset zero count when reading is above 0"
  );

  // 3. .returning present with required columns
  assert.ok(fnSrc.includes(".returning({"), ".returning clause must be present");
  assert.ok(fnSrc.includes("tokenAddress: launchState.tokenAddress"), ".returning must return tokenAddress");
  assert.ok(fnSrc.includes("peakLiquidityUsd: launchState.peakLiquidityUsd"), ".returning must return peakLiquidityUsd");
  assert.ok(fnSrc.includes("zeroLiquidityReadings: launchState.zeroLiquidityReadings"), ".returning must return zeroLiquidityReadings");
  assert.ok(fnSrc.includes("liquidityUsd: launchState.liquidityUsd"), ".returning must return liquidityUsd");
  assert.ok(fnSrc.includes("marketPoolAddress: launchState.marketPoolAddress"), ".returning must return marketPoolAddress");
});

test("touchMarketReadAt does not mention peak or zero-liquidity columns", () => {
  const touchStart = launchesSrc.indexOf("export async function touchMarketReadAt");
  assert.ok(touchStart !== -1, "must find touchMarketReadAt in lib/data/launches.ts");

  const touchEnd = launchesSrc.indexOf("export async function readRemovalLockedTokens", touchStart);
  assert.ok(touchEnd !== -1, "must find boundary after touchMarketReadAt");

  const touchSrc = launchesSrc.slice(touchStart, touchEnd);
  // CLAUDE.md §8 #22: assert the slice is non-empty first
  assert.ok(touchSrc.length > 50, "extracted touchMarketReadAt slice must be non-empty");

  assert.equal(
    touchSrc.includes("peak_liquidity_usd") || touchSrc.includes("peakLiquidityUsd"),
    false,
    "touchMarketReadAt must never touch peak_liquidity_usd"
  );
  assert.equal(
    touchSrc.includes("zero_liquidity_readings") || touchSrc.includes("zeroLiquidityReadings"),
    false,
    "touchMarketReadAt must never touch zero_liquidity_readings"
  );
});
