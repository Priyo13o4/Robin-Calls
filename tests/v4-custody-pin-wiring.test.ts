import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// KNOWN-PROBLEMS L144 wiring (§8 #10). `batchRead`'s `blockNumber` option existed
// for weeks with zero callers while custody walked 30 explorer pages instead.
const src = () => readFileSync(new URL("../lib/dex/v4-custody.ts", import.meta.url), "utf8");

test("L144 wiring: the pool state is read AT the index ceiling", () => {
  const s = src();
  assert.match(s, /batchRead\(calls, \{ blockNumber: ceiling \}\)/);
  const pins = s.match(/await poolStateAtCeiling\(pool\.poolId, positionIndex\.ceiling\)/g) ?? [];
  assert.equal(pins.length, 1, "the pool state pin at positionIndex.ceiling must exist");
});

test("L144 wiring: no swap-log walk and no unpinned fallback remain", () => {
  const s = src();
  assert.doesNotMatch(s, /v4SwapEvent|v4swap:|explorerGetLogs|live-read-unpinned/);
});
