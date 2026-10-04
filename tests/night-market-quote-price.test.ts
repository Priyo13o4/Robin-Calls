import test from "node:test";
import assert from "node:assert/strict";
import {
  getQuotePriceUsd,
  launchFeedRowToTokenMarketData,
  type QuotePriceLookup,
} from "../lib/trade/types";
import type { LaunchFeedRow } from "../lib/launches/feed-types";

function createMockLaunchFeedRow(overrides?: Partial<LaunchFeedRow>): LaunchFeedRow {
  return {
    token_address: "0x1111111111111111111111111111111111111111",
    source_kind: "LAUNCHPAD",
    launchpad_id: 1,
    launchpad_name: "Pons",
    launchpad_slug: "pons",
    venue_model: "BONDING_CURVE",
    lifecycle_state: "SURFACED",
    pool_address: null,
    token_name: "Mock Token",
    token_symbol: "MOCK",
    liquidity_usd: null,
    volume_24h_usd: 1000,
    buys_24h: 10,
    sells_24h: 5,
    progress_bps: 4500, // 45%
    created_at: new Date().toISOString(),
    surfaced_at: new Date().toISOString(),
    graduated_at: null,
    metadata_uri: null,
    verdict: null,
    raised_wei: "500000000000000000", // 0.5 ETH
    quote_symbol: "ETH",
    quote_token: "0x0000000000000000000000000000000000000000",
    quote_decimals: 18,
    trades_1h: 2,
    trades_hourly: [2],
    price_change_h1: 3.5,
    liquidity_pulled: false,
    ...overrides,
  };
}

test("getQuotePriceUsd returns 1.0 for USD stables", () => {
  assert.equal(getQuotePriceUsd("USDG"), 1.0);
  assert.equal(getQuotePriceUsd("usdg"), 1.0);
  assert.equal(getQuotePriceUsd("USDC"), 1.0);
  assert.equal(getQuotePriceUsd("USDT"), 1.0);
  assert.equal(getQuotePriceUsd("DAI"), 1.0);
});

test("getQuotePriceUsd returns 0 for non-stable quotes without live price", () => {
  assert.equal(getQuotePriceUsd("ETH"), 0);
  assert.equal(getQuotePriceUsd("WETH"), 0);
  assert.equal(getQuotePriceUsd("NVDA"), 0);
  assert.equal(getQuotePriceUsd("TSLA"), 0);
  assert.equal(getQuotePriceUsd(null), 0);
  assert.equal(getQuotePriceUsd(undefined), 0);
});

test("getQuotePriceUsd returns live price when provided and valid", () => {
  assert.equal(getQuotePriceUsd("ETH", 3200.5), 3200.5);
  assert.equal(getQuotePriceUsd("NVDA", 135.25), 135.25);
  // Rejects non-positive or non-finite values
  assert.equal(getQuotePriceUsd("ETH", 0), 0);
  assert.equal(getQuotePriceUsd("ETH", -50), 0);
  assert.equal(getQuotePriceUsd("ETH", Number.NaN), 0);
});

test("launchFeedRowToTokenMarketData converts fractional raised_wei without integer truncation", () => {
  const row = createMockLaunchFeedRow({
    raised_wei: "500000000000000000", // 0.5 ETH
    quote_symbol: "ETH",
    quote_decimals: 18,
    liquidity_usd: null,
  });

  const quoteLookup: QuotePriceLookup = {
    ETH: 3000,
  };

  const marketData = launchFeedRowToTokenMarketData(row, 1, [], quoteLookup);

  // 0.5 ETH * $3000 = $1500 USD liquidity
  // Prior bug did integer division (500000000000000000n / 10^18n = 0n), truncating 0.5 ETH to 0 USD!
  assert.equal(marketData.liquidityUsd, 1500);
});

test("a small positive raise is not rounded back to zero", () => {
  const row = createMockLaunchFeedRow({ raised_wei: "1000000000000000" }); // 0.001 ETH
  const result = launchFeedRowToTokenMarketData(row, 1, [], { ETH: 300 });
  assert.equal(result.liquidityUsd, 0.3);
});

test("launchFeedRowToTokenMarketData supports Map-based quote lookup for stock tokens", () => {
  const stockQuoteAddress = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec"; // NVDA
  const row = createMockLaunchFeedRow({
    raised_wei: "2500000000000000000", // 2.5 NVDA
    quote_symbol: "NVDA",
    quote_token: stockQuoteAddress,
    quote_decimals: 18,
    liquidity_usd: null,
  });

  const quoteMap = new Map<string, number>();
  quoteMap.set(stockQuoteAddress.toLowerCase(), 120);

  const marketData = launchFeedRowToTokenMarketData(row, 1, [], quoteMap);

  // 2.5 NVDA * $120 = $300 USD
  assert.equal(marketData.liquidityUsd, 300);
});

test("a quote token cannot borrow another contract's price through a matching ticker", () => {
  const row = createMockLaunchFeedRow({
    quote_symbol: "NVDA",
    quote_token: "0x9999999999999999999999999999999999999999",
    raised_wei: "1000000000000000000",
  });
  const result = launchFeedRowToTokenMarketData(row, 1, [], { NVDA: 120 });
  assert.equal(result.liquidityUsd, 0);
});

test("unknown quote decimals do not turn base units into an invented USD raise", () => {
  const row = createMockLaunchFeedRow({
    quote_symbol: "NVDA",
    quote_token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    quote_decimals: null,
    raised_wei: "1000000000000000000",
  });
  const result = launchFeedRowToTokenMarketData(row, 1, [], {
    [row.quote_token!]: 120,
  });
  assert.equal(result.liquidityUsd, 0);
});

test("launchFeedRowToTokenMarketData supports function-based quote lookup", () => {
  const row = createMockLaunchFeedRow({
    raised_wei: "10000000000000000000", // 10 TSLA
    quote_symbol: "TSLA",
    quote_token: "0x322f0929c4625ed5bad873c95208d54e1c003b2d",
    quote_decimals: 18,
    liquidity_usd: null,
  });

  const lookupFn: QuotePriceLookup = (symbol) => {
    if (symbol === "TSLA") return 240;
    return undefined;
  };

  const marketData = launchFeedRowToTokenMarketData(row, 1, [], lookupFn);

  // 10 TSLA * $240 = $2400 USD
  assert.equal(marketData.liquidityUsd, 2400);
});

test("launchFeedRowToTokenMarketData preserves source fault semantics when quote price is missing", () => {
  const row = createMockLaunchFeedRow({
    raised_wei: "1000000000000000000",
    quote_symbol: "UNKNOWN_QUOTE",
    quote_token: "0x9999999999999999999999999999999999999999",
    liquidity_usd: null,
  });

  const marketData = launchFeedRowToTokenMarketData(row, 1, [], {});

  // Should degrade gracefully to 0 rather than inventing a price or crashing
  assert.equal(marketData.liquidityUsd, 0);
  assert.equal(Number.isFinite(marketData.liquidityUsd), true);
});

test("curve volume is the indexed quote flow priced in USD, never a measured-looking zero", () => {
  const prices: QuotePriceLookup = new Map([["ETH", 2000]]);
  const base = { volume_24h_usd: null, volume_24h_quote: "500000000000000000" } as const;
  // 0.5 ETH of buys and sells at $2000
  assert.equal(launchFeedRowToTokenMarketData(createMockLaunchFeedRow(base), 1, undefined, prices).volume24h, 1000);
  // Measured and quiet: a true zero
  assert.equal(
    launchFeedRowToTokenMarketData(createMockLaunchFeedRow({ ...base, volume_24h_quote: "0" }), 1, undefined, prices).volume24h,
    0,
  );
  // Unmeasured family, or traded but no quote price: unknown, not $0
  assert.ok(Number.isNaN(launchFeedRowToTokenMarketData(createMockLaunchFeedRow({ ...base, volume_24h_quote: null }), 1, undefined, prices).volume24h));
  assert.ok(Number.isNaN(launchFeedRowToTokenMarketData(createMockLaunchFeedRow(base), 1).volume24h));
});

test("two curves at different fill do not share one price", () => {
  const a = launchFeedRowToTokenMarketData(createMockLaunchFeedRow({ progress_bps: 3500 }));
  const b = launchFeedRowToTokenMarketData(createMockLaunchFeedRow({ progress_bps: 8900 }));
  assert.ok(a.priceUsd > 0 && b.priceUsd > a.priceUsd);
});
