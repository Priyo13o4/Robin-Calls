import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("holders endpoint follows configured explorer providers and token decimals", () => {
  const route = readFileSync("app/api/scan/[address]/holders/route.ts", "utf8");
  assert.match(route, /explorer\.tokenHolders\(normalized\)/);
  assert.match(route, /explorer\.tokenInfo\(normalized\)/);
  assert.match(route, /formatUnits\(raw, decimals\)/);
  assert.doesNotMatch(route, /robinscanAdapter|10\s*\*\*\s*14/);
  assert.match(route, /state: "unavailable"[\s\S]*?"Cache-Control": "no-store"/);
});

test("holder reads begin only after selecting the holders tab and obsolete requests abort", () => {
  const table = readFileSync("app/components/trade/TradingTransactionsTable.tsx", "utf8");
  const effectStart = table.indexOf("// Holder data is expensive and rate-limited");
  const effectEnd = table.indexOf("const wallets =", effectStart);
  assert.ok(effectStart >= 0 && effectEnd > effectStart, "holder effect extracted");
  const effect = table.slice(effectStart, effectEnd);
  assert.match(effect, /if \(activeTab !== "holders"\) return/);
  assert.match(effect, /controller\.abort\(\)/);
  assert.match(effect, /token\.address\.toLowerCase\(\) !== address/);
});
