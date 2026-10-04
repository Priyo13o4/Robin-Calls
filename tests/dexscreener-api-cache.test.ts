import test from "node:test";
import assert from "node:assert/strict";

import {
  _dexScreenerApiCacheSizeForTests,
  _resetDexScreenerApiCacheForTests,
  getMarketDataForToken,
} from "../lib/trade/dexscreener-api";

function installFetch(status: number, body: unknown) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls: () => calls, restore: () => { globalThis.fetch = original; } };
}

test("completed market misses stay within the cache size bound", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = installFetch(200, { pairs: [] });
  try {
    await getMarketDataForToken("cache-key-0");
    for (let i = 1; i <= 1024; i++) await getMarketDataForToken(`cache-key-${i}`);
    assert.equal(_dexScreenerApiCacheSizeForTests(), 1024);

    await getMarketDataForToken("cache-key-0");
    assert.equal(stub.calls(), 1026, "the oldest key is evicted and fetched again");
    assert.equal(_dexScreenerApiCacheSizeForTests(), 1024);
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});

test("an HTTP failure returns fallback data without caching the failure", async () => {
  _resetDexScreenerApiCacheForTests();
  const stub = installFetch(503, {});
  try {
    await getMarketDataForToken("retry-after-503");
    await getMarketDataForToken("retry-after-503");
    assert.equal(stub.calls(), 2, "the next caller must be able to retry the failed provider read");
    assert.equal(_dexScreenerApiCacheSizeForTests(), 0);
  } finally {
    stub.restore();
    _resetDexScreenerApiCacheForTests();
  }
});
