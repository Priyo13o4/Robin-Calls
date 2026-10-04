import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { capLabel, withCappedLabels, MAX_SYMBOL_CHARS } from "../lib/trade/format";

// The live token 0x94035f1d… ("QQQ") has a 28,161-char symbol and widened tables to 220,000 px.
const HUGE = Array.from({ length: 5000 }, (_, i) => `T${i}`).join(",");

test("labels are capped for display; short ones pass through untouched", () => {
  assert.equal(capLabel("HOOD", MAX_SYMBOL_CHARS), "HOOD");
  assert.equal(capLabel(HUGE, MAX_SYMBOL_CHARS).length, MAX_SYMBOL_CHARS);
  const t = withCappedLabels({ name: "QQQ", symbol: HUGE, pairSymbol: `${HUGE} / ETH`, baseToken: { name: "QQQ", symbol: HUGE }, quoteToken: { name: "Ether", symbol: "ETH" } });
  assert.equal(t.symbol.length, MAX_SYMBOL_CHARS);
  assert.equal(t.baseToken.symbol.length, MAX_SYMBOL_CHARS);
  assert.equal(t.pairSymbol, `${capLabel(HUGE, MAX_SYMBOL_CHARS)} / ETH`);
  assert.equal(t.name, "QQQ");
});

test("WIRING: the trade page and the Night Market feed cap labels; the table cells truncate", () => {
  assert.match(readFileSync("app/trade/[token]/page.tsx", "utf8"), /return withCappedLabels\(await resolveUncapped\(param\)\)/);
  assert.match(readFileSync("lib/trade/dexscreener-feed.ts", "utf8"), /return withCappedLabels\(data\)/);
  const nm = readFileSync("app/night-market/NightMarketClient.tsx", "utf8");
  assert.match(nm, /title=\{token\.symbol\} className="[^"]*truncate max-w-\[140px\]/);
  assert.match(nm, /\/\^0x\[0-9a-f\]\{40\}\$\/i\.test\(token\.venue\)/);
});
