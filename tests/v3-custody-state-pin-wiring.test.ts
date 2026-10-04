import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/dex/v3-custody.ts", import.meta.url), "utf8");

test("WIRING L169: the mint index hands its ceiling to custody", () => {
  assert.match(src, /ceiling: history\.ceiling/);
});

test("WIRING L169: pool state is re-read at the ceiling and an unread pin stands the pool down", () => {
  const flow = src.slice(src.indexOf("const mints = mintIndex.mints;"));
  assert.ok(flow.length > 0, "extraction found the custody flow");
  assert.match(flow, /readPoolStateAt\(pool\.pool, poolStateAbi as Abi, mintIndex\.ceiling\)/);
  assert.match(flow, /if \(pinned === null\) \{\s*return unknown\(/);
  assert.match(flow, /activeLiquidity = pinned\.liquidity;/);
});

test("WIRING L169: every summed position read is pinned, ownerOf is not", () => {
  const pinnedBatches = src.match(/\{ blockNumber: stateBlock \}/g) ?? [];
  assert.equal(pinnedBatches.length, 3, "range, direct and NPM position reads");
  assert.match(src, /readNpmRangeLiquidity\(mints, pool, currentTick, mintIndex\.ceiling\)/);
  assert.match(src, /resolveDirectPositions\(mints, pool, currentTick, mintIndex\.ceiling\)/);
  assert.match(src, /opts\.lookThrough, mintIndex\.ceiling\)/);
  // Owners come from the NFT owner store (current owner, who can pull now), never pinned to the ceiling.
  assert.match(src, /resolveNftOwners\(npm, ids\)/);
  assert.doesNotMatch(src, /resolveNftOwners\(npm, ids[^)]*stateBlock/);
});
