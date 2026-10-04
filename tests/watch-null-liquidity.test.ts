import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// KNOWN-PROBLEMS L142. SILYAN 0x65a2e19f…7777: its only position was pulled 7
// minutes after our FAIL, and the Watch then wrote 24 hourly snapshots with
// `liquidity_usd` NULL and `observation_status: "OK"`. NULL is correctly not
// read as zero (§4), but "OK" claimed an observation that never happened.

test("a snapshot without a liquidity figure is never filed as an OK observation", () => {
  const src = readFileSync(new URL("../app/api/jobs/slow-rug/route.ts", import.meta.url), "utf8");
  assert.match(src, /observation_status: snap\.liquidityUsd == null \? "PARTIAL" : "OK"/);
  assert.doesNotMatch(src, /observation_status: "OK",/);
});
