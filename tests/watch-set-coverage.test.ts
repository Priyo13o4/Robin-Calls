import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectWatchSet } from "../lib/data/rugs";

test("selectWatchSet: a $200K token scanned 40 days ago ranks above a $500 token scanned today", () => {
  const candidates = [
    { token: "0x500today", lastLiquidityUsd: 500, latestVerdictId: 100 },
    { token: "0x200kold", lastLiquidityUsd: 200_000, latestVerdictId: 10 },
  ];
  const result = selectWatchSet(candidates, 10);
  assert.equal(result.tokens[0], "0x200kold");
  assert.equal(result.tokens[1], "0x500today");
});

test("selectWatchSet: cap truncates the LEAST liquid, and truncated counts them", () => {
  const candidates = [
    { token: "0xliquid1", lastLiquidityUsd: 100_000, latestVerdictId: 1 },
    { token: "0xliquid2", lastLiquidityUsd: 50_000, latestVerdictId: 2 },
    { token: "0xliquid3", lastLiquidityUsd: 10_000, latestVerdictId: 3 },
    { token: "0xliquid4", lastLiquidityUsd: 1_000, latestVerdictId: 4 },
  ];
  const result = selectWatchSet(candidates, 2);
  assert.deepEqual(result.tokens, ["0xliquid1", "0xliquid2"]);
  assert.equal(result.candidates, 4);
  assert.equal(result.truncated, 2);
});

test("selectWatchSet: null liquidity sorts last", () => {
  const candidates = [
    { token: "0xnull", lastLiquidityUsd: null, latestVerdictId: 999 },
    { token: "0xlow", lastLiquidityUsd: 10, latestVerdictId: 1 },
  ];
  const result = selectWatchSet(candidates, 10);
  assert.deepEqual(result.tokens, ["0xlow", "0xnull"]);
});

test("selectWatchSet: ties break by newer verdict", () => {
  const candidates = [
    { token: "0xolder", lastLiquidityUsd: 25_000, latestVerdictId: 10 },
    { token: "0xnewer", lastLiquidityUsd: 25_000, latestVerdictId: 50 },
    { token: "0xnullold", lastLiquidityUsd: null, latestVerdictId: 5 },
    { token: "0xnullnew", lastLiquidityUsd: null, latestVerdictId: 20 },
  ];
  const result = selectWatchSet(candidates, 10);
  assert.deepEqual(result.tokens, ["0xnewer", "0xolder", "0xnullnew", "0xnullold"]);
});

test("WIRING: slow-rug route and readRecentSnapshotsSeries wire watch set correctly without unranked caps", () => {
  const routeRaw = readFileSync(new URL("../app/api/jobs/slow-rug/route.ts", import.meta.url), "utf8");
  const routeCode = routeRaw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // §8 #22: assert extraction found its targets first
  const callIdx = routeCode.indexOf("readRecentSnapshotsSeries");
  assert.ok(callIdx > 0, "extraction target readRecentSnapshotsSeries not found in route.ts");

  const forTokensIdx = routeCode.indexOf("for (const addr of tokens)");
  assert.ok(forTokensIdx > 0, "extraction target 'for (const addr of tokens)' not found in route.ts");

  // The route passes the watch set tokens into readRecentSnapshotsSeries
  assert.match(routeCode, /readRecentSnapshotsSeries\s*\([^,)]+,\s*tokens\)/);

  // The route iterates the watch set
  assert.match(routeCode, /for\s*\(\s*const\s+\w+\s+of\s+tokens\s*\)/);

  // The route contains no checked >= limit break
  assert.doesNotMatch(routeCode, /checked\s*>=\s*limit/);

  // Check rugs.ts for readRecentSnapshotsSeries without limit(5000)
  const rugsRaw = readFileSync(new URL("../lib/data/rugs.ts", import.meta.url), "utf8");
  const rugsCode = rugsRaw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const funcIdx = rugsCode.indexOf("readRecentSnapshotsSeries");
  assert.ok(funcIdx > 0, "extraction target readRecentSnapshotsSeries not found in rugs.ts");

  const funcEnd = rugsCode.indexOf("export", funcIdx + 1);
  const funcBody = rugsCode.slice(funcIdx, funcEnd === -1 ? undefined : funcEnd);
  assert.ok(funcBody.length > 50, "extracted readRecentSnapshotsSeries body was unexpectedly short");

  // readRecentSnapshotsSeries has no .limit(5000)
  assert.doesNotMatch(funcBody, /\.limit\s*\(\s*5000\s*\)/);
  assert.doesNotMatch(funcBody, /\.limit\s*\(/);
});
