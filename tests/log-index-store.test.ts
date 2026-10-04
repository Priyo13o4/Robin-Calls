import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import { poolLogIndex } from "../lib/db/schema";
import {
  buildLogIndexRow,
  parseStoredBlock,
  readLogIndex,
  writeLogIndex,
} from "../lib/data/log-index";

/**
 * Persistence contract for `pool_log_index` (migration 0044).
 *
 * These assert the CONTRACT, not values (CLAUDE.md §7). The failure this table
 * is most exposed to is invisible at every layer: Drizzle silently DISCARDS
 * object keys that do not match a column — no throw, no type error — which is
 * how `scan_runs` recorded zero rows in production while typechecking clean
 * with a passing test (§8.1). The second exposure is schema-vs-SQL drift
 * (§8.6), since `lib/db/schema.ts` is introspection-generated and this table
 * was hand-added.
 *
 * `tests/log-index.test.ts` covers the routing behavior above this layer, with
 * the store mocked out — which is precisely why the store's own contract has to
 * be pinned here.
 */

const MIGRATION = path.resolve(process.cwd(), "supabase/migrations/0044_pool_log_index.sql");

/** Column names declared in the migration's `create table` block. */
function migrationColumns(): string[] {
  const sql = readFileSync(MIGRATION, "utf8");
  const body = sql.match(/create table if not exists public\.pool_log_index\s*\(([\s\S]*?)\n\);/);
  assert.ok(body, "could not locate the create-table block in 0044");
  return body[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"))
    .map((line) => line.split(/\s+/)[0]);
}

test("the Drizzle table and the migration declare the same columns", () => {
  // Drift here is silent in both directions: a column in SQL but not in schema
  // is unwritable, and one in schema but not in SQL makes every write throw at
  // runtime while typechecking clean.
  const schemaColumns = Object.values(getTableColumns(poolLogIndex))
    .map((c) => c.name)
    .sort();
  assert.equal(getTableName(poolLogIndex), "pool_log_index");
  assert.deepEqual(schemaColumns, migrationColumns().sort());
});

test("every key the write builder emits is a real column — none can be silently dropped", () => {
  const row = buildLogIndexRow("v3mint:0xpool", 995n, [{ owner: "0xabc" }], "2026-08-01T00:00:00.000Z");
  const columns = getTableColumns(poolLogIndex);
  for (const key of Object.keys(row)) {
    assert.ok(key in columns, `"${key}" is not a column — Drizzle would DISCARD it silently`);
  }
  // And the payload is complete: a NOT NULL column left out fails at runtime.
  for (const key of ["cacheKey", "lastBlock", "rows"]) {
    assert.ok(key in row, `write payload is missing the NOT NULL column "${key}"`);
  }
});

test("block 0 survives the write as \"0\", not as a dropped value", () => {
  // §8.3: `x ? x.toString() : null` turned a real 0 into NULL in both
  // directions. A pool whose only coverage is genesis is a legitimate state,
  // and storing NULL for it would violate the NOT NULL column outright.
  const row = buildLogIndexRow("v3mint:0xgenesis", 0n, [], "2026-08-01T00:00:00.000Z");
  assert.equal(row.lastBlock, "0");
});

test("last_block round-trips a head-sized block exactly", () => {
  // numeric, written from a BigInt and never a JS number: head is ~24.8M today
  // but the column must not be the thing that decides when precision ends.
  const head = 9_007_199_254_740_993n; // Number.MAX_SAFE_INTEGER + 2
  const row = buildLogIndexRow("k", head, [], "2026-08-01T00:00:00.000Z");
  assert.equal(row.lastBlock, "9007199254740993");
  assert.equal(BigInt(row.lastBlock), head, "value did not survive the string round trip");
});

test("last_block parses the forms the driver can actually return", () => {
  // node-postgres returns numeric as a STRING. A bare `numeric` column round
  // trips "995" as "995", but tolerate a zero fraction so that a driver or
  // column change cannot silently disable the whole store.
  assert.equal(parseStoredBlock("995"), 995n);
  assert.equal(parseStoredBlock("0"), 0n);
  assert.equal(parseStoredBlock("995.00"), 995n);
  assert.equal(parseStoredBlock(" 24851497 "), 24_851_497n);
  assert.equal(parseStoredBlock("9007199254740993"), 9_007_199_254_740_993n);
});

test("an unusable last_block is rejected, never rounded into a plausible one", () => {
  // These must NOT come back as a number. A block number with a real fraction
  // is corruption, and silently flooring it would resume the top-up from the
  // wrong height — a gap that no later scan would ever notice.
  for (const bad of ["995.5", "", "abc", "-1", "1e6", "NaN", "0x10"]) {
    assert.equal(parseStoredBlock(bad), null, `"${bad}" was accepted`);
  }
});

test("with no DATABASE_URL the store is a no-op, not a crash", async () => {
  // §1: a missing DATABASE_URL is a supported local state. A read degrades to
  // "nothing stored" (the caller cold-fills) and a best-effort write is silent.
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "";
  try {
    assert.equal(await readLogIndex("v3mint:0xpool"), null);
    await writeLogIndex("v3mint:0xpool", 995n, [{ owner: "0xabc" }]);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});
