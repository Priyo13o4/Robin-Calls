import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("app/components/trade/ModernTradingCard.tsx", "utf8");

test("address search does not restart RPC/metadata reads when the selected pay-token price changes", () => {
  const start = source.indexOf("// Real-time On-Chain / DexScreener Contract Address Search");
  const end = source.indexOf("// Dynamic Name / Symbol Search for Tokens Not in Local List", start);
  assert.ok(start >= 0 && end > start, "address-search effect should remain a distinct flow");
  const effect = source.slice(start, end);
  assert.match(effect, /\}, \[searchQuery, chainTokens, publicClient\]\);/);
  assert.doesNotMatch(effect, /payToken\.priceUsd/,
    "live-price ticks must not restart address resolution or external metadata fetches");
});

test("resolved token ETH display price follows the latest pay-token price without refetching metadata", () => {
  assert.match(source, /payTokenPriceRef\.current = payToken\.priceUsd;/);
  assert.match(source, /price \/ payTokenPriceRef\.current/,
    "async address enrichment must read the latest pay-token price, not a stale effect closure");
  assert.match(source, /const priceEth = prev\.priceUsd \/ payToken\.priceUsd;/,
    "an already-resolved token must be recalculated when the pay-token price refreshes");
});
