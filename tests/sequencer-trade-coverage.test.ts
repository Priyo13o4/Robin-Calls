import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTokenTradeActivity } from "../lib/data/launches";

const root = join(import.meta.dirname, "..");
const launches = readFileSync(join(root, "lib/data/launches.ts"), "utf8");
const home = readFileSync(join(root, "app/page.tsx"), "utf8");
const band = readFileSync(join(root, "app/components/site/landing/NightMarketSection.tsx"), "utf8");

test("sequencer mode represents unavailable hourly curve trades as null", () => {
  const activity = buildTokenTradeActivity("pons-v2", [
    { hour: new Date().toISOString(), buys: 3, sells: 2 },
  ], Date.now(), false);
  assert.deepEqual(activity, { trades_1h: null, trades_hourly: null });
});

test("legacy trade coverage retains the existing measured-family rollup behavior", () => {
  const now = Date.now();
  const activity = buildTokenTradeActivity("pons-v2", [
    { hour: new Date(Math.floor(now / 3_600_000) * 3_600_000).toISOString(), buys: 3, sells: 2 },
  ], now);
  assert.equal(activity.trades_1h, 5);
  assert.equal(activity.trades_hourly?.length, 24);
});

test("launch feed reads hourly trades only when they are recorded, and keeps Dex market counts", () => {
  const start = launches.indexOf("export async function readLaunchFeed(");
  const end = launches.indexOf("export async function readLaunchFeedByAddresses", start);
  assert.ok(start >= 0 && end > start);
  const source = launches.slice(start, end);
  // Trade reads are gated on recorded coverage (legacy ingest OR a full, current sequencer record), never on the flag alone.
  assert.match(source, /const covered = curveTradeCoverage\(tradeCheckpoint, nowMs\)/);
  assert.match(source, /if \(covered && tokenAddrs\.length > 0\)/);
  assert.match(source, /hourBuys: covered/);
  assert.match(source, /hourSells: covered/);
  assert.match(source, /buildTokenTradeActivity\(l\.family, tokenTrades, nowMs, covered\)/);
  assert.match(source, /buys_24h: r\.buys24h \?\? r\.hourBuys \?\? null/);
  assert.match(source, /sells_24h: r\.sells24h \?\? r\.hourSells \?\? null/);
});

test("landing page skips curve trade count and labels missing coverage as unavailable", () => {
  assert.match(home, /flags\.launchIngest \? countCurveTrades24h\(\) : Promise\.resolve\(null\)/);
  assert.match(band, /trades24h: number \| null/);
  assert.match(band, /stats\.trades24h === null \? "Curve trade history unavailable"/);
  assert.match(band, /t\.value !== null \? t\.value\.toLocaleString\("en-US"\) : "—"/);
});
