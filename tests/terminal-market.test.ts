import test from "node:test";
import assert from "node:assert/strict";
import type { TokenMarketData } from "../lib/trade/types";
import { hasFreshTerminalQuote, isMarketSnapshotFresh, mergeLiveMarketData, resolveTerminalLaunchMarket } from "../lib/trade/terminal-market";

const token = (address: string, pairAddress: string, symbol: string): TokenMarketData => ({
  address,
  name: symbol,
  symbol,
  pairAddress,
  pairSymbol: `${symbol} / USDG`,
  baseToken: { address, name: symbol, symbol, decimals: 18 },
  quoteToken: { address: "0xquote", name: "USDG", symbol: "USDG", decimals: 6 },
  venue: "old venue",
  isBondingCurve: false,
  priceUsd: 2,
  priceEth: 0.001,
  priceQuote: 2,
  fdv: 200,
  marketCap: 200,
  liquidityUsd: 100,
  volume24h: 50,
  txns24h: { total: 2, buys: 1, sells: 1 },
  volumeBreakdown24h: { buyUsd: 25, sellUsd: 25 },
  traders24h: { total: 2, buyers: 1, sellers: 1 },
  priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
  age: "1h",
  rank: 1,
  socials: {},
  pooled: { baseAmount: 1, baseUsd: 2, quoteAmount: 2, quoteUsd: 2 },
  auditVerdict: { score: 70, tier: "CAUTION", honeypotPass: false, mintable: false, liquidityLocked: false, lockedPct: 0 },
});

test("snapshot freshness rejects missing, malformed, future and old timestamps", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  assert.equal(isMarketSnapshotFresh(null, now), false);
  assert.equal(isMarketSnapshotFresh("bad-date", now), false);
  assert.equal(isMarketSnapshotFresh("2026-09-30T12:00:01Z", now), false);
  assert.equal(isMarketSnapshotFresh("2026-09-30T11:54:59Z", now), false);
  assert.equal(isMarketSnapshotFresh("2026-09-30T11:55:00Z", now), true);
});

test("terminal live status is bounded to two polling windows", () => {
  const now = 10_000;
  assert.equal(hasFreshTerminalQuote(null, now, 25_000), false);
  assert.equal(hasFreshTerminalQuote(now + 1, now, 25_000), false);
  assert.equal(hasFreshTerminalQuote(now - 50_000, now, 25_000), true);
  assert.equal(hasFreshTerminalQuote(now - 50_001, now, 25_000), false);
});

test("live market merge rejects another token returned as the pair base", () => {
  const current = token("0xtarget", "0xoldpair", "TARGET");
  const unrelated = token("0xother", "0xnewpair", "OTHER");
  unrelated.priceUsd = 99;
  assert.equal(mergeLiveMarketData(current, unrelated), null);
});

test("a new live pool carries quote identity and price together", () => {
  const current = token("0xtarget", "0xoldpair", "TARGET");
  const updated = token("0xTARGET", "0xnewpair", "TARGET");
  updated.pairSymbol = "TARGET / ETH";
  updated.baseToken = { address: "0xtarget", name: "TARGET", symbol: "TARGET", decimals: 18 };
  updated.quoteToken = { address: "0xeth", name: "Ether", symbol: "ETH", decimals: 18 };
  updated.venue = "Uniswap V4";
  updated.priceQuote = 0.001;

  const merged = mergeLiveMarketData(current, updated);
  assert.ok(merged);
  assert.equal(merged.pairAddress, "0xnewpair");
  assert.equal(merged.pairSymbol, "TARGET / ETH");
  assert.equal(merged.quoteToken.symbol, "ETH");
  assert.equal(merged.priceQuote, 0.001);
  assert.equal(merged.venue, "Uniswap V4");
});

test("terminal resolves a graduated launch using actual pool price and valuations", async () => {
  const initial = token("0xtarget", "0xoldpair", "TARGET");
  initial.launchpadUrl = "https://launch.example/token";
  const live = token("0xtarget", "0xnewpair", "TARGET");
  live.priceUsd = 0.004;
  live.fdv = 4_000;
  live.marketCap = 3_500;
  live.socials.website = "https://project.example";
  const addresses: string[] = [];
  const resolved = await resolveTerminalLaunchMarket(initial, async (address) => { addresses.push(address); return live; });
  assert.deepEqual(addresses, [initial.address]);
  assert.equal(resolved.priceUsd, live.priceUsd);
  assert.equal(resolved.marketCap, 3_500);
  assert.equal(resolved.fdv, 4_000);
  assert.equal(resolved.socials.website, live.socials.website);
  assert.equal(resolved.launchpadUrl, initial.launchpadUrl);
});

test("live metadata corrects an unknown or wrong quote label even when the pool is unchanged", () => {
  const current = token("0xtarget", "0xpool", "TARGET");
  const live = token("0xtarget", "0xpool", "TARGET");
  live.pairSymbol = "TARGET / WETH";
  live.quoteToken = { address: "0xweth", name: "Wrapped Ether", symbol: "WETH", decimals: 18 };
  live.priceQuote = 0.001;
  const merged = mergeLiveMarketData(current, live)!;
  assert.equal(merged.pairAddress, current.pairAddress);
  assert.equal(merged.quoteToken.address, "0xweth");
  assert.equal(merged.quoteToken.symbol, "WETH");
  assert.equal(merged.pairSymbol, live.pairSymbol);
  assert.equal(merged.priceQuote, 0.001);
});

test("unavailable pool market does not publish launch estimates or invented zero balances", async () => {
  const initial = token("0xtarget", "0xoldpair", "TARGET");
  for (const load of [async () => { throw new Error("503"); }, async () => ({ ...initial, priceUsd: 0 })]) {
    const resolved = await resolveTerminalLaunchMarket(initial, load);
    assert.equal(resolved.address, initial.address);
    assert.equal(resolved.pairAddress, initial.pairAddress);
    assert.ok(Number.isNaN(resolved.priceUsd));
    assert.ok(Number.isNaN(resolved.marketCap));
    assert.ok(Number.isNaN(resolved.txns24h.total));
    assert.ok(Number.isNaN(resolved.pooled.baseAmount));
  }
});

test("active bonding curve keeps its own launch display and makes no extra market request", async () => {
  const initial = { ...token("0xtarget", "0xoldpair", "TARGET"), isBondingCurve: true };
  const resolved = await resolveTerminalLaunchMarket(initial, async () => { assert.fail("must not query pool before graduation"); });
  assert.equal(resolved, initial);
});
