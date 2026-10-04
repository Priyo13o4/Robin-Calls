import test from "node:test";
import assert from "node:assert/strict";
import {
  _dexScreenerApiCacheSizeForTests,
  _resetDexScreenerApiCacheForTests,
  batchGetMarketData,
  getMarketDataForToken,
  searchDexScreenerPairs,
} from "../lib/trade/dexscreener-api";

const TOKEN = `0x${"1".repeat(40)}`;
const OTHER = `0x${"2".repeat(40)}`;
const POOL = `0x${"a".repeat(64)}`;
const POOL_OTHER = `0x${"b".repeat(64)}`;

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    pairAddress: POOL,
    baseToken: { address: TOKEN, name: "NX412", symbol: "NX412" },
    quoteToken: { address: OTHER, name: "Quote", symbol: "Q" },
    priceNative: "0.5",
    priceUsd: "4",
    liquidity: { usd: 500 },
    volume: { h24: 100 },
    ...overrides,
  };
}

function withFetch(handler: (url: string) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

test("multi-token reads use the documented chain-scoped endpoint and exact token side", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = withFetch(() => json([
    pair({ chainId: "ethereum", priceUsd: "999", pairAddress: TOKEN }),
    pair({ chainId: "robinhood", priceUsd: "7", baseToken: { address: OTHER, symbol: "OTHER" }, quoteToken: { address: OTHER } }),
    pair({ priceUsd: "4.25", pairAddress: POOL }),
  ]));
  try {
    const result = await batchGetMarketData([TOKEN]);
    assert.ok(stub.urls[0].includes(`/tokens/v1/robinhood/${TOKEN}`));
    assert.equal(result.get(TOKEN)?.address.toLowerCase(), TOKEN);
    assert.equal(result.get(TOKEN)?.pairAddress, POOL);
    assert.equal(result.get(TOKEN)?.priceUsd, 4.25);
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});

test("foreign-chain exact address matches are unknown, not selected or negative-cached", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = withFetch(() => json([
    pair({ chainId: "ethereum", pairAddress: TOKEN, priceUsd: "999" }),
    pair({ chainId: "robinhood", baseToken: { address: OTHER }, quoteToken: { address: OTHER }, pairAddress: POOL_OTHER }),
  ]));
  try {
    const result = await batchGetMarketData([TOKEN]);
    assert.equal(result.get(TOKEN)?.priceUsd, 0);
    assert.equal(result.get(TOKEN)?.pairAddress, TOKEN);
    assert.equal(_dexScreenerApiCacheSizeForTests(), 0);
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});

test("pair endpoint accepts documented `pairs` shape and requires exact Robinhood pair", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = withFetch(() => json({
    schemaVersion: "1.0.0",
    pairs: [
      pair({ chainId: "ethereum", pairAddress: POOL, priceUsd: "999" }),
      pair({ chainId: "robinhood", pairAddress: POOL_OTHER, priceUsd: "8" }),
      pair({ chainId: "robinhood", pairAddress: POOL, priceUsd: "4.5" }),
    ],
  }));
  try {
    const result = await getMarketDataForToken(POOL);
    assert.equal(result.pairAddress, POOL);
    assert.equal(result.priceUsd, 4.5);
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});

test("a batch 429 suppresses the pair fallback and is never cached as an empty market", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = withFetch(() => json({ error: "rate limited" }, 429));
  try {
    const result = await getMarketDataForToken(TOKEN);
    assert.equal(result.priceUsd, 0);
    assert.equal(stub.urls.length, 1, "do not issue the single-pair fallback during the cooldown");
    assert.equal(_dexScreenerApiCacheSizeForTests(), 0);

    await getMarketDataForToken(TOKEN);
    assert.equal(stub.urls.length, 1, "subsequent calls remain inside the cooldown");
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});

test("a search 429 suppresses its text-search fallback for the cooldown", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = withFetch(() => json({ error: "rate limited" }, 429));
  try {
    assert.deepEqual(await searchDexScreenerPairs(TOKEN), []);
    assert.equal(stub.urls.length, 1, "do not fall through to search after the token-pair endpoint is rate-limited");
    assert.deepEqual(await searchDexScreenerPairs("cashcat"), []);
    assert.equal(stub.urls.length, 1, "global cooldown suppresses subsequent market endpoints");
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});

test("a valid empty batch is a short-lived negative, while an invalid payload remains retryable", async () => {
  _resetDexScreenerApiCacheForTests();
  let body: unknown = [];
  const stub = withFetch(() => json(body));
  try {
    await batchGetMarketData([TOKEN]);
    assert.equal(_dexScreenerApiCacheSizeForTests(), 1);

    _resetDexScreenerApiCacheForTests();
    body = { unexpected: true };
    await batchGetMarketData([TOKEN]);
    assert.equal(_dexScreenerApiCacheSizeForTests(), 0);
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});
