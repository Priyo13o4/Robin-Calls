import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import { database } from "@/lib/db/client";
import { lpPositions, lpTrackedPools, sequencerCheckpoints } from "@/lib/db/schema";

const STREAM = "lp-positions";
const BATCH_SIZE = 200;
const MAX_BATCHES = 25;
const DEPTH_OBSERVATION_MAX_AGE_HOURS = 48;

const DEFAULTS = {
  visitRetentionDays: 30,
  lowDepthUsd: 100,
  lowDepthDays: 14,
  graphMinDepthUsd: 250,
} as const;
type PruneThresholds = { visitRetentionDays: number; lowDepthUsd: number; lowDepthDays: number; graphMinDepthUsd: number };

const CONFIG_KEYS = {
  visitRetentionDays: "lp_positions_visit_retention_days",
  lowDepthUsd: "lp_positions_low_depth_usd",
  lowDepthDays: "lp_positions_low_depth_days",
  graphMinDepthUsd: "lp_positions_graph_min_depth_usd",
} as const;

function configuredNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

async function pruneThresholds() {
  const rows = await readSiteConfigKeys(Object.values(CONFIG_KEYS));
  return {
    visitRetentionDays: configuredNumber(rows[CONFIG_KEYS.visitRetentionDays], DEFAULTS.visitRetentionDays, 1, 3650),
    lowDepthUsd: configuredNumber(rows[CONFIG_KEYS.lowDepthUsd], DEFAULTS.lowDepthUsd, 0, 1_000_000_000),
    lowDepthDays: configuredNumber(rows[CONFIG_KEYS.lowDepthDays], DEFAULTS.lowDepthDays, 1, 3650),
    graphMinDepthUsd: configuredNumber(rows[CONFIG_KEYS.graphMinDepthUsd], DEFAULTS.graphMinDepthUsd, 0, 1_000_000_000),
  };
}

export interface LpPositionsPruneResult {
  batches: number;
  inspected: number;
  untracked: number;
  remaining: boolean;
  thresholds: PruneThresholds;
}

/**
 * Prune only bounded batches. The rotating prune_checked_at cursor makes a
 * large table progress across daily runs without touching last_visited_at.
 */
export async function pruneLpPositions(): Promise<LpPositionsPruneResult> {
  const conn = database();
  const thresholds = await pruneThresholds();
  if (!conn) return { batches: 0, inspected: 0, untracked: 0, remaining: false, thresholds };

  let batches = 0;
  let inspected = 0;
  let untracked = 0;
  const visitCutoff = new Date(Date.now() - thresholds.visitRetentionDays * 86_400_000).toISOString();
  const lowDepthCutoff = new Date(Date.now() - thresholds.lowDepthDays * 86_400_000).toISOString();
  const rotationCutoff = new Date(Date.now() - 86_400_000).toISOString();
  const now = new Date().toISOString();

  for (; batches < MAX_BATCHES; batches += 1) {
    const removed = await conn.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      const batch = await tx.select({ pool: lpTrackedPools.pool })
        .from(lpTrackedPools)
        .where(or(isNull(lpTrackedPools.pruneCheckedAt), lt(lpTrackedPools.pruneCheckedAt, rotationCutoff)))
        .orderBy(sql`${lpTrackedPools.pruneCheckedAt} asc nulls first`, asc(lpTrackedPools.pool))
        .limit(BATCH_SIZE);
      if (batch.length === 0) return { inspected: 0, removed: 0 };

      const pools = batch.map((row) => row.pool);
      inspected += pools.length;

      // A low-depth clock starts only from a recent observation. Missing or
      // stale observations reset it, since continuity can no longer be claimed.
      // Drizzle expands a bare JS array into a record, never a Postgres array.
      await tx.execute(sql`
        update lp_tracked_pools tracked
        set prune_checked_at = ${now},
            low_depth_since = case
              when depth.read_at >= now() - (${DEPTH_OBSERVATION_MAX_AGE_HOURS} * interval '1 hour')
               and depth.depth_usd is not null
               and depth.depth_usd::numeric < ${thresholds.lowDepthUsd}
                then coalesce(tracked.low_depth_since, depth.read_at)
              else null
            end
        from unnest(array[${sql.join(pools.map((pool) => sql`${pool}`), sql`, `)}]::text[]) as selected(pool)
        left join pool_depth depth on depth.pool_id = selected.pool
        where tracked.pool = selected.pool
      `);

      const checkpointRows = await tx.select({ value: sequencerCheckpoints.value })
        .from(sequencerCheckpoints).where(eq(sequencerCheckpoints.stream, STREAM)).limit(1);
      const checkpoint = checkpointRows[0]?.value as Record<string, unknown> | undefined;
      const epochValue = checkpoint?.epoch;
      const currentEpoch = Number(epochValue);
      const hasCurrentEpoch = epochValue !== null && epochValue !== undefined && Number.isSafeInteger(currentEpoch);

      const candidates = await tx.select({ pool: lpTrackedPools.pool })
        .from(lpTrackedPools)
        .where(and(
          inArray(lpTrackedPools.pool, pools),
          sql`(
            ${lpTrackedPools.epoch} = -1
            or ${hasCurrentEpoch ? sql`${lpTrackedPools.epoch} <> ${currentEpoch}` : sql`false`}
            or (
              ${lpTrackedPools.lastVisitedAt} < ${visitCutoff}
              and not exists (
                select 1 from pool_depth graph
                where graph.pool_id = ${lpTrackedPools.pool}
                  and graph.dead_at is null
                  and graph.depth_usd::numeric >= ${thresholds.graphMinDepthUsd}
              )
              and not exists (
                select 1 from verdicts saved
                where lower(saved.primary_pool_address) = lower(${lpTrackedPools.pool})
              )
            )
            or ${lpTrackedPools.lowDepthSince} < ${lowDepthCutoff}
          )`,
        ));
      const removePools = candidates.map((row) => row.pool);
      if (removePools.length > 0) {
        await tx.delete(lpPositions).where(inArray(lpPositions.pool, removePools));
        await tx.delete(lpTrackedPools).where(inArray(lpTrackedPools.pool, removePools));
      }
      return { inspected: pools.length, removed: removePools.length };
    });
    if (removed.inspected === 0) break;
    untracked += removed.removed;
  }

  const remaining = batches >= MAX_BATCHES && (await conn.select({ pool: lpTrackedPools.pool })
    .from(lpTrackedPools)
    .where(or(isNull(lpTrackedPools.pruneCheckedAt), lt(lpTrackedPools.pruneCheckedAt, rotationCutoff)))
    .limit(1)).length > 0;
  return { batches, inspected, untracked, remaining, thresholds };
}
