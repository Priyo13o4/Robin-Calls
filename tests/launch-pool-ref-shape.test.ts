import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poolShapedRef } from "../lib/data/launches";

// MAGAJAK / CHAINPAD, 2026-09-15: Pons V2 graduation rows carried pool_ref "2736135"
// (PoolGraduated.positionId) and the card linked dexscreener.com/robinhood/2736135.
// Their real V4 pool id was in launch_state.market_pool_address the whole time.

test("only an address or a V4 pool id is a pool reference", () => {
  assert.equal(poolShapedRef("2736135"), null);
  assert.equal(poolShapedRef(""), null);
  assert.equal(poolShapedRef(null), null);
  assert.equal(poolShapedRef("0xpoolid"), null);
  const addr = "0x" + "ab".repeat(20);
  const poolId = "0xac9e3cc56433847e380b5344383ac739558364710daad9277d6bd09c191b728d";
  assert.equal(poolShapedRef(addr), addr);
  assert.equal(poolShapedRef(poolId), poolId);
});

test("WIRING: feed and provenance guard the graduation ref and prove missing Pons refs on demand", () => {
  const src = readFileSync(new URL("../lib/data/launches.ts", import.meta.url), "utf8");
  const guarded = src.match(/l\.family === "pons-v2" \? provenPonsRef\(r\.gradPool, r\.gradDetail\) : poolShapedRef\(r\.gradPool\)/g) ?? [];
  assert.equal(guarded.length, 2, "both readers require a Pons proof marker");
  assert.match(src, /ponsPoolFromGraduation/);
  const marketFallback = src.match(/l\.family !== "pons-v2" && \(venueKind === "POOL" \|\| r\.graduated\)/g) ?? [];
  assert.equal(marketFallback.length, 2, "Pons cannot silently use an unrelated market pool");
  assert.doesNotMatch(src, /r\.gradPool \?\? \(venueKind/, "no unguarded graduation ref left");
});
