/**
 * Analytics persistence boundary (AGENTS.md §1).
 *
 * All analytics database reads and writes go through this module. Routes and
 * domain logic never import Drizzle or touch a connection directly — they call
 * a named function here.
 *
 * Every read gates on isDatabaseConfigured() (AGENTS.md §4, §8 #9). When the
 * DB is unconfigured, reads return { available: false } shapes rather than
 * throwing or falsely publishing "0 visitors".
 */

import { database, isDatabaseConfigured } from "@/lib/db/client";
import {
  analyticsIngestState,
  analyticsRollupsHourly,
  analyticsPagesDaily,
  analyticsReferrersDaily,
  analyticsCountriesDaily,
  analyticsDevicesDaily,
  analyticsVisitorHours,
  analyticsVisitorPages,
  analyticsVisitorCountries,
} from "@/lib/db/schema";
import { sql, gte, desc, and, eq } from "drizzle-orm";
import type {
  BatchResult,
  HourlyBucket,
} from "./analytics-ingest";
import { computeP95, computeAvg } from "./analytics-ingest";

// ── Types ───────────────────────────────────────────────────────────────────

export type TimeRange = "24h" | "7d" | "30d";

export interface AnalyticsSummary {
  available: boolean;
  totalViews: number;
  totalUniqueVisitors: number;
  totalBytes: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorRatePercent: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  previousPeriodDelta: {
    viewsDeltaPercent: number;
    visitorsDeltaPercent: number;
  };
}

export interface TimeseriesPoint {
  timestamp: string;
  views: number;
  visitors: number;
  latencyMs: number;
  p95LatencyMs: number;
  errors: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  bytes: number;
}

export interface TopRankedItem {
  name: string;
  code?: string;
  count: number;
  uniqueCount?: number;
  percentage: number;
  /** Pages only (0097). Undefined means this ranking has no latency to report,
   *  which is NOT the same as a path that was served instantly — referrers and
   *  countries are ranked by hits and never carry a timing. */
  avgLatencyMs?: number;
  p95LatencyMs?: number;
  /** Requests the average is over. Zero means nothing was measured yet. */
  latencySamples?: number;
}

export interface DeviceBreakdown {
  devices: TopRankedItem[];
  browsers: TopRankedItem[];
  os: TopRankedItem[];
  bots: TopRankedItem[];
  botPercentage: number;
  humanPercentage: number;
}

export interface IngestHealth {
  available: boolean;
  lastIngestedAt: string | null;
}

/** One row per day per top bot, zero-filled — the bot tab's trend sparkline. */
export interface BotTrend {
  dates: string[]; // "YYYY-MM-DD", ascending
  series: Array<{ name: string; hits: number[] }>; // hits[i] aligns with dates[i]
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const EMPTY_SUMMARY: AnalyticsSummary = {
  available: false,
  totalViews: 0,
  totalUniqueVisitors: 0,
  totalBytes: 0,
  avgLatencyMs: 0,
  p95LatencyMs: 0,
  errorRatePercent: 0,
  status2xx: 0,
  status3xx: 0,
  status4xx: 0,
  status5xx: 0,
  previousPeriodDelta: { viewsDeltaPercent: 0, visitorsDeltaPercent: 0 },
};

function rangeHours(range: TimeRange): number {
  if (range === "24h") return 24;
  if (range === "7d") return 168;
  return 720; // 30d
}

function rangeSince(range: TimeRange): Date {
  return new Date(Date.now() - rangeHours(range) * 3600_000);
}

function prevRangeSince(range: TimeRange): Date {
  return new Date(Date.now() - rangeHours(range) * 2 * 3600_000);
}

function dateSince(range: TimeRange): string {
  return rangeSince(range).toISOString().slice(0, 10);
}

function prevDateSince(range: TimeRange): string {
  return prevRangeSince(range).toISOString().slice(0, 10);
}

export function hourFloor(d: Date): Date {
  const f = new Date(d);
  f.setUTCMinutes(0, 0, 0);
  return f;
}

/**
 * Exactly `rangeHours(range)` consecutive hourly bucket keys, half-open
 * `[start, endExclusive)`. The dashboard chart's X axis is spaced by array
 * index, not by parsing each timestamp, so a gap hour with no traffic must
 * still occupy a slot — otherwise two real hours either side of a silent one
 * render as adjacent, silently compressing elapsed time on the axis.
 *
 * `endExclusive` must already be hour-floored. Passing `hourFloor(now) + 1h`
 * makes the last slot "now"'s own in-progress bucket; chaining a second call
 * with `endExclusive = <the first grid's start>` gives the immediately
 * preceding window of the same length, for the comparison overlay.
 */
export function denseHourlyGrid(range: TimeRange, endExclusive: Date): string[] {
  const hours = rangeHours(range);
  const endMs = endExclusive.getTime();
  const startMs = endMs - hours * 3600_000;
  const grid: string[] = [];
  for (let t = startMs; t < endMs; t += 3600_000) {
    grid.push(new Date(t).toISOString());
  }
  return grid;
}

/** Inclusive "YYYY-MM-DD" days from `sinceIsoDate` through today (UTC), ascending. */
function denseDailyGrid(sinceIsoDate: string): string[] {
  const start = new Date(`${sinceIsoDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

function deltaPercent(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

// ── Write helpers (called by the ingest job) ────────────────────────────────

/** Upsert hourly rollup from a single batch bucket. */
export async function upsertHourlyRollup(
  bucketHour: string,
  bucket: HourlyBucket,
): Promise<void> {
  const conn = database();
  if (!conn) return;

  const avgMs = computeAvg(bucket.latencies);
  const p95Ms = computeP95(bucket.latencies);

  // Record presence for every hash seen this tick, THEN recompute the
  // period's true distinct count from the presence table — never add this
  // tick's local Set size onto the stored total. See HANDOFF.md §1.
  if (bucket.uniqueVisitorHashes.size > 0) {
    await conn
      .insert(analyticsVisitorHours)
      .values(
        [...bucket.uniqueVisitorHashes].map((visitorHash) => ({
          bucketHour,
          visitorHash,
        })),
      )
      .onConflictDoNothing();
  }

  const [countRow] = await conn
    .select({ count: sql<number>`count(*)` })
    .from(analyticsVisitorHours)
    .where(eq(analyticsVisitorHours.bucketHour, bucketHour));
  // pg returns count(*) as a string via the default driver type parser —
  // Number(...) handles both that and the plain-number case.
  const trueUniqueVisitors = Number(countRow?.count ?? 0);

  await conn
    .insert(analyticsRollupsHourly)
    .values({
      bucketHour,
      pageviews: bucket.pageviews,
      uniqueVisitors: trueUniqueVisitors,
      bytesTransferred: bucket.bytesTransferred,
      avgLatencyMs: avgMs.toFixed(2),
      p95LatencyMs: p95Ms.toFixed(2),
      status2xx: bucket.status2xx,
      status3xx: bucket.status3xx,
      status4xx: bucket.status4xx,
      status5xx: bucket.status5xx,
    })
    .onConflictDoUpdate({
      target: analyticsRollupsHourly.bucketHour,
      set: {
        pageviews: sql`${analyticsRollupsHourly.pageviews} + ${bucket.pageviews}`,
        // Absolute set, not additive — trueUniqueVisitors is already the
        // period's full distinct count, computed AFTER this tick's hashes
        // were merged into the presence table above.
        uniqueVisitors: trueUniqueVisitors,
        bytesTransferred: sql`${analyticsRollupsHourly.bytesTransferred} + ${bucket.bytesTransferred}`,
        avgLatencyMs: sql`round((${analyticsRollupsHourly.avgLatencyMs}::numeric * ${analyticsRollupsHourly.pageviews}::numeric + ${avgMs}::numeric * ${bucket.pageviews}::numeric) / nullif(${analyticsRollupsHourly.pageviews}::numeric + ${bucket.pageviews}::numeric, 0), 2)`,
        p95LatencyMs: sql`greatest(${analyticsRollupsHourly.p95LatencyMs}::numeric, ${p95Ms.toFixed(2)}::numeric)`,
        status2xx: sql`${analyticsRollupsHourly.status2xx} + ${bucket.status2xx}`,
        status3xx: sql`${analyticsRollupsHourly.status3xx} + ${bucket.status3xx}`,
        status4xx: sql`${analyticsRollupsHourly.status4xx} + ${bucket.status4xx}`,
        status5xx: sql`${analyticsRollupsHourly.status5xx} + ${bucket.status5xx}`,
      },
    });
}

/** Upsert daily page stats. */
export async function upsertPageDaily(
  bucketDate: string,
  normalizedPath: string,
  pageviews: number,
  visitorHashes: Set<string>,
  latencies: number[] = [],
): Promise<void> {
  const conn = database();
  if (!conn) return;

  if (visitorHashes.size > 0) {
    await conn
      .insert(analyticsVisitorPages)
      .values(
        [...visitorHashes].map((visitorHash) => ({
          bucketDate,
          normalizedPath,
          visitorHash,
        })),
      )
      .onConflictDoNothing();
  }

  const [countRow] = await conn
    .select({ count: sql<number>`count(*)` })
    .from(analyticsVisitorPages)
    .where(
      and(
        eq(analyticsVisitorPages.bucketDate, bucketDate),
        eq(analyticsVisitorPages.normalizedPath, normalizedPath),
      ),
    );
  const trueUniqueVisitors = Number(countRow?.count ?? 0);

  const avgMs = computeAvg(latencies);
  const p95Ms = computeP95(latencies);
  const samples = latencies.length;

  await conn
    .insert(analyticsPagesDaily)
    .values({
      bucketDate,
      normalizedPath,
      pageviews,
      uniqueVisitors: trueUniqueVisitors,
      avgLatencyMs: avgMs.toFixed(2),
      p95LatencyMs: p95Ms.toFixed(2),
      latencySamples: samples,
    })
    .onConflictDoUpdate({
      target: [analyticsPagesDaily.bucketDate, analyticsPagesDaily.normalizedPath],
      set: {
        pageviews: sql`${analyticsPagesDaily.pageviews} + ${pageviews}`,
        uniqueVisitors: trueUniqueVisitors,
        // Weighted by latencySamples, never by pageviews: a batch of pure bot
        // traffic has latencies and zero pageviews, which would weight this
        // batch at nothing and then divide by zero on the first such row.
        avgLatencyMs: sql`round((${analyticsPagesDaily.avgLatencyMs}::numeric * ${analyticsPagesDaily.latencySamples}::numeric + ${avgMs}::numeric * ${samples}::numeric) / nullif(${analyticsPagesDaily.latencySamples}::numeric + ${samples}::numeric, 0), 2)`,
        p95LatencyMs: sql`greatest(${analyticsPagesDaily.p95LatencyMs}::numeric, ${p95Ms.toFixed(2)}::numeric)`,
        latencySamples: sql`${analyticsPagesDaily.latencySamples} + ${samples}`,
      },
    });
}

/** Upsert daily referrer stats. */
export async function upsertReferrerDaily(
  bucketDate: string,
  referrerDomain: string,
  hits: number,
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .insert(analyticsReferrersDaily)
    .values({ bucketDate, referrerDomain, hits })
    .onConflictDoUpdate({
      target: [analyticsReferrersDaily.bucketDate, analyticsReferrersDaily.referrerDomain],
      set: {
        hits: sql`${analyticsReferrersDaily.hits} + ${hits}`,
      },
    });
}

/** Upsert daily country stats. */
export async function upsertCountryDaily(
  bucketDate: string,
  countryCode: string,
  pageviews: number,
  visitorHashes: Set<string>,
): Promise<void> {
  const conn = database();
  if (!conn) return;

  if (visitorHashes.size > 0) {
    await conn
      .insert(analyticsVisitorCountries)
      .values(
        [...visitorHashes].map((visitorHash) => ({
          bucketDate,
          countryCode,
          visitorHash,
        })),
      )
      .onConflictDoNothing();
  }

  const [countRow] = await conn
    .select({ count: sql<number>`count(*)` })
    .from(analyticsVisitorCountries)
    .where(
      and(
        eq(analyticsVisitorCountries.bucketDate, bucketDate),
        eq(analyticsVisitorCountries.countryCode, countryCode),
      ),
    );
  const trueUniqueVisitors = Number(countRow?.count ?? 0);

  await conn
    .insert(analyticsCountriesDaily)
    .values({ bucketDate, countryCode, pageviews, uniqueVisitors: trueUniqueVisitors })
    .onConflictDoUpdate({
      target: [analyticsCountriesDaily.bucketDate, analyticsCountriesDaily.countryCode],
      set: {
        pageviews: sql`${analyticsCountriesDaily.pageviews} + ${pageviews}`,
        uniqueVisitors: trueUniqueVisitors,
      },
    });
}

/** Upsert daily device stats. */
export async function upsertDeviceDaily(
  bucketDate: string,
  deviceType: string,
  browser: string,
  os: string,
  hits: number,
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .insert(analyticsDevicesDaily)
    .values({ bucketDate, deviceType, browser, os, hits })
    .onConflictDoUpdate({
      target: [
        analyticsDevicesDaily.bucketDate,
        analyticsDevicesDaily.deviceType,
        analyticsDevicesDaily.browser,
        analyticsDevicesDaily.os,
      ],
      set: {
        hits: sql`${analyticsDevicesDaily.hits} + ${hits}`,
      },
    });
}

/** Read the current ingest cursor. Returns null if no cursor exists yet. */
export async function readIngestCursor(): Promise<{
  fileInode: number;
  byteOffset: number;
} | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select({
      fileInode: analyticsIngestState.fileInode,
      byteOffset: analyticsIngestState.byteOffset,
    })
    .from(analyticsIngestState)
    .limit(1);

  if (rows.length === 0) return null;
  return { fileInode: rows[0]!.fileInode, byteOffset: rows[0]!.byteOffset };
}

/** Save the ingest cursor (upsert into the single-row table). */
export async function saveIngestCursor(
  fileInode: number,
  byteOffset: number,
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .insert(analyticsIngestState)
    .values({ id: 1, fileInode, byteOffset })
    .onConflictDoUpdate({
      target: analyticsIngestState.id,
      set: {
        fileInode,
        byteOffset,
        lastIngestedAt: sql`now()`,
      },
    });
}

/** Persist a full batch result from processLogBatch. */
export async function persistBatchResult(batch: BatchResult): Promise<void> {
  // Hourly rollups
  for (const [hourKey, bucket] of batch.hourly) {
    await upsertHourlyRollup(hourKey, bucket);
  }

  // Pages
  for (const [key, bucket] of batch.pages) {
    const [date, path] = key.split("|", 2) as [string, string];
    await upsertPageDaily(date, path, bucket.pageviews, bucket.uniqueVisitorHashes, bucket.latencies);
  }

  // Referrers
  for (const [key, bucket] of batch.referrers) {
    const [date, domain] = key.split("|", 2) as [string, string];
    await upsertReferrerDaily(date, domain, bucket.hits);
  }

  // Countries
  for (const [key, bucket] of batch.countries) {
    const [date, code] = key.split("|", 2) as [string, string];
    await upsertCountryDaily(date, code, bucket.pageviews, bucket.uniqueVisitorHashes);
  }

  // Devices
  for (const [key, bucket] of batch.devices) {
    const parts = key.split("|", 4) as [string, string, string, string];
    await upsertDeviceDaily(parts[0], parts[1], parts[2], parts[3], bucket.hits);
  }
}

// ── Read helpers (called by the dashboard) ──────────────────────────────────

export async function readAnalyticsSummary(
  range: TimeRange,
): Promise<AnalyticsSummary> {
  if (!isDatabaseConfigured()) return EMPTY_SUMMARY;
  const conn = database();
  if (!conn) return EMPTY_SUMMARY;

  const since = rangeSince(range).toISOString();
  const prevSince = prevRangeSince(range).toISOString();

  // Current period
  const currentRows = await conn
    .select({
      totalViews: sql<number>`coalesce(sum(${analyticsRollupsHourly.pageviews}), 0)`,
      totalBytes: sql<number>`coalesce(sum(${analyticsRollupsHourly.bytesTransferred}), 0)`,
      avgLatency: sql<number>`coalesce(sum(${analyticsRollupsHourly.avgLatencyMs} * ${analyticsRollupsHourly.pageviews}) / nullif(sum(${analyticsRollupsHourly.pageviews}), 0), 0)`,
      maxP95: sql<number>`coalesce(max(${analyticsRollupsHourly.p95LatencyMs}), 0)`,
      total2xx: sql<number>`coalesce(sum(${analyticsRollupsHourly.status2xx}), 0)`,
      total3xx: sql<number>`coalesce(sum(${analyticsRollupsHourly.status3xx}), 0)`,
      total4xx: sql<number>`coalesce(sum(${analyticsRollupsHourly.status4xx}), 0)`,
      total5xx: sql<number>`coalesce(sum(${analyticsRollupsHourly.status5xx}), 0)`,
    })
    .from(analyticsRollupsHourly)
    .where(gte(analyticsRollupsHourly.bucketHour, since));

  // Previous period (for delta)
  const prevRows = await conn
    .select({
      totalViews: sql<number>`coalesce(sum(${analyticsRollupsHourly.pageviews}), 0)`,
    })
    .from(analyticsRollupsHourly)
    .where(
      and(
        gte(analyticsRollupsHourly.bucketHour, prevSince),
        sql`${analyticsRollupsHourly.bucketHour} < ${since}`,
      ),
    );

  /**
   * Distinct visitors over the WHOLE window, from the presence table.
   *
   * This used to be `sum(analytics_rollups_hourly.unique_visitors)`, which is a
   * sum of per-hour distinct counts: one person reading for three hours counted
   * three times, and a 30-day window could inflate by up to 720x. Migration
   * 0074 built these presence tables to kill exactly this bug at the WRITE path
   * (a visitor spanning two ingest ticks was counted twice) and the read path
   * was never moved over with it, so the same error survived one layer up. The
   * hourly column stays correct for its own row and is still what the
   * timeseries chart plots per hour; it is only unsafe to ADD UP.
   *
   * What this number means: `visitor_hash` is salted with the UTC DATE, so two
   * visits on the same day collapse to one and two visits on different days
   * cannot be linked. Within a day this is an exact distinct count. Across a
   * multi-day range it is distinct VISITOR-DAYS, which is the most this design
   * can honestly report — the daily rotation is a privacy property, not a bug
   * to fix here.
   */
  const distinctVisitorsSince = async (from: string, until?: string) => {
    const rows = await conn
      .select({ n: sql<number>`count(distinct ${analyticsVisitorHours.visitorHash})` })
      .from(analyticsVisitorHours)
      .where(
        until
          ? and(
              gte(analyticsVisitorHours.bucketHour, from),
              sql`${analyticsVisitorHours.bucketHour} < ${until}`,
            )
          : gte(analyticsVisitorHours.bucketHour, from),
      );
    return Number(rows[0]?.n ?? 0);
  };
  const curUv = await distinctVisitorsSince(since);
  const prevUv = await distinctVisitorsSince(prevSince, since);

  const cur = currentRows[0]!;
  const prev = prevRows[0]!;
  const totalRequests = Number(cur.totalViews);
  const totalErrors = Number(cur.total4xx) + Number(cur.total5xx);

  return {
    available: true,
    totalViews: totalRequests,
    totalUniqueVisitors: curUv,
    totalBytes: Number(cur.totalBytes),
    avgLatencyMs: Math.round(Number(cur.avgLatency) * 100) / 100,
    p95LatencyMs: Math.round(Number(cur.maxP95) * 100) / 100,
    status2xx: Number(cur.total2xx),
    status3xx: Number(cur.total3xx),
    status4xx: Number(cur.total4xx),
    status5xx: Number(cur.total5xx),
    errorRatePercent:
      totalRequests > 0
        ? Math.round((totalErrors / totalRequests) * 10000) / 100
        : 0,
    previousPeriodDelta: {
      viewsDeltaPercent: deltaPercent(totalRequests, Number(prev.totalViews)),
      visitorsDeltaPercent: deltaPercent(curUv, prevUv),
    },
  };
}

export function zeroPoint(timestamp: string): TimeseriesPoint {
  return {
    timestamp,
    views: 0,
    visitors: 0,
    latencyMs: 0,
    p95LatencyMs: 0,
    errors: 0,
    status2xx: 0,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
    bytes: 0,
  };
}

/** Shared query behind both the current and previous-period timeseries reads. */
async function queryHourlyRange(
  conn: NonNullable<ReturnType<typeof database>>,
  sinceIso: string,
  untilIso: string | null,
): Promise<TimeseriesPoint[]> {
  const rows = await conn
    .select({
      timestamp: analyticsRollupsHourly.bucketHour,
      views: analyticsRollupsHourly.pageviews,
      visitors: analyticsRollupsHourly.uniqueVisitors,
      latencyMs: analyticsRollupsHourly.avgLatencyMs,
      p95LatencyMs: analyticsRollupsHourly.p95LatencyMs,
      status2xx: analyticsRollupsHourly.status2xx,
      status3xx: analyticsRollupsHourly.status3xx,
      status4xx: analyticsRollupsHourly.status4xx,
      status5xx: analyticsRollupsHourly.status5xx,
      bytes: analyticsRollupsHourly.bytesTransferred,
      errors: sql<number>`${analyticsRollupsHourly.status4xx} + ${analyticsRollupsHourly.status5xx}`,
    })
    .from(analyticsRollupsHourly)
    .where(
      untilIso
        ? and(
            gte(analyticsRollupsHourly.bucketHour, sinceIso),
            sql`${analyticsRollupsHourly.bucketHour} < ${untilIso}`,
          )
        : gte(analyticsRollupsHourly.bucketHour, sinceIso),
    )
    .orderBy(analyticsRollupsHourly.bucketHour);

  return rows.map((r) => ({
    // Normalized through Date so a DB-driver text format ("2026-08-27
    // 14:00:00+00") still keys into the grid map the same way as the
    // grid's own toISOString() values.
    timestamp: new Date(r.timestamp).toISOString(),
    views: r.views,
    visitors: r.visitors,
    latencyMs: Math.round(Number(r.latencyMs) * 100) / 100,
    p95LatencyMs: Math.round(Number(r.p95LatencyMs) * 100) / 100,
    errors: Number(r.errors),
    status2xx: Number(r.status2xx),
    status3xx: Number(r.status3xx),
    status4xx: Number(r.status4xx),
    status5xx: Number(r.status5xx),
    bytes: Number(r.bytes),
  }));
}

/** Zero-fills a dense hourly grid from whatever rows actually exist. */
export function toDenseGrid(grid: string[], rows: TimeseriesPoint[]): TimeseriesPoint[] {
  const byHour = new Map(rows.map((r) => [r.timestamp, r]));
  return grid.map((hour) => byHour.get(hour) ?? zeroPoint(hour));
}

export async function readAnalyticsTimeseries(
  range: TimeRange,
): Promise<TimeseriesPoint[]> {
  if (!isDatabaseConfigured()) return [];
  const conn = database();
  if (!conn) return [];

  const currentEndExclusive = new Date(hourFloor(new Date()).getTime() + 3600_000);
  const grid = denseHourlyGrid(range, currentEndExclusive);
  const rows = await queryHourlyRange(conn, grid[0]!, currentEndExclusive.toISOString());
  return toDenseGrid(grid, rows);
}

/**
 * The immediately preceding window, same length, zero-filled the same way —
 * built for the chart's comparison overlay. Points are aligned by index
 * ("N hours into the period"), not by calendar timestamp, since the two
 * windows cover different calendar days.
 */
export async function readPreviousPeriodTimeseries(
  range: TimeRange,
): Promise<TimeseriesPoint[]> {
  if (!isDatabaseConfigured()) return [];
  const conn = database();
  if (!conn) return [];

  const currentEndExclusive = new Date(hourFloor(new Date()).getTime() + 3600_000);
  const currentStart = denseHourlyGrid(range, currentEndExclusive)[0]!;
  const grid = denseHourlyGrid(range, new Date(currentStart));
  const rows = await queryHourlyRange(conn, grid[0]!, currentStart);
  return toDenseGrid(grid, rows);
}

export async function readTopPages(
  range: TimeRange,
  limit = 10,
): Promise<TopRankedItem[]> {
  if (!isDatabaseConfigured()) return [];
  const conn = database();
  if (!conn) return [];

  const since = dateSince(range);

  const rows = await conn
    .select({
      name: analyticsPagesDaily.normalizedPath,
      count: sql<number>`sum(${analyticsPagesDaily.pageviews})`,
      uniqueCount: sql<number>`sum(${analyticsPagesDaily.uniqueVisitors})`,
      // Across days the average has to be re-weighted by the samples behind
      // each day, not averaged; p95 stays an upper bound, as it is per row.
      avgLatencyMs: sql<number>`coalesce(sum(${analyticsPagesDaily.avgLatencyMs}::numeric * ${analyticsPagesDaily.latencySamples}::numeric) / nullif(sum(${analyticsPagesDaily.latencySamples}::numeric), 0), 0)`,
      p95LatencyMs: sql<number>`coalesce(max(${analyticsPagesDaily.p95LatencyMs}::numeric), 0)`,
      latencySamples: sql<number>`coalesce(sum(${analyticsPagesDaily.latencySamples}), 0)`,
    })
    .from(analyticsPagesDaily)
    .where(gte(analyticsPagesDaily.bucketDate, since))
    .groupBy(analyticsPagesDaily.normalizedPath)
    .orderBy(desc(sql`sum(${analyticsPagesDaily.pageviews})`))
    .limit(limit);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return rows.map((r) => ({
    name: r.name,
    count: Number(r.count),
    uniqueCount: Number(r.uniqueCount),
    percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
    avgLatencyMs: Math.round(Number(r.avgLatencyMs) * 100) / 100,
    p95LatencyMs: Math.round(Number(r.p95LatencyMs) * 100) / 100,
    latencySamples: Number(r.latencySamples),
  }));
}

export async function readTopReferrers(
  range: TimeRange,
  limit = 10,
): Promise<TopRankedItem[]> {
  if (!isDatabaseConfigured()) return [];
  const conn = database();
  if (!conn) return [];

  const since = dateSince(range);

  const rows = await conn
    .select({
      name: analyticsReferrersDaily.referrerDomain,
      count: sql<number>`sum(${analyticsReferrersDaily.hits})`,
    })
    .from(analyticsReferrersDaily)
    .where(gte(analyticsReferrersDaily.bucketDate, since))
    .groupBy(analyticsReferrersDaily.referrerDomain)
    .orderBy(desc(sql`sum(${analyticsReferrersDaily.hits})`))
    .limit(limit);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return rows.map((r) => ({
    name: r.name,
    count: Number(r.count),
    percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
  }));
}

export async function readCountryDistribution(
  range: TimeRange,
  limit = 10,
): Promise<TopRankedItem[]> {
  if (!isDatabaseConfigured()) return [];
  const conn = database();
  if (!conn) return [];

  const since = dateSince(range);

  const rows = await conn
    .select({
      code: analyticsCountriesDaily.countryCode,
      count: sql<number>`sum(${analyticsCountriesDaily.pageviews})`,
      uniqueCount: sql<number>`sum(${analyticsCountriesDaily.uniqueVisitors})`,
    })
    .from(analyticsCountriesDaily)
    .where(gte(analyticsCountriesDaily.bucketDate, since))
    .groupBy(analyticsCountriesDaily.countryCode)
    .orderBy(desc(sql`sum(${analyticsCountriesDaily.pageviews})`))
    .limit(limit);

  const total = rows.reduce((s, r) => s + Number(r.count), 0);
  return rows.map((r) => ({
    name: r.code,
    code: r.code,
    count: Number(r.count),
    uniqueCount: Number(r.uniqueCount),
    percentage: total > 0 ? Math.round((Number(r.count) / total) * 1000) / 10 : 0,
  }));
}

export async function readDeviceBreakdown(
  range: TimeRange,
): Promise<DeviceBreakdown> {
  const empty: DeviceBreakdown = {
    devices: [],
    browsers: [],
    os: [],
    bots: [],
    botPercentage: 0,
    humanPercentage: 100,
  };
  if (!isDatabaseConfigured()) return empty;
  const conn = database();
  if (!conn) return empty;

  const since = dateSince(range);

  const rows = await conn
    .select({
      deviceType: analyticsDevicesDaily.deviceType,
      browser: analyticsDevicesDaily.browser,
      os: analyticsDevicesDaily.os,
      hits: sql<number>`sum(${analyticsDevicesDaily.hits})`,
    })
    .from(analyticsDevicesDaily)
    .where(gte(analyticsDevicesDaily.bucketDate, since))
    .groupBy(
      analyticsDevicesDaily.deviceType,
      analyticsDevicesDaily.browser,
      analyticsDevicesDaily.os,
    )
    .orderBy(desc(sql`sum(${analyticsDevicesDaily.hits})`));

  // Aggregate into ranked lists
  const deviceMap = new Map<string, number>();
  const browserMap = new Map<string, number>();
  const osMap = new Map<string, number>();
  const botMap = new Map<string, number>();

  let totalHits = 0;
  let botHits = 0;

  for (const r of rows) {
    const h = Number(r.hits);
    totalHits += h;
    const isBot = r.deviceType === "bot";

    if (isBot) {
      botHits += h;
      botMap.set(r.browser, (botMap.get(r.browser) ?? 0) + h);
    } else {
      browserMap.set(r.browser, (browserMap.get(r.browser) ?? 0) + h);
      osMap.set(r.os, (osMap.get(r.os) ?? 0) + h);
    }
    deviceMap.set(r.deviceType, (deviceMap.get(r.deviceType) ?? 0) + h);
  }

  function toRanked(map: Map<string, number>): TopRankedItem[] {
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({
        name,
        count,
        percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }));
  }

  const botPercentage =
    totalHits > 0 ? Math.round((botHits / totalHits) * 1000) / 10 : 0;
  const humanPercentage =
    totalHits > 0
      ? Math.round(((totalHits - botHits) / totalHits) * 1000) / 10
      : 100;

  return {
    devices: toRanked(deviceMap),
    browsers: toRanked(browserMap),
    os: toRanked(osMap),
    bots: toRanked(botMap),
    botPercentage,
    humanPercentage,
  };
}

/**
 * Freshness of the ingest pipeline itself — the dashboard header's "last
 * ingested" readout. Distinct from every other read here: this is the one
 * number that tells an admin whether the cron is actually running, not what
 * it found.
 */
export async function readIngestHealth(): Promise<IngestHealth> {
  if (!isDatabaseConfigured()) return { available: false, lastIngestedAt: null };
  const conn = database();
  if (!conn) return { available: false, lastIngestedAt: null };

  const rows = await conn
    .select({ lastIngestedAt: analyticsIngestState.lastIngestedAt })
    .from(analyticsIngestState)
    .limit(1);

  if (rows.length === 0) return { available: true, lastIngestedAt: null };
  return { available: true, lastIngestedAt: rows[0]!.lastIngestedAt };
}

/**
 * Per-day hit trend for the top bots/crawlers in the range (analytics_devices_daily
 * has no hourly granularity, so "trend" here is daily — honest for 7d/30d,
 * a single point for 24h). Dense-filled the same way as the hourly grid: a
 * bot with zero hits on one day of an otherwise-active week must still show
 * as a dip, not a gap that silently reindexes the remaining days.
 */
export async function readBotTrend(range: TimeRange, limit = 6): Promise<BotTrend> {
  const empty: BotTrend = { dates: [], series: [] };
  if (!isDatabaseConfigured()) return empty;
  const conn = database();
  if (!conn) return empty;

  const since = dateSince(range);
  const dates = denseDailyGrid(since);

  const rows = await conn
    .select({
      bucketDate: analyticsDevicesDaily.bucketDate,
      browser: analyticsDevicesDaily.browser,
      hits: sql<number>`sum(${analyticsDevicesDaily.hits})`,
    })
    .from(analyticsDevicesDaily)
    .where(
      and(
        eq(analyticsDevicesDaily.deviceType, "bot"),
        gte(analyticsDevicesDaily.bucketDate, since),
      ),
    )
    .groupBy(analyticsDevicesDaily.bucketDate, analyticsDevicesDaily.browser);

  const totalByBot = new Map<string, number>();
  const hitsByBotAndDate = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const hits = Number(r.hits);
    totalByBot.set(r.browser, (totalByBot.get(r.browser) ?? 0) + hits);
    const byDate = hitsByBotAndDate.get(r.browser) ?? new Map<string, number>();
    // bucketDate is a `date` column; normalize the same way the hourly grid
    // does so a driver's own text format still keys into `dates` correctly.
    byDate.set(new Date(r.bucketDate).toISOString().slice(0, 10), hits);
    hitsByBotAndDate.set(r.browser, byDate);
  }

  const topBots = [...totalByBot.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);

  const series = topBots.map((name) => {
    const byDate = hitsByBotAndDate.get(name) ?? new Map<string, number>();
    return { name, hits: dates.map((d) => byDate.get(d) ?? 0) };
  });

  return { dates, series };
}
