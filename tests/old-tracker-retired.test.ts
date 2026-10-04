import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The old tracker must be retired outright: no route cron could still call, and every prod job unscheduled.
const root = join(import.meta.dirname, "..");
const sql = readFileSync(join(root, "supabase/migrations/0093_launch_registry.sql"), "utf8");

// Active on prod (cron.job, read 2026-09-14) plus the rug recheck, which prod may or may not carry.
const OLD_JOBS = [
  "robincalls-curve-poll",
  "robincalls-tracker-poll",
  "robincalls-curve-retention",
  "robincalls-launch-retention",
  "robincalls-curve-rug-recheck",
];

test("0093 unschedules every old tracker job", () => {
  const list = sql.match(/foreach j in array array\[([\s\S]*?)\]/);
  assert.ok(list, "extracted the unschedule list");
  const names = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(names.length >= OLD_JOBS.length, `extracted ${names.length} names`);
  for (const job of OLD_JOBS) assert.ok(names.includes(job), `${job} is not unscheduled`);
  assert.match(sql, /perform cron\.unschedule\(j\)/);
});

test("0093 schedules the replacement jobs", () => {
  assert.match(sql, /rc_schedule_job\('robincalls-launch-ingest', '\* \* \* \* \*', '\/api\/jobs\/launch-ingest'\)/);
  assert.match(sql, /rc_schedule_job\('robincalls-launch-maintenance', '17 \* \* \* \*', '\/api\/jobs\/launch-maintenance'\)/);
});

test("no old tracker route or module survives for a leftover schedule to reach", () => {
  for (const route of ["curve-poll", "tracker-poll", "curve-retention", "curve-rug-recheck", "launch-retention"]) {
    assert.equal(existsSync(join(root, "app/api/jobs", route)), false, `app/api/jobs/${route} still exists`);
  }
  assert.equal(existsSync(join(root, "lib/tracker")), false, "lib/tracker still exists");
});
