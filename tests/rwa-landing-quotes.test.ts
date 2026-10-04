import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readRwaQuotes, readAllRwaQuotes, _resetRwaQuoteCache } from "../lib/market/rwa-quotes";

/**
 * The landing RWA cards published a dash for every asset: they read
 * `market_snapshots`, which is filled for SCANNED tokens only, and 192 of the
 * 194 registry RWAs have never been scanned. `readRwaQuotes` reads the provider
 * instead, so these pin the two ways that read can lie:
 *
 *   - a provider outage cached as a fact (§4, §8 #4), and
 *   - an outage that reaches the card as "no market" rather than "we could not
 *     look" (§8 #9).
 */

const AAPL = "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9";
const OTHER = "0x232b8ed6377be97813853b0ac104c4cda8378d1b";

function pair(base: string, over: Record<string, unknown> = {}) {
  return {
    chainId: "robinhood",
    dexId: "uniswap",
    pairAddress: "0xpool",
    baseToken: { address: base, symbol: "AAPL" },
    priceUsd: "333.31",
    txns: { h24: { buys: 12900, sells: 11174 } },
    volume: { h24: 5571064.66 },
    liquidity: { usd: 609725.4 },
    fdv: 5410437,
    marketCap: 5410437,
    ...over,
  };
}

/** Installs a fetch stub and returns the call counter plus the last request init. */
function stubFetch(handler: () => { ok: boolean; body: unknown }) {
  const calls = { n: 0, lastInit: undefined as RequestInit | undefined };
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.n += 1;
    calls.lastInit = init;
    const { ok, body } = handler();
    return {
      ok,
      status: ok ? 200 : 503,
      json: async () => body,
    } as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

test("a provider answer becomes one quote per token, trades summed across both sides", async () => {
  _resetRwaQuoteCache();
  const stub = stubFetch(() => ({ ok: true, body: [pair(AAPL)] }));
  try {
    const { quotes, complete } = await readRwaQuotes([AAPL]);
    assert.equal(complete, true);
    const q = quotes.get(AAPL);
    assert.ok(q);
    assert.equal(q!.priceUsd, 333.31);
    assert.equal(q!.marketCapUsd, 5410437);
    assert.equal(q!.trades24h, 12900 + 11174);
  } finally {
    stub.restore();
  }
});

test("a provider failure reports complete:false, never an empty-but-confident map", async () => {
  _resetRwaQuoteCache();
  const stub = stubFetch(() => ({ ok: false, body: null }));
  try {
    const { quotes, complete } = await readRwaQuotes([AAPL]);
    assert.equal(complete, false);
    assert.equal(quotes.size, 0);
  } finally {
    stub.restore();
  }
});

test("a failure is NOT cached — the next call re-probes instead of holding the outage", async () => {
  _resetRwaQuoteCache();
  let fail = true;
  const stub = stubFetch(() => (fail ? { ok: false, body: null } : { ok: true, body: [pair(AAPL)] }));
  try {
    const first = await readRwaQuotes([AAPL]);
    assert.equal(first.complete, false);

    fail = false;
    const second = await readRwaQuotes([AAPL]);
    assert.equal(second.complete, true, "a recovered provider must be visible immediately");
    assert.equal(stub.calls.n, 2);
  } finally {
    stub.restore();
  }
});

test("a success IS cached, so a second render inside the TTL costs no request", async () => {
  _resetRwaQuoteCache();
  const stub = stubFetch(() => ({ ok: true, body: [pair(AAPL)] }));
  try {
    await readRwaQuotes([AAPL]);
    await readRwaQuotes([AAPL]);
    assert.equal(stub.calls.n, 1);
  } finally {
    stub.restore();
  }
});

test("completed batch cache is bounded across distinct caller-selected batches", async () => {
  _resetRwaQuoteCache();
  const stub = stubFetch(() => ({ ok: true, body: [] }));
  try {
    const addresses = Array.from({ length: 257 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
    for (const address of addresses) await readRwaQuotes([address]);
    await readRwaQuotes([addresses[0]!]);
    assert.equal(stub.calls.n, 258, "the oldest success must be evicted after the bounded cache fills");
  } finally {
    stub.restore();
  }
});

test("concurrent callers share one request (§5 single-flight), not one each", async () => {
  _resetRwaQuoteCache();
  const stub = stubFetch(() => ({ ok: true, body: [pair(AAPL)] }));
  try {
    await Promise.all([readRwaQuotes([AAPL]), readRwaQuotes([AAPL]), readRwaQuotes([AAPL])]);
    assert.equal(stub.calls.n, 1);
  } finally {
    stub.restore();
  }
});

test("a pool where the token is the COUNTER-asset yields no quote (§8 #21)", async () => {
  _resetRwaQuoteCache();
  // The provider returned a pair, but its base token is a different asset, so
  // its price describes that asset. Publishing it under our token is the bug
  // that rendered Amazon's share price on someone else's chart.
  const stub = stubFetch(() => ({ ok: true, body: [pair(OTHER)] }));
  try {
    const { quotes, complete } = await readRwaQuotes([AAPL]);
    assert.equal(complete, true, "the provider answered — that much we know");
    assert.equal(quotes.get(AAPL), undefined, "but it said nothing about THIS token");
  } finally {
    stub.restore();
  }
});

test("the batch cap throws rather than silently slicing an unranked list (§8 #18)", async () => {
  _resetRwaQuoteCache();
  const many = Array.from({ length: 31 }, (_, i) => `0x${String(i).padStart(40, "0")}`);
  await assert.rejects(() => readRwaQuotes(many), /at most 30/);
});

// ── Wiring (§8 #10): a completeness flag nothing reads is not a defence. ──

test("the landing page passes the completeness flag through to the card", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  assert.match(page, /marketComplete: complete/, "readRwaPreview must return the flag");
  assert.match(page, /marketComplete=\{rwa\.marketComplete\}/, "and RwaShowcase must receive it");
});

test("the card BRANCHES on it, so an outage never renders as a market figure", () => {
  const src = readFileSync("app/components/site/landing/RwaShowcase.tsx", "utf8");
  assert.match(src, /marketComplete \?/, "the stat block must be behind the flag");
  assert.match(src, /Market data unavailable/, "and the other branch must say so");
});

test("the card reads the live quote fields, not the retired snapshot ones", () => {
  const src = readFileSync("app/components/site/landing/RwaShowcase.tsx", "utf8");
  for (const field of ["market_cap_usd", "volume_24h_usd", "trades_24h"]) {
    assert.ok(src.includes(field), `RwaShowcase must render ${field}`);
  }
  // `fdv_usd` was the snapshot-era name. Its return means the card is reading
  // the table that has no rows for the registry again.
  assert.ok(!src.includes("fdv_usd"), "fdv_usd is the snapshot shape, not the quote shape");
});

// ── The regression that froze the whole landing page ──
//
// `cache: "no-store"` is revalidate 0. Inside a prerendered `revalidate = 60`
// page Next throws "Page changed from static to dynamic at runtime", DISCARDS
// the regeneration and keeps serving the build-time prerender — which is built
// with no DATABASE_URL, so every section rendered zero. `/rwa` was fine the
// whole time, which is what made it look like a data problem.

test("the landing read is CACHEABLE — a no-store fetch here freezes the prerender", async () => {
  _resetRwaQuoteCache();
  const stub = stubFetch(() => ({ ok: true, body: [pair(AAPL)] }));
  try {
    await readRwaQuotes([AAPL]);
    const init = stub.calls.lastInit as (RequestInit & { next?: { revalidate?: number } }) | undefined;
    assert.ok(init, "the fetch must receive an init object");
    assert.notEqual(init!.cache, "no-store", "no-store is revalidate 0 and cannot run in an ISR render");
    assert.equal(typeof init!.next?.revalidate, "number", "it must carry a revalidate window instead");
  } finally {
    stub.restore();
  }
});

test("readAllRwaQuotes chunks arbitrary address lists into batches of 30 and merges", async () => {
  _resetRwaQuoteCache();
  const addrs = Array.from({ length: 35 }, (_, i) => `0x${i.toString(16).padStart(40, "0")}`);
  const stub = stubFetch(() => ({
    ok: true,
    body: addrs.map((a) => pair(a)),
  }));
  try {
    const { quotes, complete } = await readAllRwaQuotes(addrs);
    assert.equal(complete, true);
    assert.equal(quotes.size, 35);
    // 35 addresses split into 30 + 5 = 2 fetch calls
    assert.equal(stub.calls.n, 2);
  } finally {
    stub.restore();
  }
});

test("a caller wait budget returns incomplete while the shared quote refill can warm cache", async () => {
  _resetRwaQuoteCache();
  const original = globalThis.fetch;
  let release!: () => void;
  let markStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    markStarted();
    await gate;
    return { ok: true, status: 200, json: async () => [pair(AAPL)] } as Response;
  }) as typeof fetch;
  try {
    const bounded = await readAllRwaQuotes([AAPL], { waitMs: 10 });
    assert.equal(bounded.complete, false);
    assert.equal(bounded.quotes.size, 0);
    await started;
    assert.equal(calls, 1);

    release();
    const warmed = await readAllRwaQuotes([AAPL]);
    assert.equal(warmed.complete, true);
    assert.equal(warmed.quotes.get(AAPL)?.priceUsd, 333.31);
    assert.equal(calls, 1, "the second caller joins the still-running refill");
  } finally {
    release();
    globalThis.fetch = original;
    _resetRwaQuoteCache();
  }
});

test("a wait budget still serves the batches that finished, marked partial", async () => {
  _resetRwaQuoteCache();
  const original = globalThis.fetch;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const addrs = Array.from({ length: 31 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
  globalThis.fetch = (async (url: string | URL) => {
    const inSecondBatch = String(url).includes(addrs[30]);
    if (inSecondBatch) await gate;
    const wanted = inSecondBatch ? [addrs[30]] : addrs.slice(0, 30);
    return { ok: true, status: 200, json: async () => wanted.map((a) => pair(a)) } as Response;
  }) as typeof fetch;
  try {
    const partial = await readAllRwaQuotes(addrs, { waitMs: 50 });
    assert.equal(partial.complete, false);
    assert.equal(partial.quotes.size, 30, "the finished batch is not discarded with the slow one");
    assert.equal(partial.quotes.has(addrs[30]), false);
  } finally {
    release();
    globalThis.fetch = original;
    _resetRwaQuoteCache();
  }
});
