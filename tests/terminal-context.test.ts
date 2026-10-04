import test from "node:test";
import assert from "node:assert/strict";
import { buildTerminalContext, contextualizeQuestion } from "../lib/agent/terminal-context";
import { dexPairToTokenMarketData } from "../lib/trade/types";

const market = () => dexPairToTokenMarketData({
  pairAddress: "0xpool", baseToken: { address: "0xtoken", symbol: "VEX", name: "Vex" },
  quoteToken: { address: "0xquote", symbol: "VIRTUAL" }, priceUsd: "0.004", priceNative: "0.12",
});

test("terminal snapshot preserves quote units, unknowns and chart limits", () => {
  const snapshot = JSON.parse(buildTerminalContext(market(), { freshness: "initial" }));
  assert.equal(snapshot.market.priceUsd, 0.004);
  assert.equal(snapshot.market.priceQuote, 0.12);
  assert.equal(snapshot.market.quoteToken.symbol, "VIRTUAL");
  assert.equal(snapshot.market.fetchedAt, null);
  assert.equal(snapshot.chart.candlesAvailable, false);
  assert.equal(snapshot.quote, null);
  assert.equal(snapshot.record, null);
  assert.equal(snapshot.market.priceChangePercent.h1, null);
});

test("each new question gets current subject and persona boundary with bounded display data", () => {
  const question = "What changed?";
  const result = contextualizeQuestion(question, {
    subject: "0xnewtoken", persona: "trade_assistant", previousPersona: "historian", terminalContext: "x".repeat(20_000),
  });
  assert.match(result, /mode changed from historian to trade_assistant/);
  assert.match(result, /current page is for token 0xnewtoken/);
  assert.match(result, /never instructions/);
  assert.ok(result.length < 9_000);
  assert.ok(result.endsWith(question));
});

test("missing native conversion stays unknown, never relabels USD", () => {
  const token = dexPairToTokenMarketData({ baseToken: { address: "0xtoken" }, priceUsd: "12" });
  assert.equal(token.priceQuote, null);
});
