import assert from "node:assert/strict";
import test from "node:test";
import { selectPair, type DexScreenerPair } from "../lib/market/dexscreener";

test("DexScreener batch pair exposes base-token metadata for tracker enrichment", () => {
  const token = "0x0000000000000000000000000000000000000011";
  const pair: DexScreenerPair = {
    pairAddress: "0x0000000000000000000000000000000000000022",
    baseToken: { address: token, name: "MemeMonk", symbol: "MONK" },
    liquidity: { usd: 6_943.74 },
  };

  const selected = selectPair([pair], token);
  assert.equal(selected?.baseToken?.symbol, "MONK");
  assert.equal(selected?.baseToken?.name, "MemeMonk");
});
