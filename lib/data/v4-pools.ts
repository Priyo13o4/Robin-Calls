import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { database } from "../db/client";
import { ingestCursors, v4Pools } from "../db/schema";
import type { V4PoolKey } from "../dex/v4-reserves";

/** PoolKeys for the given V4 poolIds from the recorded Initialize rows. A pool not recorded is absent. */
export async function readV4PoolKeys(poolIds: readonly string[]): Promise<Map<string, V4PoolKey>> {
  const out = new Map<string, V4PoolKey>();
  const conn = database();
  const ids = [...new Set(poolIds.map((id) => id.toLowerCase()))];
  if (!conn || ids.length === 0) return out;
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await conn.select().from(v4Pools).where(inArray(v4Pools.poolId, ids.slice(i, i + 500)));
    for (const r of rows) {
      out.set(r.poolId.toLowerCase(), {
        currency0: r.currency0.toLowerCase() as `0x${string}`,
        currency1: r.currency1.toLowerCase() as `0x${string}`,
        fee: r.fee,
        tickSpacing: r.tickSpacing,
        hooks: r.hooks.toLowerCase() as `0x${string}`,
      });
    }
  }
  return out;
}

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Distinct hooks on the V4 pools we have recorded for a token, busiest first by pool count.
 * `looked: false` = could not read; an empty list with `looked: true` only means none recorded.
 */
export async function readTokenV4Hooks(token: string, limit = 12): Promise<{ looked: boolean; hooks: { hook: string; pools: number }[] }> {
  const conn = database();
  if (!conn) return { looked: false, hooks: [] };
  const t = token.toLowerCase();
  try {
    const rows = await conn
      .select({ hook: v4Pools.hooks, pools: sql<number>`count(*)::int` })
      .from(v4Pools)
      .where(and(or(eq(v4Pools.currency0, t), eq(v4Pools.currency1, t)), ne(v4Pools.hooks, ZERO)))
      .groupBy(v4Pools.hooks)
      .orderBy(sql`count(*) desc`)
      .limit(Math.max(1, Math.min(50, limit)));
    return { looked: true, hooks: rows.map((r) => ({ hook: r.hook.toLowerCase(), pools: r.pools })) };
  } catch {
    return { looked: false, hooks: [] };
  }
}


/** `ingest_cursors` row whose `next_block` N means every Initialize in [0, N) is in v4_pools. */
export const V4_POOLS_BACKFILL_STREAM = "v4_pools_backfill";

/** The block below which v4_pools is complete; null = never backfilled, or could not read (§4). */
export async function readV4PoolsCoverage(): Promise<number | null> {
  const conn = database();
  if (!conn) return null;
  try {
    const rows = await conn.select({ next: ingestCursors.nextBlock }).from(ingestCursors)
      .where(eq(ingestCursors.stream, V4_POOLS_BACKFILL_STREAM)).limit(1);
    return rows[0] ? Number(rows[0].next) : null;
  } catch {
    // Unknown coverage: the caller falls back to the log sweep rather than trusting the table.
    return null;
  }
}

export interface StoredV4Pool {
  poolId: string;
  key: V4PoolKey;
  initBlock: number;
  initTx: string | null;
}

/** Every recorded V4 pool holding `token`. Null = could not read; `overflow` = more than `limit` exist. */
export async function readV4PoolsForToken(token: string, limit: number): Promise<{ pools: StoredV4Pool[]; overflow: boolean } | null> {
  const conn = database();
  if (!conn) return null;
  const t = token.toLowerCase();
  try {
    const rows = await conn.select().from(v4Pools)
      .where(or(eq(v4Pools.currency0, t), eq(v4Pools.currency1, t)))
      .limit(limit + 1);
    return {
      overflow: rows.length > limit,
      pools: rows.slice(0, limit).map((r) => ({
        poolId: r.poolId.toLowerCase(),
        key: {
          currency0: r.currency0.toLowerCase() as `0x${string}`,
          currency1: r.currency1.toLowerCase() as `0x${string}`,
          fee: r.fee,
          tickSpacing: r.tickSpacing,
          hooks: r.hooks.toLowerCase() as `0x${string}`,
        },
        initBlock: r.initBlock,
        initTx: r.initTx?.toLowerCase() ?? null,
      })),
    };
  } catch {
    // A failed read is "could not look", never "no pools" (§4); the caller falls back to the sweep.
    return null;
  }
}

/** Stored V4 pool key by poolId. Null = could not read or no row found (§4). */
export async function readV4PoolKey(poolId: string): Promise<V4PoolKey | null> {
  const conn = database();
  if (!conn) return null;
  try {
    const rows = await conn.select().from(v4Pools)
      .where(eq(v4Pools.poolId, poolId.toLowerCase()))
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      currency0: r.currency0.toLowerCase() as `0x${string}`,
      currency1: r.currency1.toLowerCase() as `0x${string}`,
      fee: r.fee,
      tickSpacing: r.tickSpacing,
      hooks: r.hooks.toLowerCase() as `0x${string}`,
    };
  } catch {
    // A failed read is "could not look", never a missing key (§4).
    return null;
  }
}