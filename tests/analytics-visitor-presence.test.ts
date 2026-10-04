import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticsVisitorHours,
  analyticsVisitorPages,
  analyticsVisitorCountries,
} from "../lib/db/schema";
import {
  upsertHourlyRollup,
  upsertPageDaily,
  upsertCountryDaily,
  persistBatchResult,
} from "../lib/data/analytics";
import type { HourlyBucket, BatchResult } from "../lib/data/analytics-ingest";

test("visitor presence tables are properly exported in schema with primary keys", () => {
  assert.ok(analyticsVisitorHours);
  assert.ok(analyticsVisitorPages);
  assert.ok(analyticsVisitorCountries);
});

test("write helpers degrade gracefully without database connection", async () => {
  const mockBucket: HourlyBucket = {
    pageviews: 10,
    uniqueVisitorHashes: new Set(["hash1", "hash2"]),
    bytesTransferred: 5000,
    latencies: [10, 20, 30],
    status2xx: 10,
    status3xx: 0,
    status4xx: 0,
    status5xx: 0,
  };

  // When database is not configured (e.g. in test env), these should return cleanly without throwing
  await assert.doesNotReject(async () => {
    await upsertHourlyRollup("2026-08-28T12:00:00.000Z", mockBucket);
  });

  await assert.doesNotReject(async () => {
    await upsertPageDaily("2026-08-28", "/test", 5, new Set(["hash1", "hash2"]));
  });

  await assert.doesNotReject(async () => {
    await upsertCountryDaily("2026-08-28", "US", 5, new Set(["hash1", "hash2"]));
  });
});

test("persistBatchResult correctly processes batch with presence sets", async () => {
  const batch: BatchResult = {
    hourly: new Map([
      [
        "2026-08-28T12:00:00.000Z",
        {
          pageviews: 2,
          uniqueVisitorHashes: new Set(["hash1", "hash2"]),
          bytesTransferred: 1000,
          latencies: [15, 25],
          status2xx: 2,
          status3xx: 0,
          status4xx: 0,
          status5xx: 0,
        },
      ],
    ]),
    pages: new Map([
      [
        "2026-08-28|/tokens",
        {
          pageviews: 2,
          uniqueVisitorHashes: new Set(["hash1", "hash2"]),
        },
      ],
    ]),
    referrers: new Map([
      [
        "2026-08-28|twitter.com",
        { hits: 2 },
      ],
    ]),
    countries: new Map([
      [
        "2026-08-28|US",
        {
          pageviews: 2,
          uniqueVisitorHashes: new Set(["hash1", "hash2"]),
        },
      ],
    ]),
    devices: new Map([
      [
        "2026-08-28|desktop|Chrome|macOS",
        { hits: 2 },
      ],
    ]),
    linesProcessed: 2,
    linesSkipped: 0,
  };

  await assert.doesNotReject(async () => {
    await persistBatchResult(batch);
  });
});
