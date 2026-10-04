import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { database } from "../db/client";
import {
  poolLiquidityHistoryCursors,
  poolLiquidityHistoryEvents,
  poolLiquidityHistoryQueue,
  scanRuns,
  marketSnapshots,
  launchTradeHourly,
  launchState,
  swapPools,
  v4Pools,
  swapPlanRuns,
} from "../db/schema";
import type { PoolRef } from "../dex/types";
import { addresses } from "../config/chain";

export type LiquidityHistoryProtocol = "uniswap-v2" | "uniswap-v3" | "slipstream-cl" | "uniswap-v4";
export type LiquidityHistoryEventName = "Mint" | "Burn" | "Collect" | "ModifyLiquidity";

export interface LiquidityHistoryEvent {
  eventKey: string;
  protocol: LiquidityHistoryProtocol;
  pool: string;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  eventName: LiquidityHistoryEventName;
  payload: Record<string, string | number>;
}

export type CursorRead =
  | { status: "ok"; indexedFromBlock: number; indexedToBlock: number; indexedToHash: string }
  | { status: "missing" }
  | { status: "faulted" };

export async function readPoolLiquidityHistoryCursor(
  protocol: LiquidityHistoryProtocol,
  pool: string,
): Promise<CursorRead> {
  const conn = database();
  if (!conn) return { status: "faulted" };
  try {
    const rows = await conn.select({
      indexedToBlock: poolLiquidityHistoryCursors.indexedToBlock,
      indexedFromBlock: poolLiquidityHistoryCursors.indexedFromBlock,
      indexedToHash: poolLiquidityHistoryCursors.indexedToHash,
    }).from(poolLiquidityHistoryCursors).where(and(
      eq(poolLiquidityHistoryCursors.protocol, protocol),
      eq(poolLiquidityHistoryCursors.pool, pool.toLowerCase()),
    )).limit(1);
    const row = rows[0];
    return row ? { status: "ok", ...row } : { status: "missing" };
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] pool liquidity history cursor read failed:", (error as Error).message);
    return { status: "faulted" };
  }
}

export async function readPoolLiquidityHistoryEvents(
  protocol: LiquidityHistoryProtocol,
  pool: string,
  fromBlock: number,
  toBlock: number,
): Promise<{ status: "ok"; rows: LiquidityHistoryEvent[] } | { status: "faulted" }> {
  const conn = database();
  if (!conn) return { status: "faulted" };
  try {
    const rows = await conn.select().from(poolLiquidityHistoryEvents).where(and(
      eq(poolLiquidityHistoryEvents.protocol, protocol),
      eq(poolLiquidityHistoryEvents.pool, pool.toLowerCase()),
      gte(poolLiquidityHistoryEvents.blockNumber, fromBlock),
      lte(poolLiquidityHistoryEvents.blockNumber, toBlock),
    )).orderBy(asc(poolLiquidityHistoryEvents.blockNumber), asc(poolLiquidityHistoryEvents.logIndex));
    const mapped: LiquidityHistoryEvent[] = rows.map((row) => {
      const raw = row.payload;
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("stored liquidity history payload is malformed");
      const payload: Record<string, string | number> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) throw new Error("stored liquidity history payload has invalid values");
        payload[key] = value;
      }
      return {
        ...row,
        eventKey: `${row.protocol}:${row.pool}:${row.blockNumber}:${row.logIndex}`,
        protocol: row.protocol as LiquidityHistoryProtocol,
        eventName: row.eventName as LiquidityHistoryEventName,
        payload,
      };
    });
    return { status: "ok", rows: mapped };
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] pool liquidity history event read failed:", (error as Error).message);
    return { status: "faulted" };
  }
}

export class PoolLiquidityHistoryCursorMovedError extends Error {
  constructor(readonly protocol: LiquidityHistoryProtocol, readonly pool: string) {
    super(`pool liquidity history cursor moved for ${protocol}:${pool}`);
    this.name = "PoolLiquidityHistoryCursorMovedError";
  }
}

export async function commitPoolLiquidityHistoryWindow(input: {
  protocol: LiquidityHistoryProtocol;
  pool: string;
  expectedIndexedToBlock: number;
  indexedFromBlock: number;
  fromBlock: number;
  toBlock: number;
  toBlockHash: string;
  rows: readonly LiquidityHistoryEvent[];
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for liquidity history writes");
  if (input.fromBlock !== input.expectedIndexedToBlock + 1 || input.toBlock < input.fromBlock) {
    throw new Error("liquidity history window is not contiguous");
  }
  const pool = input.pool.toLowerCase();
  for (const row of input.rows) {
    if (row.protocol !== input.protocol || row.pool.toLowerCase() !== pool || row.blockNumber < input.fromBlock || row.blockNumber > input.toBlock || row.logIndex < 0) {
      throw new Error("liquidity history row falls outside its contiguous window");
    }
  }
  await conn.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${input.protocol}:${pool}`}))`);
    const cursorTable = poolLiquidityHistoryCursors;
    if (input.expectedIndexedToBlock === input.indexedFromBlock - 1) {
      await tx.insert(cursorTable).values({
        protocol: input.protocol,
        pool,
        indexedFromBlock: input.indexedFromBlock,
        indexedToBlock: input.expectedIndexedToBlock,
        indexedToHash: "",
        updatedAt: new Date().toISOString(),
      }).onConflictDoNothing();
    }
    await tx.delete(poolLiquidityHistoryEvents).where(and(
      eq(poolLiquidityHistoryEvents.protocol, input.protocol),
      eq(poolLiquidityHistoryEvents.pool, pool),
      gte(poolLiquidityHistoryEvents.blockNumber, input.fromBlock),
      lte(poolLiquidityHistoryEvents.blockNumber, input.toBlock),
    ));
    if (input.rows.length) {
      const values: (typeof poolLiquidityHistoryEvents.$inferInsert)[] = input.rows.map((row) => ({
        protocol: row.protocol,
        pool: row.pool.toLowerCase(),
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
        txHash: row.txHash.toLowerCase(),
        eventName: row.eventName,
        payload: row.payload,
      }));
      for (let i = 0; i < values.length; i += 1_000) {
        await tx.insert(poolLiquidityHistoryEvents).values(values.slice(i, i + 1_000)).onConflictDoUpdate({
          target: [poolLiquidityHistoryEvents.protocol, poolLiquidityHistoryEvents.pool, poolLiquidityHistoryEvents.blockNumber, poolLiquidityHistoryEvents.logIndex],
          set: {
            txHash: sql`excluded.tx_hash`,
            eventName: sql`excluded.event_name`,
            payload: sql`excluded.payload`,
            recordedAt: new Date().toISOString(),
          },
        });
      }
    }
    const updated = await tx.update(cursorTable).set({
      indexedToBlock: input.toBlock,
      indexedToHash: input.toBlockHash.toLowerCase(),
      updatedAt: new Date().toISOString(),
    }).where(and(
      eq(cursorTable.protocol, input.protocol),
      eq(cursorTable.pool, pool),
      eq(cursorTable.indexedToBlock, input.expectedIndexedToBlock),
    )).returning({ pool: cursorTable.pool });
    if (updated.length !== 1) throw new PoolLiquidityHistoryCursorMovedError(input.protocol, pool);
  });
}

export async function resetPoolLiquidityHistory(
  protocol: LiquidityHistoryProtocol,
  pool: string,
  expected: Extract<CursorRead, { status: "ok" }>,
): Promise<boolean> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for liquidity history writes");
  const key = pool.toLowerCase();
  return conn.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${protocol}:${key}`}))`);
    const removed = await tx.delete(poolLiquidityHistoryCursors).where(and(
      eq(poolLiquidityHistoryCursors.protocol, protocol),
      eq(poolLiquidityHistoryCursors.pool, key),
      eq(poolLiquidityHistoryCursors.indexedFromBlock, expected.indexedFromBlock),
      eq(poolLiquidityHistoryCursors.indexedToBlock, expected.indexedToBlock),
      eq(poolLiquidityHistoryCursors.indexedToHash, expected.indexedToHash),
    )).returning({ pool: poolLiquidityHistoryCursors.pool });
    if (removed.length !== 1) return false;
    await tx.delete(poolLiquidityHistoryEvents).where(and(
      eq(poolLiquidityHistoryEvents.protocol, protocol),
      eq(poolLiquidityHistoryEvents.pool, key),
    ));
    return true;
  });
}

export interface HistoryQueuePool {
  protocol: LiquidityHistoryProtocol;
  pool: string;
  fromBlock: number;
  amount?: string | null;
  complete?: boolean;
}

const HISTORY_QUEUE_REFRESH_MS = 5 * 60 * 1_000;

export async function enqueueLiquidityHistory(input: {
  tokenAddress: string;
  pools: readonly HistoryQueuePool[];
  priorityAmount: string;
  rescanRequested?: boolean;
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for liquidity history queue writes");
  if (!/^0x[0-9a-f]{40}$/i.test(input.tokenAddress) || !/^\d+(?:\.\d+)?$/.test(input.priorityAmount)) throw new Error("invalid liquidity history queue token or priority");
  const pools = input.pools.map((pool) => ({ ...pool, pool: pool.pool.toLowerCase(), complete: false })).sort((a, b) =>
    a.protocol.localeCompare(b.protocol) || a.pool.localeCompare(b.pool),
  );
  if (pools.length === 0) return;
  for (const pool of pools) {
    const validPool = pool.protocol === "uniswap-v4" ? /^0x[0-9a-f]{64}$/.test(pool.pool) : /^0x[0-9a-f]{40}$/.test(pool.pool);
    if (!validPool || !Number.isSafeInteger(pool.fromBlock) || pool.fromBlock < 0 || (pool.amount !== null && pool.amount !== undefined && !/^\d+(?:\.\d+)?$/.test(pool.amount))) {
      throw new Error("invalid liquidity history queue pool");
    }
  }
  const addsCoverage = sql`exists (
    select 1 from jsonb_array_elements(excluded.pools) incoming
    where not exists (
      select 1 from jsonb_array_elements(${poolLiquidityHistoryQueue.pools}) current_pool
      where current_pool->>'protocol' = incoming->>'protocol'
        and current_pool->>'pool' = incoming->>'pool'
        and (current_pool->>'fromBlock')::bigint <= (incoming->>'fromBlock')::bigint
    )
  )`;
  const newRescan = sql`(excluded.rescan_requested and not ${poolLiquidityHistoryQueue.rescanRequested})`;
  const mergedPools = sql`(
    select coalesce(jsonb_agg(jsonb_build_object(
      'protocol', p.protocol, 'pool', p.pool, 'fromBlock', p.from_block,
      'amount', p.amount::text, 'complete', p.complete
    ) order by p.protocol, p.pool), '[]'::jsonb)
    from (
      select u.protocol, u.pool, min(u.from_block) as from_block,
             max(nullif(u.amount, '')::numeric) as amount, bool_and(u.complete) as complete
      from (
        select value->>'protocol' as protocol, value->>'pool' as pool,
               (value->>'fromBlock')::bigint as from_block, value->>'amount' as amount,
               coalesce((value->>'complete')::boolean, false) as complete
        from jsonb_array_elements(${poolLiquidityHistoryQueue.pools}) value
        union all
        select incoming->>'protocol', incoming->>'pool', (incoming->>'fromBlock')::bigint, incoming->>'amount',
               case when ${newRescan} then false else coalesce((
                 select old_value->>'complete' = 'true'
                 from jsonb_array_elements(${poolLiquidityHistoryQueue.pools}) old_value
                 where old_value->>'protocol' = incoming->>'protocol' and old_value->>'pool' = incoming->>'pool'
                   and (old_value->>'fromBlock')::bigint <= (incoming->>'fromBlock')::bigint
                 limit 1
               ), false) end
        from jsonb_array_elements(excluded.pools) incoming
      ) u group by u.protocol, u.pool
    ) p
  )`;
  await conn.insert(poolLiquidityHistoryQueue).values({
    tokenAddress: input.tokenAddress.toLowerCase(),
    pools,
    priorityAmount: input.priorityAmount,
    queuedAt: new Date().toISOString(),
    leaseUntil: null,
    leaseToken: null,
    revision: 1,
    attempts: 0,
    rescanRequested: input.rescanRequested ?? false,
  }).onConflictDoUpdate({
    target: poolLiquidityHistoryQueue.tokenAddress,
    where: sql`${addsCoverage} or excluded.rescan_requested`,
    set: {
      pools: mergedPools,
      priorityAmount: sql`greatest(${poolLiquidityHistoryQueue.priorityAmount}, excluded.priority_amount)`,
      queuedAt: sql`case when ${addsCoverage} or ${newRescan} or ${poolLiquidityHistoryQueue.priorityAmount} < excluded.priority_amount then now() else ${poolLiquidityHistoryQueue.queuedAt} end`,
      revision: sql`${poolLiquidityHistoryQueue.revision} + case when ${addsCoverage} or ${newRescan} then 1 else 0 end`,
      rescanRequested: sql`${poolLiquidityHistoryQueue.rescanRequested} or excluded.rescan_requested`,
      completedAt: sql`case when ${addsCoverage} or ${newRescan} then null else ${poolLiquidityHistoryQueue.completedAt} end`,
    },
  });
}

export async function claimLiquidityHistoryQueue(now: Date, leaseMs: number): Promise<{
  tokenAddress: string;
  pools: HistoryQueuePool[];
  priorityAmount: string;
  revision: number;
  leaseToken: string;
  rescanRequested: boolean;
} | null> {
  const conn = database();
  if (!conn) return null;
  try {
    const candidate = await conn.select().from(poolLiquidityHistoryQueue).where(and(
      or(isNull(poolLiquidityHistoryQueue.leaseUntil), lt(poolLiquidityHistoryQueue.leaseUntil, now.toISOString())),
      or(isNull(poolLiquidityHistoryQueue.completedAt), lt(poolLiquidityHistoryQueue.completedAt, new Date(now.getTime() - HISTORY_QUEUE_REFRESH_MS).toISOString())),
    ))
      .orderBy(desc(poolLiquidityHistoryQueue.rescanRequested), desc(poolLiquidityHistoryQueue.priorityAmount), asc(poolLiquidityHistoryQueue.queuedAt)).limit(1);
    const row = candidate[0];
    if (!row || !Array.isArray(row.pools)) return null;
    const pools = row.pools as HistoryQueuePool[];
    if (!pools.every((item) => item && typeof item.pool === "string" && typeof item.fromBlock === "number")) return null;
    const refreshCompleted = !row.rescanRequested && row.completedAt !== null
      && new Date(row.completedAt).getTime() < now.getTime() - HISTORY_QUEUE_REFRESH_MS;
    const leaseToken = randomUUID();
    const leased = await conn.update(poolLiquidityHistoryQueue).set({
      ...(refreshCompleted ? {
        pools: sql`(
          select coalesce(jsonb_agg(jsonb_set(value, '{complete}', 'false'::jsonb) order by ordinality), '[]'::jsonb)
          from jsonb_array_elements(${poolLiquidityHistoryQueue.pools}) with ordinality as entry(value, ordinality)
        )`,
        completedAt: null,
        revision: sql`${poolLiquidityHistoryQueue.revision} + 1`,
      } : {}),
      leaseUntil: new Date(now.getTime() + leaseMs).toISOString(),
      leaseToken,
      attempts: sql`${poolLiquidityHistoryQueue.attempts} + 1`,
    }).where(and(
      eq(poolLiquidityHistoryQueue.tokenAddress, row.tokenAddress),
      eq(poolLiquidityHistoryQueue.revision, row.revision),
      or(isNull(poolLiquidityHistoryQueue.leaseUntil), lt(poolLiquidityHistoryQueue.leaseUntil, now.toISOString())),
    )).returning({ tokenAddress: poolLiquidityHistoryQueue.tokenAddress, revision: poolLiquidityHistoryQueue.revision, pools: poolLiquidityHistoryQueue.pools });
    if (!leased.length) return null;
    const claimedPools = Array.isArray(leased[0].pools) ? leased[0].pools as HistoryQueuePool[] : pools;
    return { tokenAddress: row.tokenAddress, pools: claimedPools, priorityAmount: row.priorityAmount, revision: leased[0].revision, leaseToken, rescanRequested: row.rescanRequested };
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] liquidity history queue claim failed:", (error as Error).message);
    return null;
  }
}

export async function releaseLiquidityHistoryQueue(input: {
  tokenAddress: string;
  done: boolean;
  revision: number;
  leaseToken: string;
  remainingPools?: readonly HistoryQueuePool[];
  completedPools?: readonly Pick<HistoryQueuePool, "protocol" | "pool">[];
  poolStatus?: readonly (Pick<HistoryQueuePool, "protocol" | "pool"> & { complete: boolean })[];
}): Promise<boolean> {
  const conn = database();
  if (!conn) return false;
  const progress = [
    ...(input.completedPools ?? []).map((pool) => ({ ...pool, pool: pool.pool.toLowerCase(), complete: true })),
    ...(input.poolStatus ?? []).map((pool) => ({ ...pool, pool: pool.pool.toLowerCase() })),
  ];
  const poolProgress = progress.length ? sql`(
    select coalesce(jsonb_agg(
      jsonb_set(pool_entry.value, '{complete}', to_jsonb(coalesce((
        select marked.complete from jsonb_to_recordset(${JSON.stringify(progress)}::jsonb) as marked(protocol text, pool text, complete boolean)
        where marked.protocol = pool_entry.value->>'protocol' and lower(marked.pool) = lower(pool_entry.value->>'pool')
        limit 1
      ), coalesce((pool_entry.value->>'complete')::boolean, false))), true) order by pool_entry.ordinality
    ), '[]'::jsonb)
    from jsonb_array_elements(${poolLiquidityHistoryQueue.pools}) with ordinality as pool_entry(value, ordinality)
  )` : undefined;
  if (input.done) {
    const removed = await conn.update(poolLiquidityHistoryQueue).set({
      ...(poolProgress ? { pools: poolProgress, revision: sql`${poolLiquidityHistoryQueue.revision} + 1` } : {}),
      completedAt: new Date().toISOString(),
      rescanRequested: false,
      leaseUntil: null,
      leaseToken: null,
    }).where(and(
      eq(poolLiquidityHistoryQueue.tokenAddress, input.tokenAddress.toLowerCase()),
      eq(poolLiquidityHistoryQueue.revision, input.revision),
      eq(poolLiquidityHistoryQueue.leaseToken, input.leaseToken),
    )).returning({ tokenAddress: poolLiquidityHistoryQueue.tokenAddress });
    return removed.length === 1;
  }
  const remaining = input.remainingPools?.map((pool) => ({ ...pool, pool: pool.pool.toLowerCase() })).sort((a, b) =>
    a.protocol.localeCompare(b.protocol) || a.pool.localeCompare(b.pool),
  );
  const released = await conn.update(poolLiquidityHistoryQueue).set({
    leaseUntil: null,
    leaseToken: null,
    ...(remaining ? { pools: remaining, revision: sql`${poolLiquidityHistoryQueue.revision} + 1` } : {}),
    ...(poolProgress ? { pools: poolProgress, revision: sql`${poolLiquidityHistoryQueue.revision} + 1` } : {}),
  }).where(and(
    eq(poolLiquidityHistoryQueue.tokenAddress, input.tokenAddress.toLowerCase()),
    eq(poolLiquidityHistoryQueue.revision, input.revision),
    eq(poolLiquidityHistoryQueue.leaseToken, input.leaseToken),
  )).returning({ tokenAddress: poolLiquidityHistoryQueue.tokenAddress });
  return released.length === 1;
}

/**
 * Bounded token discovery for the background material-pool indexer. Pool
 * discovery and amount ranking remain in the scanner/job layer; this boundary
 * returns only tokens represented by recent scans, market snapshots, or trades.
 */
export async function readLiquidityHistoryCandidateTokens(limit = 100): Promise<Array<{ tokenAddress: string; priorityAmount: string }>> {
  const conn = database();
  if (!conn) return [];
  const bounded = Math.max(1, Math.min(500, Math.trunc(limit)));
  const candidateLimit = Math.min(1_000, bounded * 5);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1_000).toISOString();
  try {
    const [scanned, markets, traded, states, swaps] = await Promise.all([
      conn.select({ tokenAddress: scanRuns.tokenAddress, amount: sql<string>`'0'` })
        .from(scanRuns).where(gte(scanRuns.startedAt, since)).orderBy(desc(scanRuns.startedAt)).limit(candidateLimit),
      conn.select({ tokenAddress: marketSnapshots.tokenAddress, amount: marketSnapshots.liquidityUsd })
        .from(marketSnapshots).where(and(gte(marketSnapshots.ts, since), gt(marketSnapshots.volume24HUsd, "0")))
        .orderBy(desc(marketSnapshots.volume24HUsd), desc(marketSnapshots.ts)).limit(candidateLimit),
      conn.select({ tokenAddress: launchTradeHourly.tokenAddress, amount: sql<string>`sum(${launchTradeHourly.quoteIn} + ${launchTradeHourly.quoteOut})` })
        .from(launchTradeHourly).where(gte(launchTradeHourly.hour, since))
        .groupBy(launchTradeHourly.tokenAddress).orderBy(desc(sql`sum(${launchTradeHourly.quoteIn} + ${launchTradeHourly.quoteOut})`)).limit(candidateLimit),
      conn.select({ tokenAddress: launchState.tokenAddress, amount: launchState.liquidityUsd })
        .from(launchState).where(and(gte(launchState.marketReadAt, since), gt(launchState.volume24HUsd, "0")))
        .orderBy(desc(launchState.volume24HUsd), desc(launchState.marketReadAt)).limit(candidateLimit),
      conn.select({ tokenIn: swapPlanRuns.tokenIn, tokenOut: swapPlanRuns.tokenOut })
        .from(swapPlanRuns).where(gte(swapPlanRuns.createdAt, since)).orderBy(desc(swapPlanRuns.createdAt)).limit(candidateLimit * 2),
    ]);
    const byToken = new Map<string, { tokenAddress: string; priorityAmount: string }>();
    for (const row of [...scanned, ...markets, ...traded, ...states]) {
      const tokenAddress = row.tokenAddress.toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(tokenAddress)) continue;
      const amount = row.amount === null ? "0" : String(row.amount);
      const previous = byToken.get(tokenAddress);
      if (!previous || Number(amount) > Number(previous.priorityAmount)) byToken.set(tokenAddress, { tokenAddress, priorityAmount: amount });
    }
    for (const row of swaps) for (const address of [row.tokenIn, row.tokenOut]) {
      const tokenAddress = address.toLowerCase();
      if (/^0x[0-9a-f]{40}$/.test(tokenAddress) && !byToken.has(tokenAddress)) byToken.set(tokenAddress, { tokenAddress, priorityAmount: "0" });
    }
    const candidates = [...byToken.values()];
    const queueState = candidates.length
      ? await conn.select({ tokenAddress: poolLiquidityHistoryQueue.tokenAddress, completedAt: poolLiquidityHistoryQueue.completedAt })
        .from(poolLiquidityHistoryQueue).where(inArray(poolLiquidityHistoryQueue.tokenAddress, candidates.map((candidate) => candidate.tokenAddress)))
      : [];
    const completedAtByToken = new Map(queueState.map((row) => [row.tokenAddress, row.completedAt ? new Date(row.completedAt).getTime() : 0]));
    return candidates.sort((a, b) => {
      const aCompletedAt = completedAtByToken.get(a.tokenAddress) ?? 0;
      const bCompletedAt = completedAtByToken.get(b.tokenAddress) ?? 0;
      return aCompletedAt - bCompletedAt || Number(b.priorityAmount) - Number(a.priorityAmount);
    }).slice(0, bounded);
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] liquidity history candidate read failed:", (error as Error).message);
    return [];
  }
}

export interface LiquidityHistoryDiscoveredPool extends PoolRef {
  fromBlock: number;
}

/** Proven creation floor for a known indexed pool; unknown pools conservatively start at genesis. */
export async function readLiquidityHistoryPoolFloor(protocol: LiquidityHistoryProtocol, pool: string): Promise<number | null> {
  const conn = database();
  if (!conn) return null;
  const key = pool.toLowerCase();
  try {
    if (protocol === "uniswap-v4") {
      const rows = await conn.select({ fromBlock: v4Pools.initBlock }).from(v4Pools).where(eq(v4Pools.poolId, key)).limit(1);
      return rows[0]?.fromBlock ?? 0;
    }
    const rows = await conn.select({ fromBlock: swapPools.createdBlock }).from(swapPools).where(eq(swapPools.pool, key)).limit(1);
    return rows[0]?.fromBlock ?? 0;
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] liquidity history pool floor read failed:", (error as Error).message);
    return null;
  }
}

/** Every indexed V2/V3/CL and V4 pool for a token; callers quantity-rank before applying caps. */
export async function readLiquidityHistoryPools(tokenAddress: string): Promise<LiquidityHistoryDiscoveredPool[] | null> {
  const conn = database();
  if (!conn) return null;
  const token = tokenAddress.toLowerCase();
  try {
    const [classic, v4] = await Promise.all([
      conn.select().from(swapPools).where(or(eq(swapPools.token0, token), eq(swapPools.token1, token))),
      conn.select().from(v4Pools).where(or(eq(v4Pools.currency0, token), eq(v4Pools.currency1, token))),
    ]);
    const pools: LiquidityHistoryDiscoveredPool[] = classic.map((row) => {
      const isToken0 = row.token0 === token;
      const protocol: PoolRef["protocol"] = row.protocol === "v2" ? "uniswap-v2" : row.dex === "slipstream" ? "slipstream-cl" : "uniswap-v3";
      return {
        protocol,
        pool: row.pool as `0x${string}`,
        quoteAsset: (isToken0 ? row.token1 : row.token0) as `0x${string}`,
        feeTier: row.fee ?? 3_000,
        dexId: row.dex,
        fromBlock: row.createdBlock ?? 0,
      };
    });
    for (const row of v4) {
      const currency0 = row.currency0.toLowerCase() as `0x${string}`;
      const currency1 = row.currency1.toLowerCase() as `0x${string}`;
      pools.push({
        protocol: "uniswap-v4",
        pool: addresses.v4PoolManager as `0x${string}`,
        poolId: row.poolId.toLowerCase() as `0x${string}`,
        quoteAsset: currency0 === token ? currency1 : currency0,
        feeTier: row.fee,
        fromBlock: row.initBlock,
        hooks: row.hooks.toLowerCase() as `0x${string}`,
        v4Key: { currency0, currency1, fee: row.fee, tickSpacing: row.tickSpacing, hooks: row.hooks.toLowerCase() as `0x${string}`, initTxHash: row.initTx?.toLowerCase() as `0x${string}` | undefined },
      });
    }
    return pools;
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] liquidity history pool candidate read failed:", (error as Error).message);
    return null;
  }
}

export async function appendLiquidityHistoryStep(input: {
  from: number;
  to: number;
  toHash: string;
  eventsFor: (protocol: LiquidityHistoryProtocol, pool: string, afterBlock: number) => LiquidityHistoryEvent[];
  /** Restrict to these `${protocol}:${pool}` keys: a caller that fetched logs only for them must not advance others. */
  only?: ReadonlySet<string>;
}): Promise<{ advanced: number; inserted: number }> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for liquidity history writes");
  if (input.to < input.from) throw new Error("liquidity history step window is not valid");

  return conn.transaction(async (tx) => {
    const contiguous = () => tx
      .select({
        protocol: poolLiquidityHistoryCursors.protocol,
        pool: poolLiquidityHistoryCursors.pool,
        indexedToBlock: poolLiquidityHistoryCursors.indexedToBlock,
      })
      .from(poolLiquidityHistoryCursors)
      .where(and(
        gte(poolLiquidityHistoryCursors.indexedToBlock, input.from - 1),
        lt(poolLiquidityHistoryCursors.indexedToBlock, input.to),
      ))
      .orderBy(asc(poolLiquidityHistoryCursors.protocol), asc(poolLiquidityHistoryCursors.pool));

    // Advisory lock BEFORE any cursor row lock, the order every other writer here uses;
    // the reverse deadlocks against commitPoolLiquidityHistoryWindow. Re-read under the locks.
    const inScope = (c: { protocol: string; pool: string }) => !input.only || input.only.has(`${c.protocol}:${c.pool.toLowerCase()}`);
    const candidates = (await contiguous()).filter(inScope);
    if (!candidates.length) return { advanced: 0, inserted: 0 };
    const keys = [...new Set(candidates.map((c) => `${c.protocol}:${c.pool.toLowerCase()}`))].sort();
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(k)) from (select unnest(array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]) as k order by 1) s`);
    const locked = new Set(keys);
    const cursors = (await contiguous()).filter((c) => locked.has(`${c.protocol}:${c.pool.toLowerCase()}`));
    if (!cursors.length) return { advanced: 0, inserted: 0 };

    let totalInserted = 0;
    const withRows: {
      cursor: typeof cursors[number];
      rows: LiquidityHistoryEvent[];
    }[] = [];
    const zeroRowCursors: typeof cursors[number][] = [];

    for (const cursor of cursors) {
      const protocol = cursor.protocol as LiquidityHistoryProtocol;
      const pool = cursor.pool.toLowerCase();
      const rows = input.eventsFor(protocol, pool, cursor.indexedToBlock);
      for (const row of rows) {
        if (
          row.protocol !== protocol ||
          row.pool.toLowerCase() !== pool ||
          row.blockNumber <= cursor.indexedToBlock ||
          row.blockNumber > input.to ||
          row.logIndex < 0
        ) {
          throw new Error("liquidity history row falls outside its contiguous window");
        }
      }
      if (rows.length > 0) {
        withRows.push({ cursor, rows });
      } else {
        zeroRowCursors.push(cursor);
      }
    }

    for (const { cursor, rows } of withRows) {
      const protocol = cursor.protocol as LiquidityHistoryProtocol;
      const pool = cursor.pool.toLowerCase();

      await tx.delete(poolLiquidityHistoryEvents).where(and(
        eq(poolLiquidityHistoryEvents.protocol, protocol),
        eq(poolLiquidityHistoryEvents.pool, pool),
        gt(poolLiquidityHistoryEvents.blockNumber, cursor.indexedToBlock),
        lte(poolLiquidityHistoryEvents.blockNumber, input.to),
      ));

      const values: (typeof poolLiquidityHistoryEvents.$inferInsert)[] = rows.map((row) => ({
        protocol: row.protocol,
        pool: row.pool.toLowerCase(),
        blockNumber: row.blockNumber,
        logIndex: row.logIndex,
        txHash: row.txHash.toLowerCase(),
        eventName: row.eventName,
        payload: row.payload,
      }));
      for (let i = 0; i < values.length; i += 1_000) {
        await tx.insert(poolLiquidityHistoryEvents).values(values.slice(i, i + 1_000)).onConflictDoUpdate({
          target: [poolLiquidityHistoryEvents.protocol, poolLiquidityHistoryEvents.pool, poolLiquidityHistoryEvents.blockNumber, poolLiquidityHistoryEvents.logIndex],
          set: {
            txHash: sql`excluded.tx_hash`,
            eventName: sql`excluded.event_name`,
            payload: sql`excluded.payload`,
            recordedAt: new Date().toISOString(),
          },
        });
      }
      totalInserted += rows.length;

      const updated = await tx.update(poolLiquidityHistoryCursors).set({
        indexedToBlock: input.to,
        indexedToHash: input.toHash.toLowerCase(),
        updatedAt: new Date().toISOString(),
      }).where(and(
        eq(poolLiquidityHistoryCursors.protocol, protocol),
        eq(poolLiquidityHistoryCursors.pool, pool),
        eq(poolLiquidityHistoryCursors.indexedToBlock, cursor.indexedToBlock),
      )).returning({ pool: poolLiquidityHistoryCursors.pool });
      if (updated.length !== 1) {
        throw new PoolLiquidityHistoryCursorMovedError(protocol, pool);
      }
    }

    if (zeroRowCursors.length > 0) {
      const batch = zeroRowCursors.map(
        (c) => sql`(${c.protocol}::text, ${c.pool.toLowerCase()}::text, ${c.indexedToBlock}::bigint)`,
      );
      await tx.execute(sql`
        update pool_liquidity_history_cursors as c
        set indexed_to_block = ${input.to},
            indexed_to_hash = lower(${input.toHash}),
            updated_at = now()
        from (values ${sql.join(batch, sql`, `)})
          as incoming(protocol, pool, indexed_to_block)
        where c.protocol = incoming.protocol
          and c.pool = incoming.pool
          and c.indexed_to_block = incoming.indexed_to_block
      `);
    }

    return { advanced: cursors.length, inserted: totalInserted };
  });
}
