import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchState } from "../lib/db/schema.ts";

const root = join(import.meta.dirname, "..");
const migrationSql = readFileSync(join(root, "supabase/migrations/0096_launch_state_liquidity_peak.sql"), "utf8");
const schemaSrc = readFileSync(join(root, "lib/db/schema.ts"), "utf8");

test("migration 0096 adds peak_liquidity_usd and zero_liquidity_readings with default 0", () => {
  assert.ok(
    migrationSql.includes("alter table launch_state add column if not exists peak_liquidity_usd numeric;"),
    "migration 0096 must add peak_liquidity_usd numeric column"
  );
  assert.ok(
    migrationSql.includes("alter table launch_state add column if not exists zero_liquidity_readings integer not null default 0;"),
    "migration 0096 must add zero_liquidity_readings with integer not null default 0"
  );
});

test("schema.ts mirrors migration 0096 with matching default on launchState", () => {
  // Extract launchState block
  const startIdx = schemaSrc.indexOf('export const launchState = pgTable("launch_state"');
  assert.ok(startIdx !== -1, "must find launchState in schema.ts");
  const endIdx = schemaSrc.indexOf("export const blockTimes", startIdx);
  assert.ok(endIdx !== -1, "must find boundary after launchState");
  const block = schemaSrc.slice(startIdx, endIdx);

  assert.ok(block.length > 100, "launchState slice must be non-empty");

  assert.ok(
    block.includes('peakLiquidityUsd: numeric("peak_liquidity_usd")'),
    "schema must declare peakLiquidityUsd"
  );
  assert.ok(
    block.includes('zeroLiquidityReadings: integer("zero_liquidity_readings").default(0).notNull()'),
    "schema must declare zeroLiquidityReadings with matching .default(0).notNull()"
  );

  // Assert on the exported Drizzle column definitions
  assert.ok(launchState.peakLiquidityUsd, "launchState.peakLiquidityUsd must exist on table");
  assert.ok(launchState.zeroLiquidityReadings, "launchState.zeroLiquidityReadings must exist on table");
  assert.equal(launchState.zeroLiquidityReadings.default, 0, "default must match SQL default 0");
  assert.equal(launchState.zeroLiquidityReadings.notNull, true, "notNull must match SQL not null");
});
