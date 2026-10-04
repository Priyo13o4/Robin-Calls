import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankPoolsByDepth } from "../lib/data/swap-pools";

test("§8 #18: the stored V4 lookup ranks by measured depth before the cut, dead and unmeasured last", () => {
  const rows = ["0x01", "0x02", "0x03", "0x04", "0x05"].map((poolId) => ({ poolId }));
  const ranked = rankPoolsByDepth(rows, [
    { poolId: "0x01", depthUsd: "5", deadAt: null },
    { poolId: "0x02", depthUsd: "90000", deadAt: "2026-10-01T00:00:00Z" },
    { poolId: "0x04", depthUsd: "25000", deadAt: null },
    { poolId: "0x05", depthUsd: "0", deadAt: null },
  ]);
  assert.deepEqual(ranked.map((r) => r.poolId), ["0x04", "0x01", "0x05", "0x03", "0x02"]);
  assert.equal(rankPoolsByDepth(rows, []).map((r) => r.poolId).join(), "0x01,0x02,0x03,0x04,0x05", "control: no depth keeps id order");
  const src = readFileSync(new URL("../lib/data/swap-pools.ts", import.meta.url), "utf8");
  assert.match(src, /return rankPoolsByDepth\(pairRows, depths\)\.slice\(0,/, "the lookup cuts after ranking");
});
