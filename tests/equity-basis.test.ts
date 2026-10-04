import test from "node:test";
import assert from "node:assert/strict";
import {
  marketPriceFrom,
  describeEquityBasis,
  type MarketPriceRead,
} from "../lib/market/equity-basis";
import type { EquityReference } from "../lib/market/equity-reference";
import type { RwaQuoteResult } from "../lib/market/rwa-quotes";

const CRWD_ADDRESS = "0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931";

test("marketPriceFrom: complete false produces unavailable (never no-pool)", () => {
  const result: RwaQuoteResult = {
    quotes: new Map(),
    complete: false,
  };
  assert.deepEqual(marketPriceFrom(result, CRWD_ADDRESS), { kind: "unavailable" });
});

test("marketPriceFrom: complete true with missing entry produces no-pool", () => {
  const result: RwaQuoteResult = {
    quotes: new Map(),
    complete: true,
  };
  assert.deepEqual(marketPriceFrom(result, CRWD_ADDRESS), { kind: "no-pool" });
});

test("marketPriceFrom: priceUsd null on existing entry produces unavailable (never no-pool) (R)", () => {
  const result: RwaQuoteResult = {
    quotes: new Map([
      [
        CRWD_ADDRESS.toLowerCase(),
        {
          priceUsd: null,
          marketCapUsd: null,
          volume24hUsd: null,
          liquidityUsd: null,
          trades24h: null,
          poolAddress: "0xpool",
        },
      ],
    ]),
    complete: true,
  };
  assert.deepEqual(marketPriceFrom(result, CRWD_ADDRESS), { kind: "unavailable" });
});

test("marketPriceFrom: non-positive or non-finite priceUsd produces unavailable", () => {
  const resultZero: RwaQuoteResult = {
    quotes: new Map([
      [
        CRWD_ADDRESS.toLowerCase(),
        {
          priceUsd: 0,
          marketCapUsd: null,
          volume24hUsd: null,
          liquidityUsd: null,
          trades24h: null,
          poolAddress: "0xpool",
        },
      ],
    ]),
    complete: true,
  };
  assert.deepEqual(marketPriceFrom(resultZero, CRWD_ADDRESS), { kind: "unavailable" });
});

test("marketPriceFrom: valid priceUsd produces price read", () => {
  const result: RwaQuoteResult = {
    quotes: new Map([
      [
        CRWD_ADDRESS.toLowerCase(),
        {
          priceUsd: 944.38,
          marketCapUsd: 1000000,
          volume24hUsd: 50000,
          liquidityUsd: 200000,
          trades24h: 15,
          poolAddress: "0xpool",
        },
      ],
    ]),
    complete: true,
  };
  assert.deepEqual(marketPriceFrom(result, CRWD_ADDRESS), { kind: "price", usd: 944.38 });
});

test("describeEquityBasis: not-equity returns null", () => {
  const ref: EquityReference = { kind: "not-equity" };
  const market: MarketPriceRead = { kind: "price", usd: 100 };
  assert.equal(describeEquityBasis(ref, market), null);
});

test("describeEquityBasis: unavailable ref produces warn tone with verbatim sentence", () => {
  const ref: EquityReference = { kind: "unavailable", detail: "network error" };
  const market: MarketPriceRead = { kind: "price", usd: 100 };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "warn");
  assert.equal(view.premiumBps, null);
  assert.equal(view.referenceStatus, "unavailable");
  assert.equal(view.referencePriceUsd, null);
  assert.deepEqual(view.lines, ["We could not load Robinhood's price for this stock."]);
});

test("describeEquityBasis: halted ref produces warn tone with symbol in sentence", () => {
  const ref: EquityReference = { kind: "halted", symbol: "CRWD" };
  const market: MarketPriceRead = { kind: "price", usd: 100 };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "warn");
  assert.equal(view.premiumBps, null);
  assert.equal(view.referenceStatus, "halted");
  assert.equal(view.referencePriceUsd, null);
  assert.deepEqual(view.lines, [
    "Trading in CRWD is halted, so there is no live reference price.",
  ]);
});

test("describeEquityBasis: stale never compares with on-chain price (R)", () => {
  const ref: EquityReference = {
    kind: "ok",
    symbol: "CRWD",
    multiplier: 4,
    multiplierText: "4",
    pendingMultiplier: false,
    shareMidUsd: 239.35,
    tokenReferenceUsd: 957.4,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: true,
  };
  const market: MarketPriceRead = { kind: "price", usd: 944.38 };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "neutral");
  assert.equal(view.premiumBps, null, "stale reference must NEVER publish a premiumBps comparison");
  assert.equal(view.referenceStatus, "stale");
  assert.equal(view.referencePriceUsd, 957.4, "keep the actual stale quote separately typed");
  assert.equal(view.referenceTime, "11:41 UTC");
  assert.equal(view.shareRatio, "4");
  assert.ok(
    view.lines[0]?.includes("so we do not compare it with the on-chain price"),
    "must state that stale price is not compared",
  );
  assert.ok(view.lines[0]?.includes("11:41 UTC"), "must include UTC time");
  // Multiplier line still appends for multiplier != 1
  assert.equal(view.lines[1], "One token tracks 4 shares.");
});

test("describeEquityBasis: CRWD real numbers fixture (prompt required)", () => {
  // CRWD share mid 239.35, multiplier 4.0 -> token reference 957.40
  // market price: 944.38 -> bps round((944.38 - 957.4) / 957.4 * 10000) = -136
  const ref: EquityReference = {
    kind: "ok",
    symbol: "CRWD",
    multiplier: 4,
    multiplierText: "4",
    pendingMultiplier: false,
    shareMidUsd: 239.35,
    tokenReferenceUsd: 957.4,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  const market: MarketPriceRead = { kind: "price", usd: 944.38 };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "neutral");
  assert.equal(view.premiumBps, -136);
  assert.equal(view.referenceStatus, "live");
  assert.equal(view.referencePriceUsd, 957.4);
  assert.equal(
    view.lines[0],
    "CRWD tokens trade at $944.38 on chain, 1.36% below Robinhood's price of $957.40.",
  );
  assert.ok(view.lines[0].includes("1.36% below"));
  assert.ok(view.lines[0].includes("$957.40"));
  assert.equal(view.lines[1], "One token tracks 4 shares.");
});

test("describeEquityBasis: abs(bps) < 10 produces 'in line with' sentence", () => {
  const ref: EquityReference = {
    kind: "ok",
    symbol: "AAPL",
    multiplier: 1,
    multiplierText: "1",
    pendingMultiplier: false,
    shareMidUsd: 100.0,
    tokenReferenceUsd: 100.0,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  // market 100.05 -> bps = round(0.05 / 100 * 10000) = 5 (< 10)
  const market: MarketPriceRead = { kind: "price", usd: 100.05 };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "neutral");
  assert.equal(view.premiumBps, 5);
  assert.deepEqual(view.lines, [
    "AAPL tokens trade at $100.05 on chain, in line with Robinhood's price of $100.00.",
  ]);
});

test("describeEquityBasis: abs(bps) >= 500 produces warn tone", () => {
  const ref: EquityReference = {
    kind: "ok",
    symbol: "NVDA",
    multiplier: 1,
    multiplierText: "1",
    pendingMultiplier: false,
    shareMidUsd: 100.0,
    tokenReferenceUsd: 100.0,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  // market 106.00 -> bps = +600 (>= 500)
  const market: MarketPriceRead = { kind: "price", usd: 106.0 };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "warn");
  assert.equal(view.premiumBps, 600);
  assert.deepEqual(view.lines, [
    "NVDA tokens trade at $106.00 on chain, 6.00% above Robinhood's price of $100.00.",
  ]);
});

test("describeEquityBasis: no-pool produces neutral tone and verbatim sentence", () => {
  const ref: EquityReference = {
    kind: "ok",
    symbol: "TSLA",
    multiplier: 1,
    multiplierText: "1",
    pendingMultiplier: false,
    shareMidUsd: 250.0,
    tokenReferenceUsd: 250.0,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  const market: MarketPriceRead = { kind: "no-pool" };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "neutral");
  assert.equal(view.premiumBps, null);
  assert.equal(view.referenceStatus, "no-pool");
  assert.equal(view.referencePriceUsd, 250);
  assert.deepEqual(view.lines, [
    "Robinhood's price for one TSLA token is $250.00. No pool trades it on chain yet.",
  ]);
});

test("describeEquityBasis: unavailable market produces warn tone (never no-pool) (R)", () => {
  const ref: EquityReference = {
    kind: "ok",
    symbol: "TSLA",
    multiplier: 1,
    multiplierText: "1",
    pendingMultiplier: false,
    shareMidUsd: 250.0,
    tokenReferenceUsd: 250.0,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  const market: MarketPriceRead = { kind: "unavailable" };
  const view = describeEquityBasis(ref, market);
  assert.ok(view);
  assert.equal(view.tone, "warn");
  assert.equal(view.premiumBps, null);
  assert.equal(view.referenceStatus, "market-unavailable");
  assert.equal(view.referencePriceUsd, 250);
  assert.deepEqual(view.lines, [
    "Robinhood's price for one TSLA token is $250.00. We could not load the on-chain price.",
  ]);
});

test("describeEquityBasis: multiplier line (R) and pendingMultiplier line", () => {
  // multiplier != 1 appends "One token tracks {multiplierText} shares."
  const ref1: EquityReference = {
    kind: "ok",
    symbol: "SPLIT",
    multiplier: 1.000566080061092436,
    multiplierText: "1.000566",
    pendingMultiplier: true,
    shareMidUsd: 50.0,
    tokenReferenceUsd: 50.02830400305462,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  const market: MarketPriceRead = { kind: "no-pool" };
  const view1 = describeEquityBasis(ref1, market);
  assert.ok(view1);
  assert.equal(view1.tone, "warn", "pendingMultiplier must elevate tone to warn");
  assert.equal(view1.shareRatio, "1.000566");
  assert.equal(view1.pendingCorporateAction, true);
  assert.equal(view1.lines.length, 3);
  assert.equal(
    view1.lines[1],
    "One token tracks 1.000566 shares.",
    "must append multiplier line",
  );
  assert.equal(
    view1.lines[2],
    "A corporate action is pending, so that ratio is about to change.",
    "must append corporate action line",
  );

  // multiplier === 1 does NOT append multiplier line
  const ref2: EquityReference = {
    kind: "ok",
    symbol: "NORMAL",
    multiplier: 1,
    multiplierText: "1",
    pendingMultiplier: false,
    shareMidUsd: 100.0,
    tokenReferenceUsd: 100.0,
    generatedAt: "2026-09-16T11:41:12.016276086Z",
    stale: false,
  };
  const view2 = describeEquityBasis(ref2, market);
  assert.ok(view2);
  assert.equal(view2.lines.length, 1);
  assert.equal(view2.lines[0], "Robinhood's price for one NORMAL token is $100.00. No pool trades it on chain yet.");
});

test("describeEquityBasis: a reference with no readable time says so and never prints an invented one", () => {
  const ref: EquityReference = {
    kind: "ok",
    symbol: "CRWD",
    multiplier: 1,
    multiplierText: "1",
    pendingMultiplier: false,
    shareMidUsd: 239.35,
    tokenReferenceUsd: 239.35,
    generatedAt: "not a time",
    stale: true,
  };
  const view = describeEquityBasis(ref, { kind: "price", usd: 239 });
  assert.ok(view);
  assert.equal(view.premiumBps, null);
  assert.equal(view.referenceStatus, "stale");
  assert.equal(view.referenceTime, null);
  assert.deepEqual(view.lines, ["Robinhood's last price for CRWD carries no time, so we do not compare it with the on-chain price."]);
  assert.ok(!view.lines.join(" ").includes("00:00"), "a missing time must not render as midnight");
});
