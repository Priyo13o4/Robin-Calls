import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRetryIncompleteRwaQuotes } from "../app/swap/components/MarketLists";

const source = readFileSync("app/swap/components/MarketLists.tsx", "utf8");

test("RWA quote retry policy retries incomplete quotes once, never complete or repeated responses", () => {
  assert.equal(shouldRetryIncompleteRwaQuotes(false, false), true);
  assert.equal(shouldRetryIncompleteRwaQuotes(true, false), false);
  assert.equal(shouldRetryIncompleteRwaQuotes(undefined, false), false);
  assert.equal(shouldRetryIncompleteRwaQuotes(false, true), false);
});

test("PopularRwas schedules one delayed retry and keeps validated rows visible", () => {
  const start = source.indexOf("export function PopularRwas()");
  const end = source.indexOf("type Pair =", start);
  const component = source.slice(start, end);
  assert.ok(start >= 0 && end > start, "PopularRwas component should exist");
  assert.match(component, /Promise\.all\(\[readJson\("\/api\/rwa\/feed"\), readJson\("\/api\/rwa\/official-assets"\)\]\)/);
  assert.match(component, /controller\.abort\(\), 20_000/, "cold authenticity verification has room to finish");
  assert.match(component, /shouldRetryIncompleteRwaQuotes\(data\.quotesComplete, autoRetryUsed\.current\)/);
  assert.match(component, /window\.setTimeout\(\(\) => setLoadAttempt\(\(attempt\) => attempt \+ 1\), 5_000\)/);
  assert.match(component, /rowsRef\.current = nextRows/);
  assert.match(component, /setState\(rowsRef\.current\.length \? "ready" : "error"\)/,
    "failed background retries keep the last validated rows visible");
  assert.match(component, /\.finally\(\(\) => window\.clearTimeout\(timeout\)\)/,
    "successful requests release their timeout promptly");
  assert.match(component, /if \(retryTimer !== null\) window\.clearTimeout\(retryTimer\)/,
    "unmounting cancels a scheduled retry");
});

test("PopularTokens has no unused retry state", () => {
  const start = source.indexOf("export function PopularTokens()");
  const component = source.slice(start);
  assert.doesNotMatch(component, /loadAttempt|setLoadAttempt/);
});
