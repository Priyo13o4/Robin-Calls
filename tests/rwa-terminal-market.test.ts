import test from "node:test";
import assert from "node:assert/strict";
import { _resetRwaTerminalMarketForTests, readRwaTerminalMarket, readRwaTerminalPairs } from "../lib/trade/rwa-terminal-market";

const TOKEN = "0x1111111111111111111111111111111111111111";
const POOL_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const POOL_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
function pair(pairAddress: string, liquidity: number, options: Record<string, unknown> = {}) {
  return {
    chainId: "robinhood", pairAddress,
    baseToken: { address: TOKEN, name: "Acme", symbol: "ACME" },
    quoteToken: { address: USDG, name: "Global Dollar", symbol: "USDG" },
    priceUsd: "25.5", priceNative: "25.5", liquidity: { usd: liquidity, base: 10, quote: 255 },
    volume: { h24: 1 }, ...options,
  };
}
function installFetch(body: unknown, status = 200) {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls: () => calls, restore: () => { globalThis.fetch = old; } };
}

test("chooses greatest USD liquidity regardless of volume or provider order", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([
    { ...pair(POOL_A, 10_000), volume: { h24: 9_000_000 } },
    { ...pair(POOL_B, 500_000), volume: { h24: 1 } },
  ]);
  try {
    const result = await readRwaTerminalMarket(TOKEN);
    assert.equal(result?.token.pairAddress, POOL_B);
    assert.equal(result?.token.priceUsd, 25.5);
    assert.ok(Number.isNaN(result?.token.priceEth), "USDG-denominated priceNative is not presented as ETH");
    assert.equal(result?.token.priceQuote, 25.5);
    assert.equal(result?.token.quoteToken.decimals, 6);
    assert.ok(result?.observedAt);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("canonical WETH keeps native price conversion and absent activity/reserves stay unknown", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([pair(POOL_A, 100, {
    quoteToken: { address: WETH, name: "Wrapped Ether", symbol: "WETH" },
    priceNative: "0.01",
    liquidity: { usd: 100 },
    volume: {},
  })]);
  try {
    const result = await readRwaTerminalMarket(TOKEN);
    assert.equal(result?.token.priceEth, 0.01);
    assert.equal(result?.token.priceQuote, 0.01);
    assert.equal(result?.token.quoteToken.decimals, 18);
    assert.ok(Number.isNaN(result?.token.volume24h));
    assert.ok(Number.isNaN(result?.token.txns24h.buys));
    assert.ok(Number.isNaN(result?.token.txns24h.sells));
    assert.ok(Number.isNaN(result?.token.txns24h.total));
    assert.ok(Number.isNaN(result?.token.pooled.baseAmount));
    assert.ok(Number.isNaN(result?.token.pooled.quoteAmount));
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("provider-reported zero activity and reserves remain zero", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([pair(POOL_A, 100, {
    volume: { h24: 0 },
    txns: { h24: { buys: 0, sells: 0 } },
    liquidity: { usd: 100, base: 0, quote: 0 },
  })]);
  try {
    const token = (await readRwaTerminalMarket(TOKEN))?.token;
    assert.equal(token?.volume24h, 0);
    assert.equal(token?.txns24h.total, 0);
    assert.equal(token?.pooled.baseAmount, 0);
    assert.equal(token?.pooled.quoteAmount, 0);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("ties resolve by lowercase pool address and reject foreign, wrong-base, and invalid-depth rows", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([
    pair(POOL_B, 100),
    pair(POOL_A, 100),
    { ...pair("0xcccccccccccccccccccccccccccccccccccccccc", 999), chainId: "ethereum" },
    { ...pair("0xdddddddddddddddddddddddddddddddddddddddd", 999), baseToken: { address: POOL_A } },
    pair("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", 0),
    pair("0xffffffffffffffffffffffffffffffffffffffff", Number.NaN),
    pair("invalid", 900),
  ]);
  try { assert.equal((await readRwaTerminalMarket(TOKEN))?.token.pairAddress, POOL_A); }
  finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("invalid best-pool price stays unknown while its successful pair observation is reusable", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([pair(POOL_B, 500, { priceUsd: "NaN" }), pair(POOL_A, 10, { priceUsd: "2" })]);
  try {
    assert.equal(await readRwaTerminalMarket(TOKEN), null);
    assert.equal(stub.calls(), 1);
    assert.equal(await readRwaTerminalMarket(TOKEN), null);
    assert.equal(stub.calls(), 1, "the positive pool observation is cached even though it cannot provide a price");
    const observation = await readRwaTerminalPairs(TOKEN);
    assert.equal(observation?.pairs.length, 2);
    assert.equal(stub.calls(), 1);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("missing quote identity on the highest-liquidity pool does not invent WETH or fall back", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([
    pair(POOL_B, 500, { quoteToken: { symbol: "USDG" } }),
    pair(POOL_A, 10, { priceUsd: "2" }),
  ]);
  try {
    assert.equal(await readRwaTerminalMarket(TOKEN), null);
    assert.equal(stub.calls(), 1);
    assert.equal((await readRwaTerminalPairs(TOKEN))?.pairs.length, 2, "the full successful observation remains available to the feed");
    assert.equal(stub.calls(), 1);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("market and feed pair reads share one full observation, including quote-side rows", async () => {
  _resetRwaTerminalMarketForTests();
  const rows = [pair(POOL_A, 100), { ...pair(POOL_B, 200), baseToken: { address: USDG, symbol: "USDG" }, quoteToken: { address: TOKEN, symbol: "ACME" } }];
  const stub = installFetch(rows);
  try {
    const market = await readRwaTerminalMarket(TOKEN);
    const pairs = await readRwaTerminalPairs(TOKEN);
    assert.equal(stub.calls(), 1);
    assert.equal(market?.token.pairAddress, POOL_A, "quote-side pool does not provide the token's base price");
    assert.equal(pairs?.pairs.length, 2, "feed receives both sides from the full endpoint response");
    assert.equal(pairs?.pairs[1].baseToken?.address, USDG);
    assert.equal(pairs?.observedAt, market?.observedAt);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("a valid empty pair array is a cacheable observation", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([]);
  try {
    assert.deepEqual((await readRwaTerminalPairs(TOKEN))?.pairs, []);
    assert.deepEqual((await readRwaTerminalPairs(TOKEN))?.pairs, []);
    assert.equal(stub.calls(), 1);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("concurrent reads share one request and successful results retain their observation time", async () => {
  _resetRwaTerminalMarketForTests();
  const stub = installFetch([pair(POOL_A, 100)]);
  try {
    const [a, b] = await Promise.all([readRwaTerminalMarket(TOKEN), readRwaTerminalMarket(TOKEN)]);
    assert.equal(stub.calls(), 1);
    assert.deepEqual(b, a);
    assert.deepEqual(await readRwaTerminalMarket(TOKEN), a);
    assert.equal(stub.calls(), 1);
  } finally { stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("successful cache entries expire after 30 seconds", async () => {
  _resetRwaTerminalMarketForTests();
  const oldNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  const stub = installFetch([pair(POOL_A, 100)]);
  try {
    const first = await readRwaTerminalMarket(TOKEN);
    now += 30_001;
    const second = await readRwaTerminalMarket(TOKEN);
    assert.equal(stub.calls(), 2);
    assert.ok(first && second && second.observedAt > first.observedAt);
  } finally { Date.now = oldNow; stub.restore(); _resetRwaTerminalMarketForTests(); }
});

test("provider failures stay retryable; 429 applies a shared 60-second cooldown", async () => {
  _resetRwaTerminalMarketForTests();
  const oldNow = Date.now;
  let now = 20_000;
  Date.now = () => now;
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return { ok: false, status: calls === 1 ? 503 : 429, json: async () => [] } as Response;
  }) as typeof fetch;
  try {
    await readRwaTerminalMarket(TOKEN);
    await readRwaTerminalMarket(TOKEN);
    await readRwaTerminalMarket("0x2222222222222222222222222222222222222222");
    assert.equal(calls, 2, "the 429 suppresses other token reads in this module");
    now += 60_001;
    const stub = installFetch([pair(POOL_A, 1)]);
    try { assert.ok(await readRwaTerminalMarket(TOKEN)); assert.equal(stub.calls(), 1); }
    finally { stub.restore(); }
  } finally { Date.now = oldNow; globalThis.fetch = original; _resetRwaTerminalMarketForTests(); }
});
