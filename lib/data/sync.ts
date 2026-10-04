import { and, asc, getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { database } from "@/lib/db/client";
import { launchEvents, launches, launchpads, launchState, swapPools, v4Pools } from "@/lib/db/schema";

/**
 * Prod -> local-smoke sync pages (lib/sync/, /api/sync/v1/*). Prod serves pages keyed by a
 * change cursor (migration 0102 (merged)); local upserts them by natural key, never by prod's ids.
 */

export const SYNC_TABLES = ["launchpads", "launches", "launch_events", "v4_pools", "launch_state", "swap_pools"] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];
export const MAX_SYNC_PAGE = 1000;
/** Rows newer than this are held back: a transaction that started earlier may still commit behind the cursor. */
const SETTLE_S = 60;
const STATEMENT_TIMEOUT = sql.raw(`set local statement_timeout = '5s'`);

export interface SyncCursor { ts: string; key: string }
/** `next` is the last row's cursor (null only when the page is empty); `more` says a full page came back. */
export interface SyncPage { rows: Record<string, unknown>[]; next: SyncCursor | null; more: boolean }

type Spec = { table: PgTable; at: SQL; key: PgColumn; keyText: SQL };
const SPECS: Record<Exclude<SyncTable, "launchpads">, Spec> = {
  launches: { table: launches, at: sql`${launches.recordedAt}`, key: launches.tokenAddress, keyText: sql`${launches.tokenAddress}` },
  launch_events: { table: launchEvents, at: sql`${launchEvents.recordedAt}`, key: launchEvents.id, keyText: sql`${launchEvents.id}::text` },
  v4_pools: { table: v4Pools, at: sql`${v4Pools.recordedAt}`, key: v4Pools.poolId, keyText: sql`${v4Pools.poolId}` },
  launch_state: { table: launchState, at: sql`greatest(${launchState.stateReadAt}, ${launchState.marketReadAt})`, key: launchState.tokenAddress, keyText: sql`${launchState.tokenAddress}` },
  swap_pools: { table: swapPools, at: sql`${swapPools.recordedAt}`, key: swapPools.pool, keyText: sql`${swapPools.pool}` },
};

/** One page after `after`, oldest first. Null connection: an empty page with no cursor (not "nothing changed"). */
export async function readSyncPage(table: SyncTable, after: SyncCursor | null, limit: number): Promise<SyncPage | null> {
  const conn = database();
  if (!conn) return null;
  const n = Math.max(1, Math.min(MAX_SYNC_PAGE, Math.trunc(limit)));
  if (table === "launchpads") {
    const rows = await conn.select().from(launchpads).orderBy(asc(launchpads.id));
    return { rows, next: null, more: false };
  }
  const s = SPECS[table];
  const afterKey = table === "launch_events" ? sql`${after?.key ?? "0"}::bigint` : sql`${after?.key ?? ""}`;
  return conn.transaction(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT);
    const rows = await tx
      .select({ row: getTableColumns(s.table) as never, cursorAt: sql<string>`${s.at}::text`, cursorKey: sql<string>`${s.keyText}` })
      .from(s.table)
      .where(and(
        sql`${s.at} < now() - make_interval(secs => ${SETTLE_S})`,
        after ? sql`(${s.at}, ${s.key}) > (${after.ts}::timestamptz, ${afterKey})` : sql`${s.at} is not null`,
      ))
      .orderBy(s.at, asc(s.key))
      .limit(n);
    const last = rows[rows.length - 1] as { cursorAt: string; cursorKey: string } | undefined;
    return {
      rows: rows.map((r) => (r as unknown as { row: Record<string, unknown> }).row),
      next: last ? { ts: last.cursorAt, key: last.cursorKey } : null,
      more: rows.length === n,
    };
  });
}

/** Local writes pick only real column keys and refuse any other (CLAUDE.md §3: Drizzle drops unknown keys silently). */
export function pickColumns<T extends PgTable>(table: T, row: Record<string, unknown>, omit: readonly string[]): T["$inferInsert"] {
  const cols = getTableColumns(table);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!(k in cols)) throw new Error(`sync: unknown column ${k}`);
    if (!omit.includes(k)) out[k] = v;
  }
  return out as T["$inferInsert"];
}

const excludedSet = (table: PgTable, keys: readonly string[]) => {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  return Object.fromEntries(keys.map((k) => [k, sql.raw(`excluded."${cols[k].name}"`)]));
};

export async function upsertSyncRows(table: SyncTable, rows: readonly Record<string, unknown>[]): Promise<number> {
  const conn = database();
  if (!conn) throw new Error("sync: DATABASE_URL not configured");
  if (!rows.length) return 0;
  if (table === "launchpads") {
    // Pads are admin config: insert what is missing, never overwrite local settings. Ids must name the same pad.
    const local = new Map((await conn.select({ id: launchpads.id, slug: launchpads.slug }).from(launchpads)).map((p) => [Number(p.id), p.slug]));
    for (const r of rows) {
      const slug = local.get(Number(r.id));
      if (slug !== undefined && slug !== r.slug) throw new Error(`sync: launchpad ${r.id} is ${slug} locally but ${String(r.slug)} on prod`);
    }
    const missing = rows.filter((r) => !local.has(Number(r.id))).map((r) => pickColumns(launchpads, r, []));
    if (missing.length) await conn.insert(launchpads).values(missing).onConflictDoNothing();
    return missing.length;
  }
  if (table === "launches") {
    const values = rows.map((r) => pickColumns(launches, r, ["recordedAt"]));
    const keys = Object.keys(values[0]).filter((k) => k !== "tokenAddress");
    await conn.insert(launches).values(values).onConflictDoUpdate({ target: launches.tokenAddress, set: excludedSet(launches, keys) });
  } else if (table === "launch_events") {
    const values = rows.map((r) => pickColumns(launchEvents, r, ["id", "recordedAt"]));
    const keys = Object.keys(values[0]).filter((k) => !["tokenAddress", "kind", "blockNumber", "logIndex"].includes(k));
    await conn.insert(launchEvents).values(values).onConflictDoUpdate({
      target: [launchEvents.tokenAddress, launchEvents.kind, launchEvents.blockNumber, launchEvents.logIndex],
      set: excludedSet(launchEvents, keys),
    });
  } else if (table === "v4_pools") {
    const values = rows.map((r) => pickColumns(v4Pools, r, ["recordedAt"]));
    await conn.insert(v4Pools).values(values).onConflictDoNothing({ target: v4Pools.poolId });
  } else if (table === "swap_pools") {
    const values = rows.map((r) => pickColumns(swapPools, r, ["recordedAt"]));
    await conn.insert(swapPools).values(values).onConflictDoNothing({ target: swapPools.pool });
  } else {
    const values = rows.map((r) => pickColumns(launchState, r, []));
    const keys = Object.keys(values[0]).filter((k) => k !== "tokenAddress");
    await conn.insert(launchState).values(values).onConflictDoUpdate({ target: launchState.tokenAddress, set: excludedSet(launchState, keys) });
  }
  return rows.length;
}
