import { and, eq, inArray, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { lpPositions, lpTrackedPools, sequencerCheckpoints, swapPools, v4Pools, poolDepth } from "@/lib/db/schema";
import type { FoldedPositions, PositionDelta } from "@/lib/trade/lp-positions";

const STREAM = "lp-positions";
const CHUNK_SIZE = 500;

export type LpProtocol = "v2" | "v3" | "v4";
export interface PoolIdentity {
  pool: string;
  protocol: LpProtocol;
  token0: string;
  token1: string;
  fee: number | null;
  dex: string | null;
  hooks: string | null;
  positionManager: string | null;
}

export async function getPoolIdentity(poolInput: string): Promise<PoolIdentity | null> {
  const conn = database();
  if (!conn) return null;
  const pool = poolInput.toLowerCase();
  if (pool.length === 66) {
    const [row] = await conn.select().from(v4Pools).where(eq(v4Pools.poolId, pool)).limit(1);
    return row ? { pool, protocol: "v4", token0: row.currency0, token1: row.currency1, fee: row.fee, dex: null, hooks: row.hooks, positionManager: null } : null;
  }
  const [row] = await conn.select().from(swapPools).where(eq(swapPools.pool, pool)).limit(1);
  if (!row || (row.protocol !== "v2" && row.protocol !== "v3")) return null;
  return { pool, protocol: row.protocol, token0: row.token0, token1: row.token1, fee: row.fee, dex: row.dex, hooks: null, positionManager: null };
}

export interface HydratedPosition {
  pool: string;
  positionKey: string;
  protocol: "v3" | "v4";
  manager: string | null;
  tokenId: string | null;
  holder: string | null;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  updatedBlock: number;
}

export interface PositionSnapshot {
  tracked: typeof lpTrackedPools.$inferSelect | null;
  positions: (typeof lpPositions.$inferSelect)[];
  checkpoint: { nextBlock: number; epoch: number } | null;
}

export async function readPositionSnapshot(poolInput: string): Promise<PositionSnapshot> {
  const conn = database();
  if (!conn) return { tracked: null, positions: [], checkpoint: null };
  const pool = poolInput.toLowerCase();
  const [tracked] = await conn.select().from(lpTrackedPools).where(eq(lpTrackedPools.pool, pool)).limit(1);
  const [row] = await conn.select({ value: sequencerCheckpoints.value }).from(sequencerCheckpoints).where(eq(sequencerCheckpoints.stream, STREAM)).limit(1);
  const value = row?.value as Record<string, unknown> | undefined;
  const nextBlock = Number(value?.nextBlock);
  const epoch = Number(value?.epoch);
  const checkpoint = Number.isSafeInteger(nextBlock) && Number.isSafeInteger(epoch) ? { nextBlock, epoch } : null;
  if (!tracked || !checkpoint || tracked.epoch !== checkpoint.epoch) return { tracked: tracked ?? null, positions: [], checkpoint };
  const positions = await conn.select().from(lpPositions).where(eq(lpPositions.pool, pool));
  return { tracked, positions, checkpoint };
}

export async function bumpPositionVisit(poolInput: string): Promise<void> {
  const conn = database();
  if (!conn) return;
  const now = new Date();
  await conn.update(lpTrackedPools).set({ lastVisitedAt: now.toISOString() })
    .where(and(eq(lpTrackedPools.pool, poolInput.toLowerCase()), sql`${lpTrackedPools.lastVisitedAt} < ${new Date(now.getTime() - 60_000).toISOString()}`));
}

export type ReplaceHydrationResult = { status: "tracked"; through: number } | { status: "lagging"; from: number; to: number } | { status: "unconfigured" };

/** The checkpoint lock orders hydration against recorder steps; a stale history never becomes tracked. */
export async function replaceHydratedPool(
  poolInput: string,
  protocol: "v3" | "v4",
  reason: "visit" | "graph" | "scan",
  ceiling: number,
  positions: readonly HydratedPosition[],
): Promise<ReplaceHydrationResult> {
  const conn = database();
  if (!conn) return { status: "unconfigured" };
  const pool = poolInput.toLowerCase();
  return conn.transaction(async (tx) => {
    const [row] = await tx.select({ value: sequencerCheckpoints.value }).from(sequencerCheckpoints)
      .where(eq(sequencerCheckpoints.stream, STREAM)).for("update");
    const value = row?.value as Record<string, unknown> | undefined;
    const nextBlock = Number(value?.nextBlock);
    const epoch = Number(value?.epoch);
    if (!Number.isSafeInteger(nextBlock) || !Number.isSafeInteger(epoch)) return { status: "unconfigured" } as const;
    const current = nextBlock - 1;
    if (ceiling < current) return { status: "lagging", from: ceiling + 1, to: current } as const;

    await tx.delete(lpPositions).where(eq(lpPositions.pool, pool));
    const inserts: (typeof lpPositions.$inferInsert)[] = positions.filter((p) => BigInt(p.liquidity) > 0n).map((p) => ({
      pool, positionKey: p.positionKey, protocol: p.protocol, manager: p.manager,
      tokenId: p.tokenId, holder: p.holder, tickLower: p.tickLower, tickUpper: p.tickUpper,
      liquidity: p.liquidity, updatedBlock: p.updatedBlock,
    }));
    for (const chunk of chunks(inserts)) await tx.insert(lpPositions).values(chunk);
    const trackedRow: typeof lpTrackedPools.$inferInsert = {
      pool, protocol, epoch, hydratedThrough: ceiling, reason, lastVisitedAt: new Date().toISOString(),
    };
    await tx.insert(lpTrackedPools).values(trackedRow).onConflictDoUpdate({
      target: lpTrackedPools.pool,
      set: { protocol, epoch, hydratedThrough: ceiling, reason, lastVisitedAt: trackedRow.lastVisitedAt },
    });
    return { status: "tracked", through: ceiling } as const;
  });
}

export async function graphPoolsToTrack(limit = 100, minDepthUsd = 250): Promise<{ pool: string; protocol: "v3" | "v4" }[]> {
  const conn = database();
  if (!conn) return [];
  return conn.transaction(async (tx) => {
    const [checkpoint] = await tx.select({ value: sequencerCheckpoints.value }).from(sequencerCheckpoints)
      .where(eq(sequencerCheckpoints.stream, STREAM)).limit(1);
    const epoch = Number((checkpoint?.value as Record<string, unknown> | undefined)?.epoch);
    if (!Number.isSafeInteger(epoch)) return [];
    const graphStream = "lp-positions-graph";
    await tx.insert(sequencerCheckpoints).values({ stream: graphStream, value: { cursor: "" }, updatedAt: new Date().toISOString() })
      .onConflictDoNothing({ target: sequencerCheckpoints.stream });
    const [graph] = await tx.select({ value: sequencerCheckpoints.value }).from(sequencerCheckpoints)
      .where(eq(sequencerCheckpoints.stream, graphStream)).for("update");
    const cursor = String((graph?.value as Record<string, unknown> | undefined)?.cursor ?? "");
    const eligible = and(
      sql`${poolDepth.depthUsd} >= ${minDepthUsd}`,
      sql`${poolDepth.deadAt} is null`,
      sql`${poolDepth.protocol} in ('v3','v4')`,
      sql`(${lpTrackedPools.pool} is null or ${lpTrackedPools.epoch} <> ${epoch})`,
    );
    const batchLimit = Math.max(1, Math.min(100, limit));
    const after = await tx.select({ pool: poolDepth.poolId, protocol: poolDepth.protocol }).from(poolDepth)
      .leftJoin(lpTrackedPools, eq(lpTrackedPools.pool, poolDepth.poolId))
      .where(and(eligible, sql`${poolDepth.poolId} > ${cursor}`))
      .orderBy(poolDepth.poolId).limit(batchLimit);
    const before = after.length < batchLimit ? await tx.select({ pool: poolDepth.poolId, protocol: poolDepth.protocol }).from(poolDepth)
      .leftJoin(lpTrackedPools, eq(lpTrackedPools.pool, poolDepth.poolId))
      .where(and(eligible, sql`${poolDepth.poolId} <= ${cursor}`))
      .orderBy(poolDepth.poolId).limit(batchLimit - after.length) : [];
    const rows = [...after, ...before];
    if (rows.length > 0) await tx.update(sequencerCheckpoints)
      .set({ value: { cursor: rows[rows.length - 1].pool }, updatedAt: new Date().toISOString() })
      .where(eq(sequencerCheckpoints.stream, graphStream));
    return rows.filter((r): r is { pool: string; protocol: "v3" | "v4" } => r.protocol === "v3" || r.protocol === "v4");
  });
}

function chunks<T>(xs: readonly T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

interface CandidatePosition {
  pool: string;
  positionKey: string;
  protocol: "v3" | "v4";
  manager: string | null;
  tokenId: string | null;
  holder: string | null;
  tickLower: number;
  tickUpper: number;
  delta: bigint;
  lastBlock: number;
}

export interface PositionCommit {
  status: "unconfigured" | "replay" | "new-epoch" | "applied";
  upserted: number;
  deleted: number;
  negativeMissing: number;
}

/**
 * Commits sequencer-streamed LP position deltas exactly once within a single transaction.
 * Checkpoint: `epoch` is the POSITIONS epoch (tracked pools must match it); `recorderEpoch` is the
 * recorder's, compared to detect its resync. Conflating them made every step after a gap a new gap.
 */
export async function commitPositionStep(
  expectedFrom: number,
  to: number,
  epochOfRecorder: number,
  deltasInput: FoldedPositions | Map<string, Map<string, PositionDelta>>,
): Promise<PositionCommit> {
  const conn = database();
  if (!conn) return { status: "unconfigured", upserted: 0, deleted: 0, negativeMissing: 0 };

  return conn.transaction(async (tx) => {
    // 1. Seed checkpoint stream with nextBlock and epoch, then lock the row with FOR UPDATE.
    await tx.insert(sequencerCheckpoints)
      .values({
        stream: STREAM,
        value: { nextBlock: expectedFrom, epoch: epochOfRecorder, recorderEpoch: epochOfRecorder },
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing({ target: sequencerCheckpoints.stream });

    const rows = await tx
      .select({ value: sequencerCheckpoints.value })
      .from(sequencerCheckpoints)
      .where(eq(sequencerCheckpoints.stream, STREAM))
      .for("update");

    const current = rows[0]?.value as Record<string, unknown> | undefined;
    const savedNextBlock = Number(current?.nextBlock);
    const savedEpoch = Number(current?.epoch);
    const savedRecorderEpoch = Number(current?.recorderEpoch);

    // 2. Replay check: nextBlock already advanced beyond expectedFrom.
    if (Number.isSafeInteger(savedNextBlock) && savedNextBlock > expectedFrom) {
      return { status: "replay", upserted: 0, deleted: 0, negativeMissing: 0 };
    }

    // 3. Gap check: behind expectedFrom or recorder epoch moved. Write new epoch with no deltas.
    if (!Number.isSafeInteger(savedNextBlock) || !Number.isSafeInteger(savedEpoch) || savedNextBlock < expectedFrom || savedRecorderEpoch !== epochOfRecorder) {
      const nextVal = { nextBlock: to + 1, epoch: expectedFrom, recorderEpoch: epochOfRecorder, at: new Date().toISOString() };
      await tx.insert(sequencerCheckpoints)
        .values({ stream: STREAM, value: nextVal, updatedAt: new Date().toISOString() })
        .onConflictDoUpdate({
          target: sequencerCheckpoints.stream,
          set: { value: nextVal, updatedAt: new Date().toISOString() },
        });
      return { status: "new-epoch", upserted: 0, deleted: 0, negativeMissing: 0 };
    }

    // 4. Load tracked pools belonging to current epoch and apply deltas past hydrated_through.
    const deltasMap = "deltas" in deltasInput ? deltasInput.deltas : deltasInput;
    const poolKeys = [...deltasMap.keys()].map((p) => p.toLowerCase());

    let upsertedCount = 0;
    let deletedCount = 0;
    let negativeMissingCount = 0;

    if (poolKeys.length > 0) {
      const trackedRows: (typeof lpTrackedPools.$inferSelect)[] = [];
      for (const chunk of chunks(poolKeys, CHUNK_SIZE)) {
        const part = await tx
          .select()
          .from(lpTrackedPools)
          .where(and(inArray(lpTrackedPools.pool, chunk), eq(lpTrackedPools.epoch, savedEpoch)));
        trackedRows.push(...part);
      }

      const trackedMap = new Map<string, typeof lpTrackedPools.$inferSelect>();
      for (const r of trackedRows) {
        trackedMap.set(r.pool.toLowerCase(), r);
      }

      const candidates: CandidatePosition[] = [];
      for (const [poolKey, positions] of deltasMap.entries()) {
        const tracked = trackedMap.get(poolKey.toLowerCase());
        if (!tracked) continue;
        const hydratedThrough = Number(tracked.hydratedThrough);

        for (const [posKey, posDelta] of positions.entries()) {
          let effectiveDelta = 0n;
          let lastBlock = posDelta.lastBlock;

          if (posDelta.pieces && posDelta.pieces.length > 0) {
            const validPieces = posDelta.pieces.filter((p) => p.block > hydratedThrough);
            if (validPieces.length === 0) continue;
            effectiveDelta = validPieces.reduce((sum, p) => sum + p.delta, 0n);
            lastBlock = Math.max(...validPieces.map((p) => p.block));
          } else {
            if (posDelta.lastBlock <= hydratedThrough) continue;
            effectiveDelta = posDelta.delta;
          }

          if (effectiveDelta === 0n) continue;

          candidates.push({
            pool: tracked.pool.toLowerCase(),
            positionKey: posKey,
            protocol: posDelta.protocol,
            manager: posDelta.manager,
            tokenId: posDelta.tokenId !== null ? posDelta.tokenId.toString() : null,
            holder: posDelta.holder,
            tickLower: posDelta.tickLower,
            tickUpper: posDelta.tickUpper,
            delta: effectiveDelta,
            lastBlock,
          });
        }
      }

      if (candidates.length > 0) {
        const touchedPools = [...new Set(candidates.map((c) => c.pool))];
        const touchedKeys = [...new Set(candidates.map((c) => c.positionKey))];

        const existingRows: { pool: string; positionKey: string; liquidity: string }[] = [];
        for (const poolChunk of chunks(touchedPools, 100)) {
          for (const keyChunk of chunks(touchedKeys, 250)) {
            const part = await tx
              .select({
                pool: lpPositions.pool,
                positionKey: lpPositions.positionKey,
                liquidity: lpPositions.liquidity,
              })
              .from(lpPositions)
              .where(and(inArray(lpPositions.pool, poolChunk), inArray(lpPositions.positionKey, keyChunk)));
            existingRows.push(...part);
          }
        }

        const existingMap = new Map<string, bigint>();
        for (const r of existingRows) {
          existingMap.set(`${r.pool.toLowerCase()}:${r.positionKey}`, BigInt(r.liquidity));
        }

        const toUpsert: (typeof lpPositions.$inferInsert)[] = [];
        const toDelete: { pool: string; positionKey: string }[] = [];
        const poolsToInvalidate = new Set<string>();

        for (const cand of candidates) {
          const lookupKey = `${cand.pool}:${cand.positionKey}`;
          const currentLiq = existingMap.get(lookupKey);

          if (currentLiq === undefined) {
            if (cand.delta < 0n) {
              negativeMissingCount++;
              poolsToInvalidate.add(cand.pool);
              continue;
            }
            toUpsert.push({
              pool: cand.pool,
              positionKey: cand.positionKey,
              protocol: cand.protocol,
              manager: cand.manager,
              tokenId: cand.tokenId,
              holder: cand.holder,
              tickLower: cand.tickLower,
              tickUpper: cand.tickUpper,
              liquidity: cand.delta.toString(),
              updatedBlock: cand.lastBlock,
            });
          } else {
            const newLiq = currentLiq + cand.delta;
            // Below zero means an add we never saw: the stored set is wrong, so the pool re-hydrates.
            if (newLiq < 0n) {
              negativeMissingCount++;
              poolsToInvalidate.add(cand.pool);
            }
            if (newLiq <= 0n) {
              toDelete.push({ pool: cand.pool, positionKey: cand.positionKey });
            } else {
              toUpsert.push({
                pool: cand.pool,
                positionKey: cand.positionKey,
                protocol: cand.protocol,
                manager: cand.manager,
                tokenId: cand.tokenId,
                holder: cand.holder,
                tickLower: cand.tickLower,
                tickUpper: cand.tickUpper,
                liquidity: newLiq.toString(),
                updatedBlock: cand.lastBlock,
              });
            }
          }
        }

        for (const chunk of chunks(toUpsert, CHUNK_SIZE)) {
          await tx.insert(lpPositions)
            .values(chunk)
            .onConflictDoUpdate({
              target: [lpPositions.pool, lpPositions.positionKey],
              set: {
                liquidity: sql`excluded.liquidity`,
                updatedBlock: sql`excluded.updated_block`,
              },
            });
          upsertedCount += chunk.length;
        }

        const deletesByPool = new Map<string, string[]>();
        for (const d of toDelete) {
          const list = deletesByPool.get(d.pool) ?? [];
          list.push(d.positionKey);
          deletesByPool.set(d.pool, list);
        }
        for (const [pool, keys] of deletesByPool.entries()) {
          for (const chunk of chunks(keys, CHUNK_SIZE)) {
            await tx.delete(lpPositions).where(and(eq(lpPositions.pool, pool), inArray(lpPositions.positionKey, chunk)));
          }
        }
        deletedCount = toDelete.length;

        if (poolsToInvalidate.size > 0) {
          await tx.update(lpTrackedPools)
            .set({ epoch: -1 })
            .where(inArray(lpTrackedPools.pool, [...poolsToInvalidate]));
        }
      }
    }

    const nextVal = { nextBlock: to + 1, epoch: savedEpoch, recorderEpoch: epochOfRecorder, at: new Date().toISOString() };
    await tx.insert(sequencerCheckpoints)
      .values({ stream: STREAM, value: nextVal, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: sequencerCheckpoints.stream,
        set: { value: nextVal, updatedAt: new Date().toISOString() },
      });

    return { status: "applied", upserted: upsertedCount, deleted: deletedCount, negativeMissing: negativeMissingCount };
  });
}
