import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScanContext } from "../lib/observability/context";
import { buildScanRunRow } from "../lib/observability/scan-run";

test("buildScanRunRow lowercases mixed-case tokenAddress", () => {
  const ctx = createScanContext();
  ctx.tokenAddress = "0x020bfC650A365f8BB26819deAAbF3E21291018b4";
  const row = buildScanRunRow(ctx, { outcome: "complete" });

  assert.equal(row.tokenAddress, "0x020bfc650a365f8bb26819deaabf3e21291018b4");
});

test("buildScanRunRow sets tokenAddress to unknown when absent", () => {
  const ctx = createScanContext();
  assert.equal(ctx.tokenAddress, null);

  const row = buildScanRunRow(ctx, { outcome: "complete" });
  assert.equal(row.tokenAddress, "unknown");

  const ctxUndefined = { ...ctx, tokenAddress: undefined as unknown as string };
  const rowUndefined = buildScanRunRow(ctxUndefined, { outcome: "complete" });
  assert.equal(rowUndefined.tokenAddress, "unknown");
});

test("migration 0116 contains the idempotent scan_runs token_address lowercase update", () => {
  const migrationUrl = new URL("../supabase/migrations/0116_scan_runs_token_lowercase.sql", import.meta.url);
  const sql = readFileSync(migrationUrl, "utf8");

  assert.ok(
    sql.includes("update public.scan_runs set token_address = lower(token_address) where token_address <> lower(token_address);"),
    "migration 0116 must contain the exact lowercase update query"
  );
});
