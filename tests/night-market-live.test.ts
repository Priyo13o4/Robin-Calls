import assert from "node:assert/strict";
import test from "node:test";
import { mergeLiveLaunchMarket } from "../lib/trade/night-market-live";
import type { TokenMarketData } from "../lib/trade/types";

const launch = {
  address: "0x" + "a".repeat(40),
  pairAddress: "0x" + "b".repeat(64),
  liquidityUsd: 0,
  volume24h: 0,
  priceUsd: 0,
  priceEth: 0,
  fdv: 10_000,
  marketCap: 10_000,
  venue: "Pons V2 (Graduated)",
  launchpadName: "Pons V2",
  isBondingCurve: false,
  name: "Yuzu",
  symbol: "YUZU",
} as TokenMarketData;

test("a live pool repairs the launch row used by liquidity sorting while retaining provenance", () => {
  const live = {
    ...launch,
    liquidityUsd: 5_269,
    volume24h: 16_456,
    priceUsd: 0.000003,
    venue: "Uniswap V4",
    launchpadName: undefined,
  };
  const result = mergeLiveLaunchMarket(launch, live);
  assert.equal(result.liquidityUsd, 5_269);
  assert.equal(result.volume24h, 16_456);
  assert.equal(result.venue, "Pons V2 (Graduated)");
  assert.equal(result.launchpadName, "Pons V2");
});

test("a live pool also replaces a stale positive snapshot and fills the windows the launch row never carries", () => {
  const stale = {
    ...launch,
    liquidityUsd: 12_772,
    priceChange: { m5: NaN, h1: 456, h6: NaN, h24: NaN },
  } as TokenMarketData;
  const live = {
    ...launch,
    liquidityUsd: 0.01,
    volume24h: 7_860,
    priceChange: { m5: -100, h1: -99.99, h6: -99.99, h24: -99.99 },
  } as TokenMarketData;
  const result = mergeLiveLaunchMarket(stale, live);
  assert.equal(result.liquidityUsd, 0.01);
  assert.equal(result.priceChange.m5, -100);
  assert.equal(result.priceChange.h1, -99.99);
  assert.equal(result.priceChange.h24, -99.99);
});

test("a live reading with no liquidity never overwrites a stored positive snapshot", () => {
  const stored = { ...launch, liquidityUsd: 9_000 } as TokenMarketData;
  assert.equal(mergeLiveLaunchMarket(stored, { ...launch, liquidityUsd: 0 } as TokenMarketData), stored);
});

test("unanswered, unrelated and bonding markets do not overwrite a launch", () => {
  assert.equal(mergeLiveLaunchMarket(launch, null), launch);
  assert.equal(mergeLiveLaunchMarket(launch, { ...launch, liquidityUsd: 10, address: "0x" + "c".repeat(40) }), launch);
  assert.equal(mergeLiveLaunchMarket(launch, { ...launch, liquidityUsd: 0 }), launch);
  const pulled = { ...launch, liquidityPulled: true };
  assert.equal(mergeLiveLaunchMarket(pulled, { ...launch, liquidityUsd: 10 }), pulled);
  const bonding = { ...launch, isBondingCurve: true };
  assert.equal(mergeLiveLaunchMarket(bonding, { ...launch, liquidityUsd: 10 }), bonding);
});
