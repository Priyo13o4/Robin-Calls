import { eq, and, desc, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { slowRugWatch, rugs, tokenMarks, verdicts, marketSnapshots } from "@/lib/db/schema";
import { toNumericString, fromNumericString } from "./numeric";
import { watchConfig } from "@/lib/config/watch";

export interface SlowRugWatchRow {
  tokenAddress: string;
  reason: string;
  peakLiquidityUsd: number | null;
  currentLiquidityUsd: number | null;
  drainPct: number | null;
  cleared: boolean;
  pinnedPoolAddress: string | null;
  evidence: unknown;
  updatedAt: string;
}

export async function upsertSlowRugWatchRecord(
  args: {
    tokenAddress: string;
    reason: string;
    peakLiquidityUsd: number | null;
    currentLiquidityUsd: number | null;
    drainPct: number | null;
    cleared: boolean;
    pinnedPoolAddress: string | null;
    evidence: unknown;
  }
): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  const now = new Date().toISOString();

  try {
    await conn
      .insert(slowRugWatch)
      .values({
        tokenAddress: args.tokenAddress.toLowerCase(),
        reason: args.reason,
        peakLiquidityUsd: toNumericString(args.peakLiquidityUsd),
        currentLiquidityUsd: toNumericString(args.currentLiquidityUsd),
        drainPct: toNumericString(args.drainPct),
        cleared: args.cleared,
        pinnedPoolAddress: args.pinnedPoolAddress,
        evidence: args.evidence,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [slowRugWatch.tokenAddress, slowRugWatch.reason],
        set: {
          peakLiquidityUsd: toNumericString(args.peakLiquidityUsd),
          currentLiquidityUsd: toNumericString(args.currentLiquidityUsd),
          drainPct: toNumericString(args.drainPct),
          cleared: args.cleared,
          pinnedPoolAddress: args.pinnedPoolAddress,
          evidence: args.evidence,
          updatedAt: now,
        },
      });
    return true;
  } catch (error: any) {
    console.error("slow_rug_watch upsert failed:", error.message);
    return false;
  }
}

export async function clearSlowRugWatchRecord(
  tokenAddress: string,
  reason: string
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .update(slowRugWatch)
    .set({ cleared: true, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(slowRugWatch.tokenAddress, tokenAddress.toLowerCase()),
        eq(slowRugWatch.reason, reason),
        eq(slowRugWatch.cleared, false)
      )
    );
}

/**
 * Ranks candidates by last observed liquidity DESC (NULLS LAST), then latest verdict id DESC,
 * and caps at `cap`. Returns selected tokens, total candidate count, and count of truncated tokens.
 */
export function selectWatchSet(
  candidates: Array<{
    token: string;
    lastLiquidityUsd: number | null;
    latestVerdictId: number;
  }>,
  cap: number
): {
  tokens: string[];
  candidates: number;
  truncated: number;
} {
  const sorted = [...candidates].sort((a, b) => {
    if (a.lastLiquidityUsd !== null && b.lastLiquidityUsd !== null) {
      if (b.lastLiquidityUsd !== a.lastLiquidityUsd) {
        return b.lastLiquidityUsd - a.lastLiquidityUsd;
      }
    } else if (a.lastLiquidityUsd !== null && b.lastLiquidityUsd === null) {
      return -1;
    } else if (a.lastLiquidityUsd === null && b.lastLiquidityUsd !== null) {
      return 1;
    }

    return b.latestVerdictId - a.latestVerdictId;
  });

  const capped = cap > 0 ? sorted.slice(0, cap) : [];
  const tokens = capped.map((c) => c.token.toLowerCase());
  const truncated = Math.max(0, candidates.length - tokens.length);

  return {
    tokens,
    candidates: candidates.length,
    truncated,
  };
}

export async function readWatchedTokensData(
  limit: number = watchConfig.watchMaxTokens
): Promise<{
  tokens: string[];
  pinnedPools: Map<string, string | null>;
  alreadyMarked: Set<string>;
  candidates: number;
  truncated: number;
}> {
  const conn = database();
  if (!conn) {
    return {
      tokens: [],
      pinnedPools: new Map(),
      alreadyMarked: new Set(),
      candidates: 0,
      truncated: 0,
    };
  }

  const cutoffIso = new Date(
    Date.now() - watchConfig.watchMaxVerdictAgeDays * 864e5
  ).toISOString();
  const peakSinceIso = new Date(Date.now() - watchConfig.peakWindowDays * 864e5).toISOString();

  const res = await conn.execute<Record<string, unknown>>(sql`
    WITH latest_verdicts AS (
      SELECT DISTINCT ON (lower(token_address))
        lower(token_address) AS token_address,
        id AS latest_verdict_id,
        created_at AS verdict_created_at
      FROM verdicts
      ORDER BY lower(token_address), id DESC
    ),
    latest_snapshots AS (
      SELECT DISTINCT ON (lower(token_address))
        lower(token_address) AS token_address,
        liquidity_usd,
        ts
      FROM market_snapshots
      ORDER BY lower(token_address), ts DESC, id DESC
    ),
    -- Peak, not just last: a pool sliding under minPeakUsd before crossing the
    -- drain threshold would otherwise leave the set unflagged.
    peak_snapshots AS (
      SELECT lower(token_address) AS token_address, max(liquidity_usd) AS peak_liquidity_usd
      FROM market_snapshots
      WHERE ts >= ${peakSinceIso}::timestamptz
      GROUP BY 1
    )
    SELECT
      v.token_address,
      s.liquidity_usd AS last_liquidity_usd,
      v.latest_verdict_id
    FROM latest_verdicts v
    LEFT JOIN latest_snapshots s ON s.token_address = v.token_address
    LEFT JOIN peak_snapshots p ON p.token_address = v.token_address
    WHERE v.verdict_created_at >= ${cutoffIso}::timestamptz
       OR s.liquidity_usd >= ${watchConfig.minPeakUsd}::numeric
       OR p.peak_liquidity_usd >= ${watchConfig.minPeakUsd}::numeric
    ORDER BY s.liquidity_usd DESC NULLS LAST, v.latest_verdict_id DESC
  `);

  const list: Record<string, unknown>[] = Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);

  const candidatesList = list.map((r) => ({
    token: String(r.token_address).toLowerCase(),
    lastLiquidityUsd: fromNumericString(r.last_liquidity_usd as string | null),
    latestVerdictId: Number(r.latest_verdict_id),
  }));

  const { tokens, candidates, truncated } = selectWatchSet(candidatesList, limit);

  if (tokens.length === 0) {
    return {
      tokens: [],
      pinnedPools: new Map(),
      alreadyMarked: new Set(),
      candidates,
      truncated,
    };
  }

  const [wRows, mRows] = await Promise.all([
    conn
      .select({
        tokenAddress: slowRugWatch.tokenAddress,
        pinnedPoolAddress: slowRugWatch.pinnedPoolAddress,
      })
      .from(slowRugWatch)
      .where(inArray(slowRugWatch.tokenAddress, tokens)),
    conn
      .select({ tokenAddress: tokenMarks.tokenAddress })
      .from(tokenMarks)
      .where(
        and(
          eq(tokenMarks.kind, "pump_dump"),
          isNull(tokenMarks.liftedAt),
          inArray(tokenMarks.tokenAddress, tokens)
        )
      ),
  ]);

  const pinnedPools = new Map<string, string | null>();
  for (const w of wRows) {
    if (w.pinnedPoolAddress) {
      pinnedPools.set(w.tokenAddress.toLowerCase(), w.pinnedPoolAddress);
    }
  }

  const alreadyMarked = new Set(mRows.map((m) => m.tokenAddress.toLowerCase()));

  return { tokens, pinnedPools, alreadyMarked, candidates, truncated };
}

/** Refuse a purge that would remove more than this share of tracked tokens in one run (§8 #22: likely a bad read). */
export const SNAPSHOT_PURGE_MAX_TOKEN_FRACTION = 0.5;

export function snapshotPurgeDecision(input: {
  keepCount: number;
  purgeTokens: number;
  tokensWithSnapshots: number;
}): { purge: boolean; skipped: string | null } {
  if (input.keepCount === 0) return { purge: false, skipped: "empty-watch-set" };
  if (input.purgeTokens === 0) return { purge: false, skipped: null };
  if (input.purgeTokens > input.tokensWithSnapshots * SNAPSHOT_PURGE_MAX_TOKEN_FRACTION) {
    return { purge: false, skipped: "purge-too-large" };
  }
  return { purge: true, skipped: null };
}

function resultRows(res: unknown): Record<string, unknown>[] {
  return Array.isArray(res) ? (res as Record<string, unknown>[]) : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
}

/**
 * Deletes every snapshot of a token that is dead to us: not in the watch set and not scanned within
 * watchMaxVerdictAgeDays. Never purges a token the Wanted board or an RWA page still reads
 * (open watch record, unlifted mark, rug, recorded pull, registry asset).
 */
export async function purgeDeadTokenSnapshots(
  keepTokens: string[]
): Promise<{ tokensPurged: number; rowsPurged: number; skipped: string | null }> {
  const conn = database();
  if (!conn) return { tokensPurged: 0, rowsPurged: 0, skipped: "no-database" };
  const keep = [...new Set(keepTokens.map((t) => t.toLowerCase()))];
  if (keep.length === 0) return { tokensPurged: 0, rowsPurged: 0, skipped: "empty-watch-set" };

  const cutoffIso = new Date(Date.now() - watchConfig.watchMaxVerdictAgeDays * 864e5).toISOString();
  const keepList = sql.join(keep.map((t) => sql`${t}`), sql`, `);

  const [planRes, totalRes] = await Promise.all([
    conn.execute(sql`
      with snap as (select lower(token_address) as t from market_snapshots group by 1),
      lv as (select lower(token_address) as t, max(created_at) as created_at from verdicts group by 1)
      select s.t from snap s left join lv on lv.t = s.t
      where (lv.created_at is null or lv.created_at < ${cutoffIso}::timestamptz)
        and s.t not in (${keepList})
        and not exists (select 1 from slow_rug_watch w where lower(w.token_address) = s.t and w.cleared = false)
        and not exists (select 1 from token_marks m where lower(m.token_address) = s.t and m.lifted_at is null)
        and not exists (select 1 from rugs r join tokens tk on tk.id = r.token_id where lower(tk.address) = s.t)
        and not exists (select 1 from registry g where lower(g.address) = s.t)
        and not exists (
          select 1 from verdicts v, jsonb_array_elements(v.checks) c
          where lower(v.token_address) = s.t and c->>'id' = 'deployer_pulled_liquidity'
            and jsonb_array_length(coalesce(c->'evidence'->'attributedPulls', '[]'::jsonb)) > 0
        )
    `),
    conn.execute(sql`select count(distinct lower(token_address))::int as n from market_snapshots`),
  ]);

  const purge = resultRows(planRes).map((r) => String(r.t));
  const tokensWithSnapshots = Number(resultRows(totalRes)[0]?.n ?? 0);
  const decision = snapshotPurgeDecision({ keepCount: keep.length, purgeTokens: purge.length, tokensWithSnapshots });
  if (!decision.purge) return { tokensPurged: 0, rowsPurged: 0, skipped: decision.skipped };

  // Recency re-checked inside the delete: a scan landing after the plan keeps its snapshot.
  const delRes = await conn.execute(sql`
    with d as (
      delete from market_snapshots
      where lower(token_address) in (${sql.join(purge.map((t) => sql`${t}`), sql`, `)})
        and lower(token_address) not in (select lower(token_address) from verdicts where created_at >= ${cutoffIso}::timestamptz)
      returning 1
    )
    select count(*)::int as n from d
  `);
  return { tokensPurged: purge.length, rowsPurged: Number(resultRows(delRes)[0]?.n ?? 0), skipped: null };
}

export async function writeMarketSnapshotBatch(
  rows: Array<{
    token_address: string;
    price_usd: number | null;
    liquidity_usd: number | null;
    volume_24h_usd: number | null;
    buys_24h: number | null;
    sells_24h: number | null;
    buyers_24h: number | null;
    sellers_24h: number | null;
    fdv_usd: number | null;
    pool_address: string | null;
    pool_created_at: string | null;
    bucket_at: string;
    provider: string;
    observation_status: string;
  }>
): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  try {
    for (const r of rows) {
      await conn
        .insert(marketSnapshots)
        .values({
          tokenAddress: r.token_address.toLowerCase(),
          priceUsd: toNumericString(r.price_usd),
          liquidityUsd: toNumericString(r.liquidity_usd),
          volume24HUsd: toNumericString(r.volume_24h_usd),
          buys24H: r.buys_24h,
          sells24H: r.sells_24h,
          buyers24H: r.buyers_24h,
          sellers24H: r.sellers_24h,
          fdvUsd: toNumericString(r.fdv_usd),
          poolAddress: r.pool_address,
          poolCreatedAt: r.pool_created_at,
          bucketAt: r.bucket_at,
          provider: r.provider,
          observationStatus: r.observation_status,
        })
        // `market_snapshots_token_bucket_idx` is a PARTIAL unique index
        // (`where bucket_at is not null`). Postgres only matches a conflict
        // target to a partial index when the same predicate is restated, so
        // an unqualified target raises "no unique or exclusion constraint
        // matching the ON CONFLICT specification" and the whole batch fails.
        .onConflictDoNothing({
          target: [marketSnapshots.tokenAddress, marketSnapshots.bucketAt],
          where: sql`${marketSnapshots.bucketAt} is not null`,
        });
    }
    return true;
  } catch (error: any) {
    console.error("writeMarketSnapshotBatch failed:", error.message);
    return false;
  }
}

export async function readRecentSnapshotsSeries(
  sinceIso: string,
  tokens: string[]
): Promise<Array<{
  token_address: string;
  liquidity_usd: number | null;
  price_usd: number | null;
  ts: string;
}>> {
  if (!tokens || tokens.length === 0) return [];

  const conn = database();
  if (!conn) return [];

  const lowerTokens = tokens.map((t) => t.toLowerCase());

  const rows = await conn
    .select({
      tokenAddress: marketSnapshots.tokenAddress,
      liquidityUsd: marketSnapshots.liquidityUsd,
      priceUsd: marketSnapshots.priceUsd,
      ts: marketSnapshots.ts,
    })
    .from(marketSnapshots)
    .where(
      and(
        gte(marketSnapshots.ts, sinceIso),
        inArray(marketSnapshots.tokenAddress, lowerTokens)
      )
    )
    .orderBy(desc(marketSnapshots.ts));

  return rows.map((r) => ({
    token_address: r.tokenAddress,
    liquidity_usd: fromNumericString(r.liquidityUsd),
    price_usd: fromNumericString(r.priceUsd),
    ts: r.ts ? new Date(r.ts).toISOString() : new Date().toISOString(),
  }));
}

export interface DrainRescanCandidate {
  id: number;
  tokenAddress: string;
  attempts: number;
}

/**
 * Reads tokens with active drains whose newest verdict predates the drain.
 * Tokens with any row done or at 3 attempts are excluded permanently.
 */
export async function readDrainRescanCandidates(
  limit: number = 3
): Promise<DrainRescanCandidate[]> {
  const conn = database();
  if (!conn || limit <= 0) return [];

  const res = await conn.execute(sql`
    with eligible as (
      select distinct on (lower(w.token_address))
        w.id,
        lower(w.token_address) as token_address,
        w.rescan_attempts,
        w.peak_liquidity_usd,
        w.created_at
      from slow_rug_watch w
      join (
        select lower(token_address) as token_address, max(created_at) as created_at
        from verdicts
        group by 1
      ) lv on lv.token_address = lower(w.token_address)
      where w.cleared = false
        and w.reason in ('liquidity-drain', 'pump-dump')
        and w.rescan_done_at is null
        and w.rescan_attempts < 3
        and (w.rescan_last_attempt_at is null or w.rescan_last_attempt_at < now() - interval '50 minutes')
        and lv.created_at < w.created_at
        and not exists (
          select 1 from slow_rug_watch x
          where lower(x.token_address) = lower(w.token_address)
            and (x.rescan_done_at is not null or x.rescan_attempts >= 3)
        )
      order by lower(w.token_address), w.peak_liquidity_usd desc nulls last, w.created_at asc
    )
    select id, token_address, rescan_attempts
    from eligible
    order by peak_liquidity_usd desc nulls last, created_at asc
    limit ${limit}
  `);

  return resultRows(res).map((r) => ({
    id: Number(r.id),
    tokenAddress: String(r.token_address).toLowerCase(),
    attempts: Number(r.rescan_attempts ?? 0),
  }));
}

/**
 * Claims one rescan attempt before running the scan, guarded by attempts < 3.
 */
export async function claimDrainRescanAttempt(id: number): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  const res = await conn
    .update(slowRugWatch)
    .set({
      rescanAttempts: sql`${slowRugWatch.rescanAttempts} + 1`,
      rescanLastAttemptAt: sql`now()`,
    })
    .where(
      and(
        eq(slowRugWatch.id, id),
        lt(slowRugWatch.rescanAttempts, 3),
        isNull(slowRugWatch.rescanDoneAt)
      )
    )
    .returning({ id: slowRugWatch.id });

  return res.length > 0;
}

/**
 * Marks every row for this token as rescan done, cleared or not.
 */
export async function markDrainRescanDone(tokenAddress: string): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn
    .update(slowRugWatch)
    .set({
      rescanDoneAt: sql`now()`,
    })
    .where(eq(slowRugWatch.tokenAddress, tokenAddress.toLowerCase()));
}
