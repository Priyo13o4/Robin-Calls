import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isTrending, pickTrendingPairs, TRENDING_RULES } from "../lib/trade/trending-rail";
import type { TokenMarketData } from "../lib/trade/types";

const win = (txns: number, vol: number) => ({
  txns: { total: txns, buys: Math.ceil(txns / 2), sells: Math.floor(txns / 2) },
  volume: { totalUsd: vol, buyUsd: vol / 2, sellUsd: vol / 2 },
  traders: { total: 0, buyers: 0, sellers: 0 },
});
function pair(address: string, over: Partial<TokenMarketData> = {}): TokenMarketData {
  return {
    address, symbol: address.slice(2, 6).toUpperCase(), liquidityUsd: 50_000, volume24h: 100_000,
    priceChange: { m5: 0, h1: 5, h6: 0, h24: 0 }, txns24h: { total: 500, buys: 250, sells: 250 },
    timeframeMetrics: { "5m": win(5, 1_000), "1h": win(100, 20_000), "6h": win(300, 60_000), "24h": win(500, 100_000) },
    quoteToken: { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", name: "USDG", symbol: "USDG", decimals: 6 },
    ...over,
  } as TokenMarketData;
}

test("trending: depth and 1h activity both required; unknown numbers fail the gate", () => {
  assert.equal(isTrending(pair("0x" + "1".repeat(40))), true);
  assert.equal(isTrending(pair("0x" + "2".repeat(40), { liquidityUsd: TRENDING_RULES.minLiquidityUsd - 1 })), false);
  assert.equal(isTrending(pair("0x" + "3".repeat(40), { liquidityUsd: Number.NaN })), false);
  const quiet = pair("0x" + "4".repeat(40));
  quiet.timeframeMetrics!["1h"] = win(TRENDING_RULES.minTxns1h - 1, 5_000);
  assert.equal(isTrending(quiet), false);
  assert.equal(isTrending(pair("0x" + "5".repeat(40), { isStock: true })), false, "equities are not launches");
});

test("trending: one pair per token, best score first, capped", () => {
  const a = "0x" + "a".repeat(40);
  const picks = pickTrendingPairs([
    pair(a, { pairAddress: "0xp1" }),
    pair(a, { pairAddress: "0xp2", volume24h: 900_000, timeframeMetrics: { ...pair(a).timeframeMetrics!, "1h": win(900, 200_000) } }),
    ...Array.from({ length: 20 }, (_, i) => pair("0x" + (i + 10).toString(16).padStart(40, "0"))),
  ]);
  assert.ok(picks.length > 0);
  assert.equal(picks.length, TRENDING_RULES.max);
  assert.equal(picks[0].pairAddress, "0xp2");
  assert.equal(picks.filter((p) => p.address === a).length, 1);
});

test("the Night Market page renders the trending rail, not the coming-soon rail (wiring)", () => {
  const page = readFileSync("app/night-market/page.tsx", "utf8");
  assert.match(page, /pickTrendingPairs\(/);
  assert.match(page, /<TrendingPairsRail pairs=\{trending\}/);
  assert.doesNotMatch(page, /ComingSoonRail|TERMINAL ACTIVE|Surfaced on traction/);
});
