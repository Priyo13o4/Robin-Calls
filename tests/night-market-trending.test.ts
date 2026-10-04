import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { byTrending, trendingScore } from "../lib/trade/trending";

const tok = (volume24h: number, txns: number, boostScore = 0) => ({ volume24h, boostScore, txns24h: { total: txns } });

test("L211 decision: a boost is a small bonus, never a trump over real activity", () => {
  const organic = tok(100_000, 500);
  const boostedSmall = tok(20_000, 100, 500);
  assert.ok(trendingScore(organic) > trendingScore(boostedSmall), "the old x100,000 put this boosted token first");
  const tie = tok(100_000, 500, 10);
  assert.deepEqual([organic, tie].sort(byTrending)[0], tie, "a boost breaks a tie");
  assert.equal(trendingScore(tok(1000, 0, 10)), trendingScore(tok(1000, 0, 5000)), "the amount paid does not scale the bonus");
});

test("WIRING L211: both trending sites use the shared score; no boost multiplier survives", () => {
  const feed = readFileSync("lib/trade/dexscreener-feed.ts", "utf8");
  assert.match(feed, /\.sort\(byTrending\)/);
  // The Night Market ranks per window (market-filters.ts); that score takes the same small bonus.
  const nmSrc = readFileSync("app/night-market/NightMarketClient.tsx", "utf8");
  assert.match(nmSrc, /trendingScoreFor\(t, tf\)/);
  assert.match(readFileSync("lib/trade/market-filters.ts", "utf8"), /score \*= 1 \+ BOOST_BONUS/);
  for (const src of [feed, nmSrc]) assert.doesNotMatch(src, /boost[AB]? \* 100_000/);
  const nm = readFileSync("app/night-market/NightMarketClient.tsx", "utf8");
  assert.match(nm, /if \(boostedOnly\) filtered = filtered\.filter/, "the Boosted chip filters the list");
});
