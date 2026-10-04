import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

/**
 * A pool has two sides and each provider picks its own base. We pin the pool by
 * DexScreener's orientation (scanned token = base) and hand that address to
 * GeckoTerminal, which orients the same pool by a rule we do not control and
 * cannot fully predict: measured over 146 prod pools it honours a quote allowlist
 * (native/WETH/USDG) first and falls back to V4 `currency0` — 140/146 — but SPY is
 * the quote in one pool and the base in another, so the remainder is unmodelled.
 * CRC verdict #261 rendered Amazon's $259 share price on a $0.0008 memecoin;
 * 10 verdicts across 8 tokens charted their counter-asset (prod, 2026-09-05).
 * `token_address` states our subject, so no orientation rule of theirs can move it.
 */
test("the verdict chart embed names the scanned token as its subject", () => {
  const src = readFileSync(join(root, "app/components/site/VerdictView.tsx"), "utf8");
  const iframe = src.slice(src.indexOf('title="Price chart"'));
  const url = iframe.slice(iframe.indexOf("src={`"), iframe.indexOf("allow="));
  assert.ok(
    url.includes("geckoterminal.com"),
    "expected the GeckoTerminal embed at this call site"
  );
  assert.match(
    url,
    /token_address=\$\{verdict\.tokenAddress\}/,
    "a /pools/ embed without token_address charts whichever side GeckoTerminal calls base"
  );
});

/**
 * §8 #19, one layer over: the price must come from the side that IS the scanned
 * token, never from whichever side the provider labelled "base".
 */
test("the GeckoTerminal provider prices the scanned token, not the pool's base", async () => {
  const { geckoTerminalProvider } = await import("../lib/market/geckoterminal");

  const CRC = "0x446adb118f5f15f2a749e38288d4025b55f3e095";
  const AMZN = "0x12f190a9f9d7d37a250758b26824b97ce941bf54";
  const pool = "0x81721a33257bfc773c734c5e486a69169ec7243e19d29f92de4965a4fc3d8087";

  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: `robinhood_${pool}`,
            type: "pool",
            attributes: {
              address: pool,
              // GT calls AMZN the base here; CRC is the quote.
              base_token_price_usd: "259.5981423107",
              quote_token_price_usd: "0.000120138839819899",
              token_price_usd: "0.000120138839819899",
              fdv_usd: "120138.839819899",
              reserve_in_usd: "30426.2858",
              volume_usd: { h24: "8135587.33" },
              transactions: { h24: { buys: 1, sells: 1, buyers: 1, sellers: 1 } },
              pool_created_at: "2026-09-04T20:13:10Z",
            },
            relationships: {
              base_token: { data: { id: `robinhood_${AMZN}` } },
              quote_token: { data: { id: `robinhood_${CRC}` } },
              dex: { data: { id: "pons-v2-dex" } },
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  try {
    const got = await geckoTerminalProvider.fetchTokenMarket(CRC);
    assert.equal(got.state, "OK");
    assert.equal(
      got.snapshot?.priceUsd,
      0.000120138839819899,
      "priceUsd must be CRC's, not the base token AMZN's $259.60"
    );
    assert.equal(got.snapshot?.poolAddress, pool);
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * The fallback path: when GT omits its token-scoped price we must resolve the
 * side from `relationships`, and return null rather than the wrong token's price.
 */
test("with no token_price_usd, the side is resolved from relationships", async () => {
  const { geckoTerminalProvider } = await import("../lib/market/geckoterminal");
  const CRC = "0x446adb118f5f15f2a749e38288d4025b55f3e095";
  const AMZN = "0x12f190a9f9d7d37a250758b26824b97ce941bf54";

  const build = (relationships: unknown) =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "robinhood_0xpool",
            type: "pool",
            attributes: {
              address: "0xpool",
              base_token_price_usd: "259.5981423107",
              quote_token_price_usd: "0.000120138839819899",
              fdv_usd: "120138.83",
              reserve_in_usd: "30426.28",
              volume_usd: { h24: "1" },
              transactions: { h24: { buys: 1, sells: 1 } },
              pool_created_at: null,
            },
            relationships,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      build({
        base_token: { data: { id: `robinhood_${AMZN}` } },
        quote_token: { data: { id: `robinhood_${CRC}` } },
      })) as typeof fetch;
    assert.equal(
      (await geckoTerminalProvider.fetchTokenMarket(CRC)).snapshot?.priceUsd,
      0.000120138839819899
    );

    // Neither side is the scanned token: null beats a confident wrong price.
    globalThis.fetch = (async () =>
      build({ base_token: { data: { id: `robinhood_${AMZN}` } } })) as typeof fetch;
    assert.equal(
      (await geckoTerminalProvider.fetchTokenMarket(CRC)).snapshot?.priceUsd,
      null
    );
  } finally {
    globalThis.fetch = original;
  }
});

/**
 * §8 #20: the env pin is the part that can go missing, so an UNSET var must
 * resolve to the provider that states an orientation we can verify. Prod has
 * carried `MARKET_SCAN_PROVIDER=dexscreener` since 2026-07-22; this makes the
 * code agree with it instead of depending on it.
 */
test("an unset MARKET_SCAN_PROVIDER resolves to the safe provider", async () => {
  const { scanMarketProviderId } = await import("../lib/market/registry");
  const prior = process.env.MARKET_SCAN_PROVIDER;
  try {
    delete process.env.MARKET_SCAN_PROVIDER;
    assert.equal(scanMarketProviderId(), "dexscreener", "unset must not mean GeckoTerminal");
    process.env.MARKET_SCAN_PROVIDER = "";
    assert.equal(scanMarketProviderId(), "dexscreener", "empty is unset, not a choice");
    process.env.MARKET_SCAN_PROVIDER = "geckoterminal";
    assert.equal(scanMarketProviderId(), "geckoterminal", "the opt-in must still work");
  } finally {
    if (prior === undefined) delete process.env.MARKET_SCAN_PROVIDER;
    else process.env.MARKET_SCAN_PROVIDER = prior;
  }
});

/** A second copy of a default is a second thing to get wrong (§8 #20). */
test("no surface re-derives the market provider default", () => {
  const admin = readFileSync(
    join(root, "app/admin/(dashboard)/capacity/page.tsx"),
    "utf8"
  );
  assert.ok(
    !/MARKET_SCAN_PROVIDER\s*\?\?/.test(admin),
    "capacity page must call scanMarketProviderId(), not restate the fallback"
  );
});
