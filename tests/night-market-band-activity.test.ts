import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bucketHourly,
  buildTokenTradeActivity,
  TRADE_MEASURED_FAMILIES,
} from "../lib/data/launches";

const root = join(import.meta.dirname, "..");
const launchesSrc = readFileSync(join(root, "lib/data/launches.ts"), "utf8");

test("bucketHourly produces exactly 24 buckets, ordered oldest first, zero-filled for empty hours", () => {
  const nowMs = 1700000000000;
  const buckets = bucketHourly([], nowMs);

  assert.equal(buckets.length, 24);
  assert.ok(buckets.every((b) => b.launches === 0), "empty input must yield zero-filled buckets");

  // Verify oldest first ordering and 1-hour intervals
  for (let i = 1; i < buckets.length; i++) {
    const prevMs = Date.parse(buckets[i - 1].hour);
    const curMs = Date.parse(buckets[i].hour);
    assert.equal(curMs - prevMs, 3600000, `bucket ${i} must be exactly 1h after bucket ${i - 1}`);
  }

  const currentHourMs = Math.floor(nowMs / 3600000) * 3600000;
  assert.equal(Date.parse(buckets[23].hour), currentHourMs, "last bucket must be the current hour");
  assert.equal(Date.parse(buckets[0].hour), currentHourMs - 23 * 3600000, "first bucket must be 23h before current hour");
});

test("bucketHourly aggregates counts within window and ignores out-of-window rows", () => {
  const nowMs = 1700000000000;
  const currentHourMs = Math.floor(nowMs / 3600000) * 3600000;

  const rows = [
    // In window
    { hour: new Date(currentHourMs).toISOString(), launches: 5 },
    { hour: new Date(currentHourMs - 2 * 3600000 + 15000).toISOString(), launches: 3 },
    { createdAt: new Date(currentHourMs - 23 * 3600000 + 45000).toISOString(), count: 2 },
    // Out of window (older than 23 hours)
    { hour: new Date(currentHourMs - 24 * 3600000).toISOString(), launches: 10 },
    { createdAt: new Date(currentHourMs - 50 * 3600000).toISOString(), count: 99 },
    // Out of window (future)
    { hour: new Date(currentHourMs + 2 * 3600000).toISOString(), launches: 7 },
  ];

  const buckets = bucketHourly(rows, nowMs);

  assert.equal(buckets.length, 24);
  assert.equal(buckets[23].launches, 5, "current hour bucket should have 5 launches");
  assert.equal(buckets[21].launches, 3, "2 hours ago bucket should have 3 launches");
  assert.equal(buckets[0].launches, 2, "23 hours ago bucket should have 2 launches");

  const totalLaunches = buckets.reduce((acc, b) => acc + b.launches, 0);
  assert.equal(totalLaunches, 10, "out-of-window rows must be ignored; total launches must equal 10");
});

test("buildTokenTradeActivity gives 24 zeroes and trades_1h = 0 for measured family with no rows", () => {
  for (const family of TRADE_MEASURED_FAMILIES) {
    const activity = buildTokenTradeActivity(family, [], Date.now());
    assert.equal(activity.trades_1h, 0, `measured family ${family} with no rows must have trades_1h === 0`);
    assert.ok(Array.isArray(activity.trades_hourly), `measured family ${family} must have trades_hourly array`);
    assert.equal(activity.trades_hourly?.length, 24, `trades_hourly must have 24 values`);
    assert.ok(activity.trades_hourly?.every((x) => x === 0), `all 24 values must be 0 for empty rows`);
  }
});

test("buildTokenTradeActivity gives null for unmeasured families (never 0)", () => {
  const unmeasured = ["cashcat-v1", "party-v1", "direct-dex", "untracked-family"];
  const nowMs = 1700000000000;
  const sampleRows = [{ hour: new Date(nowMs).toISOString(), buys: 10, sells: 5 }];

  for (const family of unmeasured) {
    const emptyAct = buildTokenTradeActivity(family, [], nowMs);
    assert.equal(emptyAct.trades_1h, null, `unmeasured family ${family} must return trades_1h: null`);
    assert.equal(emptyAct.trades_hourly, null, `unmeasured family ${family} must return trades_hourly: null`);

    const withRowsAct = buildTokenTradeActivity(family, sampleRows, nowMs);
    assert.equal(withRowsAct.trades_1h, null, `unmeasured family ${family} with rows must still return trades_1h: null`);
    assert.equal(withRowsAct.trades_hourly, null, `unmeasured family ${family} with rows must still return trades_hourly: null`);
  }
});

test("buildTokenTradeActivity: trades_1h equals the last bucket of trades_hourly", () => {
  const nowMs = 1700000000000;
  const currentHourMs = Math.floor(nowMs / 3600000) * 3600000;

  const rows = [
    { hour: new Date(currentHourMs).toISOString(), buys: 14, sells: 6 }, // 20
    { hour: new Date(currentHourMs - 3 * 3600000).toISOString(), buys: 7, sells: 3 }, // 10
    { hour: new Date(currentHourMs - 23 * 3600000).toISOString(), trades: 4 }, // 4
  ];

  const activity = buildTokenTradeActivity("pons-v2", rows, nowMs);
  assert.ok(activity.trades_hourly !== null, "trades_hourly must not be null for measured family");
  assert.equal(activity.trades_1h, 20, "trades_1h must match current hour sum (14 + 6)");
  assert.equal(activity.trades_hourly[23], 20, "last bucket must be 20");
  assert.equal(activity.trades_1h, activity.trades_hourly[activity.trades_hourly.length - 1]);
  assert.equal(activity.trades_hourly[20], 10, "3 hours ago bucket must be 10");
  assert.equal(activity.trades_hourly[0], 4, "oldest bucket must be 4");
});

test("countCurveGraduations24h source extraction asserts venue filter and 60-second exclusion", () => {
  const startIdx = launchesSrc.indexOf("export async function countCurveGraduations24h");
  assert.ok(startIdx !== -1, "must find countCurveGraduations24h in lib/data/launches.ts");

  const endIdx = launchesSrc.indexOf("export async function countCurveTrades24h", startIdx);
  assert.ok(endIdx !== -1, "must find boundary after countCurveGraduations24h");

  const fnSrc = launchesSrc.slice(startIdx, endIdx);
  // CLAUDE.md §8 #22: assert the slice is non-empty first
  assert.ok(fnSrc.length > 50, "extracted countCurveGraduations24h slice must be non-empty");

  assert.ok(
    fnSrc.includes("interval '60 seconds'"),
    "countCurveGraduations24h must exclude same-tick graduations with interval '60 seconds'"
  );
  assert.ok(
    fnSrc.includes('"CURVE"') && fnSrc.includes('"HOOK_CURVE"'),
    "countCurveGraduations24h must filter for CURVE and HOOK_CURVE venues"
  );
  assert.ok(
    fnSrc.includes('"GRADUATED"'),
    "countCurveGraduations24h must filter for GRADUATED event kind"
  );
});

test("upsertMarketReadings source extraction asserts price_change_h1 in values and conflict set", () => {
  const startIdx = launchesSrc.indexOf("export async function upsertMarketReadings");
  assert.ok(startIdx !== -1, "must find upsertMarketReadings in lib/data/launches.ts");

  const endIdx = launchesSrc.indexOf("export async function touchMarketReadAt", startIdx);
  assert.ok(endIdx !== -1, "must find boundary after upsertMarketReadings");

  const fnSrc = launchesSrc.slice(startIdx, endIdx);
  // CLAUDE.md §8 #22: assert the slice is non-empty first
  assert.ok(fnSrc.length > 50, "extracted upsertMarketReadings slice must be non-empty");

  assert.ok(
    fnSrc.includes("priceChangeH1:"),
    "upsertMarketReadings must write priceChangeH1 in values payload"
  );
  assert.ok(
    fnSrc.includes("excluded.price_change_h1"),
    "upsertMarketReadings must update priceChangeH1 in onConflictDoUpdate set"
  );
});
