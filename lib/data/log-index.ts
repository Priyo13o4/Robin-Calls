import { eq } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { poolLogIndex } from "@/lib/db/schema";
import { reportError } from "@/lib/observability/reporter";

/**
 * `pool_log_index` repository (migration 0044) — the durable store behind
 * `lib/rpc/log-index.ts`.
 *
 * This replaced a Valkey cache under a 7-day TTL. Event history is append-only
 * and immutable, so expiring it was a category error, and that TTL was the whole
 * cause of the RPC blow-up: by the time a key expired its "incremental" top-up
 * spanned millions of blocks (measured: 5,209,532 = 512 sequential eth_getLogs
 * windows). Durable rows mean the genesis→head fill happens ONCE PER POOL, EVER.
 *
 * It is a store, not a conclusion. Rows are the call site's own mapped event
 * records; everything mutable (current owners, live liquidity) is re-derived on
 * every scan. So a stale entry can only ever cost a short top-up — it can never
 * freeze a verdict (CLAUDE.md §4).
 */

/**
 * Report threshold for a single index, on the serialized JSON.
 *
 * Deliberately report-ONLY: the value is still written. The Valkey version
 * refused oversized entries, and that refusal was itself a production failure —
 * the busiest pools are exactly the most-rescanned ones, so they never cached
 * and cold-filled Blockscout on every single scan, forever (the SWOGE V3
 * custody failure). Postgres TOASTs a large value without complaint; the only
 * real cost past this size is the read-modify-write of the whole blob, which is
 * the signal to normalize to one row per event (plan §5a). Largest index
 * measured today is 372 KB, so this is ~27x headroom.
 */
const OVERSIZE_REPORT_BYTES = 10_000_000;

export interface StoredLogIndex {
  /** Inclusive upper bound of verified coverage. */
  lastBlock: bigint;
  /**
   * The call site's own mapped rows. Their shape is that call site's contract
   * (it supplies both the RPC and explorer mappers), not this module's — so
   * they are `unknown[]` at the boundary and the caller narrows them.
   *
   * `jsonb` is a PARSED representation, not text, so it **normalizes object key
   * order** — `{owner, tickLower, …}` can read back as `{owner, txHash, …}`
   * (verified against real Postgres 2026-08-01). Array order and every value
   * are preserved, which is all any consumer uses: all four call sites access
   * rows by property name and none serializes or key-iterates them. The old
   * Valkey store kept raw JSON and so preserved key order incidentally — do not
   * reintroduce a dependency on it (a stringified row used as a hash, cache key
   * or dedupe key would silently change meaning here).
   */
  rows: unknown[];
}

/**
 * Parse the stored `last_block`.
 *
 * node-postgres returns `numeric` as a STRING. The column is a bare `numeric`
 * with no declared scale, so a value written as "995" reads back as "995" — but
 * a driver or column change that started returning "995.00" would make a naive
 * `BigInt()` throw, and this module would then report "nothing stored" forever.
 * So tolerate a zero fraction and reject everything else: a block number with a
 * real fractional part is corruption, not formatting.
 *
 * Exported for its own test — it is the one place a formatting change could
 * silently disable the entire store.
 */
export function parseStoredBlock(value: string): bigint | null {
  const trimmed = value.trim().replace(/\.0+$/, "");
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

/**
 * Read a stored index. Returns null for "nothing usable stored" — no database
 * configured, no row, or a row we cannot trust — which the caller treats as a
 * cold start. Refilling is always safe: the index is derived data, so the worst
 * case is one explorer call.
 *
 * A row that EXISTS but cannot be used is NOT treated as absence, though — it
 * is reported. Silently returning null there would make that pool re-fill on
 * every scan forever with nothing to show why, which is precisely the
 * invisible-at-every-layer failure this table was added to end (CLAUDE.md §8).
 */
export async function readLogIndex(cacheKey: string): Promise<StoredLogIndex | null> {
  const conn = database();
  if (!conn) return null;

  let row: typeof poolLogIndex.$inferSelect | undefined;
  try {
    const found = await conn
      .select()
      .from(poolLogIndex)
      .where(eq(poolLogIndex.cacheKey, cacheKey))
      .limit(1);
    row = found[0];
  } catch (error) {
    // A store fault is never a scan fault — degrade to the cold path.
    console.error(
      `[RC_DB_READ_FAILED] pool_log_index read failed for "${cacheKey}":`,
      (error as Error).message,
    );
    return null;
  }

  if (!row) return null; // genuine cold start

  const lastBlock = parseStoredBlock(row.lastBlock);
  if (lastBlock === null || !Array.isArray(row.rows)) {
    await reportError({
      code: "RC_LOG_INDEX_UNREADABLE",
      message: `log index "${cacheKey}" is stored but unusable (last_block=${JSON.stringify(row.lastBlock)}, rows is ${Array.isArray(row.rows) ? "an array" : typeof row.rows}) — this pool will re-fill from the explorer on every scan until it is fixed`,
      operation: "readLogIndex",
    }).catch(() => {});
    return null;
  }
  return { lastBlock, rows: row.rows };
}

/**
 * Build the insert payload.
 *
 * Exported and explicitly typed as `$inferInsert` (CLAUDE.md §3.2) so a key
 * that is not a real column is a COMPILE error. Drizzle silently discards
 * unmatched keys at runtime — no throw, no type error — which is how
 * `scan_runs` recorded zero rows in production while typechecking clean and
 * passing its tests (failure mode §8.1). `tests/log-index-store.test.ts` pins
 * the other half: that these columns exist in the migration.
 *
 * `lastBlock` is stringified from a bigint, never a number: it is a `numeric`
 * column, and block 0 must survive as "0" rather than being coerced away by a
 * truthiness guard (failure mode §8.3).
 */
export function buildLogIndexRow(
  cacheKey: string,
  lastBlock: bigint,
  rows: unknown[],
  updatedAt: string,
): typeof poolLogIndex.$inferInsert {
  return { cacheKey, lastBlock: lastBlock.toString(), rows, updatedAt };
}

/**
 * Upsert a stored index. Best-effort: a failure here costs the next scan one
 * explorer call, so it must never propagate into the scan. It is still logged,
 * because a write that fails EVERY time silently recreates the cold-fill-forever
 * failure this table exists to end.
 */
export async function writeLogIndex(
  cacheKey: string,
  lastBlock: bigint,
  rows: unknown[],
): Promise<void> {
  const conn = database();
  if (!conn) return;

  try {
    const size = Buffer.byteLength(JSON.stringify(rows));
    if (size > OVERSIZE_REPORT_BYTES) {
      // Report, then write anyway — see OVERSIZE_REPORT_BYTES.
      await reportError({
        code: "RC_LOG_INDEX_OVERSIZE",
        message: `log index "${cacheKey}" is ${size}B of JSON (> ${OVERSIZE_REPORT_BYTES}) — stored, but this is the signal to normalize to one row per event`,
        operation: "writeLogIndex",
      }).catch(() => {});
    }

    const now = new Date().toISOString();
    const values = buildLogIndexRow(cacheKey, lastBlock, rows, now);

    await conn
      .insert(poolLogIndex)
      .values(values)
      .onConflictDoUpdate({
        target: poolLogIndex.cacheKey,
        set: { lastBlock: values.lastBlock, rows: values.rows, updatedAt: now },
      });
  } catch (error) {
    console.error(
      `[RC_DB_WRITE_FAILED] pool_log_index upsert failed for "${cacheKey}":`,
      (error as Error).message,
    );
  }
}
