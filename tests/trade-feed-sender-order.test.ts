import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// §8 #19: the relay names the smart wallet behind an ERC-4337 bundle; a receipt names the bundler.
test("WIRING: a V4 receipt never fills the trader before the relay has been asked", () => {
  const src = readFileSync("lib/trade/trade-feed.ts", "utf8");
  const fill = src.slice(src.indexOf("async function fillV4Row"), src.indexOf("export interface FeedState"));
  assert.ok(fill.length > 0, "extracted fillV4Row");
  assert.ok(fill.includes("txFrom:"), "the receipt sender is kept as a fallback");
  assert.ok(!fill.includes("traderAddress:"), "fillV4Row must not set the trader itself");

  const tick = src.slice(src.indexOf("await fillV4();"));
  assert.ok(tick.indexOf("await relayWallets()") > 0 && tick.indexOf("await relayWallets()") < tick.indexOf("await lookupWallets()"), "relay first, RPC fallback second");
  const lookup = src.slice(src.indexOf("const lookupWallets"), src.indexOf("const tick"));
  assert.ok(lookup.indexOf("row.txFrom") > 0 && lookup.indexOf("row.txFrom") < lookup.indexOf("eth_getTransactionByHash"), "the stored sender saves the RPC read");
});
