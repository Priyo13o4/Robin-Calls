import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyMarketFilters, byNewest, compareKnown, NO_FILTERS, PRESETS, trendingScoreFor,
} from "../lib/trade/market-filters";
import { dexPairToTokenMarketData, getTimeframeMetrics, formatCompactUsd } from "../lib/trade/types";

const NOW = Date.UTC(2026, 8, 29, 9, 0);
const pair = (over: Record<string, unknown> = {}) => dexPairToTokenMarketData({
  chainId: "robinhood", dexId: "uniswap", labels: ["v4"], pairAddress: `0x${"1".repeat(64)}`,
  baseToken: { address: "0x1111111111111111111111111111111111111111", name: "Meme", symbol: "MEME" },
  quoteToken: { address: "0x0000000000000000000000000000000000000000", symbol: "ETH" },
  priceUsd: "0.0002", priceNative: "0.00000005",
  txns: { m5: { buys: 6, sells: 2 }, h1: { buys: 40, sells: 30 }, h6: { buys: 100, sells: 90 }, h24: { buys: 130, sells: 107 } },
  volume: { m5: 900, h1: 20_000, h6: 60_000, h24: 71_000 },
  priceChange: { m5: 12, h1: 50, h6: 300, h24: 332 },
  liquidity: { usd: 56_000, base: 106_299_447, quote: 10.38 },
  fdv: 60_000, marketCap: 60_000, pairCreatedAt: NOW - 12 * 60_000,
  ...over,
}, 1);

test("MEME's rail numbers: trades and volume per window are DexScreener's, traders and the buy/sell volume split are unknown", () => {
  const t = pair();
  assert.equal(t.priceChange.m5, 12, "5m change is the pair's reported percentage, with no local recomputation");
  assert.equal(pair({ priceChange: { m5: -4.33 } }).priceChange.m5, -4.33);
  assert.deepEqual(getTimeframeMetrics(t, "5m").txns, { total: 8, buys: 6, sells: 2 });
  assert.equal(getTimeframeMetrics(t, "1h").volume.totalUsd, 20_000);
  assert.ok(Number.isNaN(getTimeframeMetrics(t, "24h").traders.total), "was trades x 0.35 = 83");
  assert.ok(Number.isNaN(t.volumeBreakdown24h.buyUsd), "was a fixed 52% of volume");
  assert.equal(t.auditVerdict.tier, "UNSCANNED", "a pair nobody scanned is not CLEAN");
});

test("no invented activity: an unmeasured window is NaN, never scaled-down 24h with floors", () => {
  const t = pair();
  const bare = { ...t, timeframeMetrics: undefined };
  const w = getTimeframeMetrics(bare, "5m");
  assert.ok(Number.isNaN(w.txns.total) && Number.isNaN(w.volume.totalUsd));
  assert.equal(formatCompactUsd(NaN), "—");
  assert.equal(formatCompactUsd(0), "$0");
});

test("trending ranks activity, not percentage: a dust pool up 900% loses to a busy pool up 20%", () => {
  const busy = pair({ priceChange: { m5: 20, h1: 20, h6: 20, h24: 20 } });
  const dust = pair({
    baseToken: { address: "0x2222222222222222222222222222222222222222", name: "Dust", symbol: "DUST" },
    liquidity: { usd: 40, base: 1, quote: 0.01 }, volume: { m5: 10, h1: 10, h6: 10, h24: 10 },
    txns: { m5: { buys: 1, sells: 0 }, h1: { buys: 1, sells: 0 }, h6: { buys: 1, sells: 0 }, h24: { buys: 1, sells: 0 } },
    priceChange: { m5: 900, h1: 900, h6: 900, h24: 900 },
  });
  assert.ok(trendingScoreFor(busy, "5m") > trendingScoreFor(dust, "5m"));
});

test("filters combine, and an unreported figure never passes a minimum", () => {
  const fresh = pair();
  const old = pair({ baseToken: { address: "0x3333333333333333333333333333333333333333", name: "Old", symbol: "OLD" }, pairCreatedAt: NOW - 3 * 86_400_000 });
  const noLiq = pair({ baseToken: { address: "0x4444444444444444444444444444444444444444", name: "Nl", symbol: "NL" }, liquidity: undefined });
  const out = applyMarketFilters([fresh, old, noLiq], { ...NO_FILTERS, maxAgeMin: 60, minLiquidityUsd: 1_000 }, NOW);
  assert.deepEqual(out.map((t) => t.symbol), ["MEME"]);
  assert.deepEqual(applyMarketFilters([fresh], PRESETS.freshPumps, NOW).map((t) => t.symbol), ["MEME"], "up 12% in 5m on 8 trades");
  const calm = pair({ priceChange: { m5: 1, h1: 1, h6: 1, h24: 1 } });
  assert.deepEqual(applyMarketFilters([calm], PRESETS.freshPumps, NOW), []);
});

test("one per name keeps the most active copycat", () => {
  const mk = (addr: string, vol: number) => pair({ baseToken: { address: addr, name: "Tamagotchi", symbol: "TAMAGOTCHI" }, volume: { m5: 0, h1: 0, h6: 0, h24: vol } });
  const out = applyMarketFilters([mk("0x5555555555555555555555555555555555555555", 10), mk("0x6666666666666666666666666666666666666666", 9_000)], { ...NO_FILTERS, onePerName: true }, NOW);
  assert.deepEqual(out.map((t) => t.address), ["0x6666666666666666666666666666666666666666"]);
});

test("newest sorts on the timestamp, and unknown values sink in both directions", () => {
  const a = pair({ pairCreatedAt: NOW - 35 * 60_000 });
  const b = pair({ pairCreatedAt: NOW - 9 * 3_600_000 });
  assert.deepEqual([b, a].sort(byNewest), [a, b], "'9h' sorted ahead of '35m' as text");
  assert.deepEqual([NaN, 1, 3].sort((x, y) => compareKnown(x, y, "desc")), [3, 1, NaN]);
  assert.deepEqual([NaN, 3, 1].sort((x, y) => compareKnown(x, y, "asc")), [1, 3, NaN]);
});

test("WIRING: the Night Market applies the filters and ranks trending by activity; the trade bar is not 'newest launches'", () => {
  const nm = readFileSync("app/night-market/NightMarketClient.tsx", "utf8");
  assert.match(nm, /applyMarketFilters\(filtered, marketFilters, nowMs\)/);
  assert.match(nm, /trendingScoreFor\(t, tf\)/);
  assert.doesNotMatch(nm, /b\.age < a\.age/);
  assert.match(nm, /handleSort\("m5"\)/, "5M column");
  const page = readFileSync("app/trade/[token]/page.tsx", "utf8");
  assert.doesNotMatch(page, /readLaunchFeedCached\("all", 5\)/);
  assert.match(page, /pickTrending\(/);
  assert.match(readFileSync("lib/trade/market-filters.ts", "utf8"), /trendingScoreFor\(t, "1h"\)/);
});

test("the trending bar never lists a base asset like WETH", async () => {
  const { pickTrending } = await import("../lib/trade/market-filters");
  const weth = pair({ baseToken: { address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", name: "Wrapped Ether", symbol: "WETH" }, volume: { m5: 9e6, h1: 9e6, h6: 9e6, h24: 9e6 } });
  assert.deepEqual(pickTrending([weth, pair()], 5, NOW).map((t) => t.symbol), ["MEME"]);
});
