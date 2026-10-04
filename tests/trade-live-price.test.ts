import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickTokenPriceUsd } from "../lib/trade/live-price";

const T = "0x6c43086993f904499a24e6df42c7e785ea1843e7";
const ETH = "0x0000000000000000000000000000000000000000";
const pair = (base: string, quote: string, priceUsd: string, priceNative: string, usd: number) =>
  ({ baseToken: { address: base }, quoteToken: { address: quote }, priceUsd, priceNative, liquidity: { usd } });

test("§8 #21: priceUsd is the base side's price; a quote-side token is priced by division", () => {
  assert.equal(pickTokenPriceUsd([pair(T, ETH, "0.0001263", "0.00000004724", 34_000)], T), 0.0001263);
  const quoteOnly = pair("0xabc", T, "10", "2", 5_000_000);
  assert.equal(pickTokenPriceUsd([quoteOnly], T), 5, "base $10 = 2 T, so T = $5, never $10");
  assert.equal(pickTokenPriceUsd([quoteOnly, pair(T, ETH, "4.9", "1", 1_000)], T), 4.9, "any base-side pool beats a deeper quote-side one");
  assert.equal(pickTokenPriceUsd([pair(T, ETH, "1", "1", 10), pair(T, ETH, "2", "1", 90)], T), 2, "deepest base pool wins");
  assert.equal(pickTokenPriceUsd([pair(T, ETH, "0", "0", 10)], T), null, "a zero is no price");
  assert.equal(pickTokenPriceUsd([], T), null);
});

test("WIRING: /swap turns on the live refresh; the trade pages feed their own price", () => {
  assert.match(readFileSync("app/swap/SwapExperience.tsx", "utf8"), /\blivePrices\b/);
  assert.doesNotMatch(readFileSync("app/components/trade/TradeOverlayModal.tsx", "utf8"), /livePrices/);
  assert.match(readFileSync("app/components/trade/ModernTradingCard.tsx", "utf8"), /setInterval\(refresh, LIVE_PRICE_REFRESH_MS\)/);
});
