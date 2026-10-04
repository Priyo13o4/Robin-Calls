import { and, asc, eq, getTableColumns, inArray, or, sql, type SQL } from "drizzle-orm";
import { database } from "../db/client";
import { poolDepth, swapPools, v4Pools } from "../db/schema";
import { readSiteConfigKeys } from "./site-config";
import { fromNumericString } from "./numeric";

const LP_LOW_DEPTH_KEY = "lp_positions_low_depth_usd";
const LP_DEPTH_FRESHNESS_MS = 48 * 60 * 60 * 1000;

export function isFreshLowDepthObservation(
  row: Pick<typeof poolDepth.$inferInsert, "depthUsd" | "readAt">,
  thresholdUsd: number,
  nowMs = Date.now(),
): boolean {
  if (row.depthUsd == null || row.readAt == null) return false;
  const depthUsd = Number(row.depthUsd);
  const readAtMs = new Date(row.readAt).getTime();
  return Number.isFinite(depthUsd) &&
    Number.isFinite(readAtMs) &&
    readAtMs <= nowMs &&
    nowMs - readAtMs <= LP_DEPTH_FRESHNESS_MS &&
    depthUsd < thresholdUsd;
}

function configuredLowDepthUsd(raw: string | undefined): number {
  if (!raw?.trim()) return 100;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000 ? value : 100;
}

/** Upper bound on one pair's pools read before ranking (ETH/USDG holds ~570). */
const PAIR_SCAN_MAX = 2_000;

/** Live pools first, then deepest; unmeasured after measured; pool id only breaks ties. */
export function rankPoolsByDepth<T extends { poolId: string }>(rows: readonly T[], depths: readonly { poolId: string; depthUsd: string | null; deadAt: string | null }[]): T[] {
  const by = new Map(depths.map((d) => [d.poolId, d]));
  const key = (r: T) => {
    const d = by.get(r.poolId);
    const usd = d?.depthUsd == null ? null : Number(d.depthUsd);
    return { dead: d?.deadAt != null ? 1 : 0, usd: usd !== null && Number.isFinite(usd) ? usd : null };
  };
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka.dead !== kb.dead) return ka.dead - kb.dead;
    if (ka.usd !== kb.usd) return ka.usd === null ? 1 : kb.usd === null ? -1 : kb.usd - ka.usd;
    return a.poolId < b.poolId ? -1 : a.poolId > b.poolId ? 1 : 0;
  });
}

/** Pool identity outlives launch-feed visibility. No join to age-filtered launches. */
export async function readSwapV4Pools(token: string, counterparties: readonly string[], limit = 24) {
  const conn = database();
  if (!conn || counterparties.length === 0) return [];
  const t = token.toLowerCase();
  const quotes = [...new Set(counterparties.map((q) => q.toLowerCase()))];
  // Ranked by measured depth before the cut (§8 #18): by pool id, ETH/USDG's dead pools filled the slots.
  // Two indexed reads: a joined sort misestimates the pair and scans all of pool_depth.
  const pairRows = await conn.select().from(v4Pools).where(or(
    and(eq(v4Pools.currency0, t), inArray(v4Pools.currency1, quotes)),
    and(eq(v4Pools.currency1, t), inArray(v4Pools.currency0, quotes)),
  )).limit(PAIR_SCAN_MAX);
  const depths = pairRows.length ? await conn.select({ poolId: poolDepth.poolId, depthUsd: poolDepth.depthUsd, deadAt: poolDepth.deadAt })
    .from(poolDepth).where(inArray(poolDepth.poolId, pairRows.map((r) => r.poolId))) : [];
  return rankPoolsByDepth(pairRows, depths).slice(0, Math.max(1, Math.min(25, limit)));
}

export interface GraphPool {
  poolId: string;
  protocol: "v2" | "v3" | "v4";
  dex: string;
  token0: string;
  token1: string;
  fee: number | null;
  tickSpacing: number | null;
  hooks: string | null;
  depthUsd: number;
  /** USD of token0 / token1 the pool pays out within a 2% price move. Null = that side unpriced. */
  depth0Usd: number | null;
  depth1Usd: number | null;
}

export async function upsertSwapPools(rows: (typeof swapPools.$inferInsert)[]): Promise<number> {
  const conn = database();
  if (!conn) throw new Error("swap_pools: database unavailable");
  if (!rows.length) return 0;
  let inserted = 0;
  const CHUNK_SIZE = 1000;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE).map((r) => ({
      ...r,
      pool: r.pool.toLowerCase(),
      factory: r.factory.toLowerCase(),
      token0: r.token0.toLowerCase(),
      token1: r.token1.toLowerCase(),
    }));
    const res = await conn
      .insert(swapPools)
      .values(chunk)
      .onConflictDoNothing({ target: swapPools.pool })
      .returning({ pool: swapPools.pool });
    inserted += res.length;
  }
  return inserted;
}

export function buildPoolDepthSet(row: Partial<typeof poolDepth.$inferInsert>): Record<string, SQL> {
  const cols = getTableColumns(poolDepth);
  const keys = Object.keys(row).filter(
    (k) => k !== "poolId" && (row as Record<string, unknown>)[k] !== undefined && k in cols
  );
  const set: Record<string, SQL> = Object.fromEntries(
    keys.map((k) => [k, sql.raw(`excluded."${cols[k as keyof typeof cols].name}"`)])
  );
  set.updatedAt = sql`now()`;
  return set;
}

export async function upsertPoolDepths(rows: (typeof poolDepth.$inferInsert)[]): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("pool_depth: database unavailable");
  if (!rows.length) return;
  const siteConfig = await readSiteConfigKeys([LP_LOW_DEPTH_KEY]);
  const lowDepthUsd = configuredLowDepthUsd(siteConfig[LP_LOW_DEPTH_KEY]);
  const nowMs = Date.now();
  const normalized = rows.map((r) => ({ ...r, poolId: r.poolId.toLowerCase() }));
  const groups = new Map<string, typeof normalized>();
  for (const r of normalized) {
    const sig = Object.keys(r)
      .filter((k) => (r as Record<string, unknown>)[k] !== undefined)
      .sort()
      .join(",");
    const list = groups.get(sig) ?? [];
    list.push(r);
    groups.set(sig, list);
  }
  const CHUNK_SIZE = 1000;
  for (const group of groups.values()) {
    const set = buildPoolDepthSet(group[0]);
    for (let i = 0; i < group.length; i += CHUNK_SIZE) {
      const chunk = group.slice(i, i + CHUNK_SIZE);
      await conn.transaction(async (tx) => {
        await tx.insert(poolDepth)
          .values(chunk)
          .onConflictDoUpdate({ target: poolDepth.poolId, set });

        // Untyped VALUES params arrive as text; without casts the CASE rejects and rolls back the depth write.
        const observations = chunk.map((row) => sql`(
          ${row.poolId}::text,
          ${isFreshLowDepthObservation(row, lowDepthUsd, nowMs)}::boolean,
          ${row.readAt ?? null}::timestamptz
        )`);
        await tx.execute(sql`
          update lp_tracked_pools tracked
          set low_depth_since = case
            when incoming.fresh_low then coalesce(tracked.low_depth_since, incoming.read_at)
            else null
          end
          from (values ${sql.join(observations, sql`, `)})
            as incoming(pool, fresh_low, read_at)
          where tracked.pool = incoming.pool
        `);
      });
    }
  }
}

export async function readGraphPools(minDepthUsd: number): Promise<GraphPool[]> {
  const conn = database();
  if (!conn) return [];
  // Starts from pool_depth's depth index, then each identity table by primary key (reloaded every 60 s).
  const res = await conn.execute(sql`
    select s.pool as pool_id, s.protocol, s.dex, s.token0, s.token1, s.fee, s.tick_spacing, null::text as hooks,
           d.depth_usd, d.depth0_usd, d.depth1_usd
      from pool_depth d join swap_pools s on s.pool = d.pool_id
      where d.depth_usd >= ${minDepthUsd} and d.dead_at is null
    union all
    select v.pool_id, 'v4', 'uniswap-v4', v.currency0, v.currency1, v.fee, v.tick_spacing, v.hooks,
           d.depth_usd, d.depth0_usd, d.depth1_usd
      from pool_depth d join v4_pools v on v.pool_id = d.pool_id
      where d.depth_usd >= ${minDepthUsd} and d.dead_at is null
  `);
  return rowsOf(res).map((r): GraphPool => ({
    poolId: String(r.pool_id),
    protocol: String(r.protocol) as GraphPool["protocol"],
    dex: String(r.dex),
    token0: String(r.token0),
    token1: String(r.token1),
    fee: r.fee == null ? null : Number(r.fee),
    tickSpacing: r.tick_spacing == null ? null : Number(r.tick_spacing),
    hooks: r.hooks == null ? null : String(r.hooks),
    // The WHERE clause guarantees a stored depth; zero is a real value (§8 #3).
    depthUsd: fromNumericString(r.depth_usd as string | null) ?? 0,
    depth0Usd: fromNumericString(r.depth0_usd as string | null),
    depth1Usd: fromNumericString(r.depth1_usd as string | null),
  }));
}


export interface SweepPool {
  poolId: string;
  protocol: "v2" | "v3" | "v4";
  token0: string;
  token1: string;
  tickSpacing: number | null;
}

export type SweepSource = "swap" | "v4";

const SWEEP_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const SWEEP_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const SWEEP_NATIVE = "0x0000000000000000000000000000000000000000";

function rowsOf(res: unknown): Record<string, unknown>[] {
  return Array.isArray(res) ? (res as Record<string, unknown>[]) : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
}

function toSweepPool(r: Record<string, unknown>): SweepPool {
  return {
    poolId: String(r.pool_id).toLowerCase(),
    protocol: String(r.protocol) as SweepPool["protocol"],
    token0: String(r.token0).toLowerCase(),
    token1: String(r.token1).toLowerCase(),
    tickSpacing: r.tick_spacing == null ? null : Number(r.tick_spacing),
  };
}

const SWAP_COLS = sql`s.pool as pool_id, s.protocol, s.token0, s.token1, s.tick_spacing`;
const V4_COLS = sql`v.pool_id, 'v4'::text as protocol, v.currency0 as token0, v.currency1 as token1, v.tick_spacing`;

/** Keyset page over ONE table's primary key: a union sorted per page would re-sort ~1M rows each time. */
export async function readSweepPage(source: SweepSource, after: string | null, limit: number): Promise<SweepPool[]> {
  const conn = database();
  if (!conn) return [];
  const lim = Math.max(1, limit);
  const from = after?.toLowerCase() ?? "";
  const res = source === "swap"
    ? await conn.execute(sql`select ${SWAP_COLS} from swap_pools s where s.pool > ${from} order by s.pool limit ${lim}`)
    : await conn.execute(sql`select ${V4_COLS} from v4_pools v where v.pool_id > ${from} order by v.pool_id limit ${lim}`);
  return rowsOf(res).map(toSweepPool);
}

/** Hot set: stored depth at or above the floor (and not dead), plus the recorder's dirty pools. */
export async function readHotSweepPools(minDepthUsd: number, extra: readonly string[]): Promise<SweepPool[]> {
  const conn = database();
  if (!conn) return [];
  const ids = [...new Set(extra.map((e) => e.toLowerCase()))];
  const idList = sql`array[${sql.join(ids.length ? ids.map((id) => sql`${id}`) : [sql`''`], sql`, `)}]::text[]`;
  const res = await conn.execute(sql`
    select ${SWAP_COLS} from swap_pools s join pool_depth d on d.pool_id = s.pool
      where d.depth_usd >= ${minDepthUsd} and d.dead_at is null
    union
    select ${V4_COLS} from v4_pools v join pool_depth d on d.pool_id = v.pool_id
      where d.depth_usd >= ${minDepthUsd} and d.dead_at is null
    union
    select ${SWAP_COLS} from swap_pools s where s.pool = any(${idList})
    union
    select ${V4_COLS} from v4_pools v where v.pool_id = any(${idList})
  `);
  return rowsOf(res).map(toSweepPool);
}

/** Every USDG/ETH pool (~111): measured on each sweep so ETH is priced before any WETH pool is. */
export async function readAnchorPools(): Promise<SweepPool[]> {
  const conn = database();
  if (!conn) return [];
  const res = await conn.execute(sql`
    select ${SWAP_COLS} from swap_pools s
    where (s.token0 = ${SWEEP_USDG} and s.token1 in (${SWEEP_WETH}, ${SWEEP_NATIVE}))
       or (s.token1 = ${SWEEP_USDG} and s.token0 in (${SWEEP_WETH}, ${SWEEP_NATIVE}))
    union all
    select ${V4_COLS} from v4_pools v
    where (v.currency0 = ${SWEEP_USDG} and v.currency1 in (${SWEEP_WETH}, ${SWEEP_NATIVE}))
       or (v.currency1 = ${SWEEP_USDG} and v.currency0 in (${SWEEP_WETH}, ${SWEEP_NATIVE}))
  `);
  return rowsOf(res).map(toSweepPool);
}

/** Recorded V2/V3 pools for a token. Null = could not look; overflow = more than limit exist. */
export async function readTokenV2V3Pools(
  token: string,
  limit = 200,
): Promise<{ pools: string[]; overflow: boolean } | null> {
  const conn = database();
  if (!conn) return null;
  const t = token.toLowerCase();
  try {
    const rows = await conn
      .select({ pool: swapPools.pool })
      .from(swapPools)
      .where(or(eq(swapPools.token0, t), eq(swapPools.token1, t)))
      .limit(limit + 1);
    return {
      overflow: rows.length > limit,
      pools: rows.slice(0, limit).map((r) => r.pool.toLowerCase()),
    };
  } catch {
    // A failed read is "could not look", never "no pools" (§4).
    return null;
  }
}
