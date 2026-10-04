import { eq, isNull, count, sql, desc, and, inArray, lt, ilike, or, gt } from "drizzle-orm";
import { database } from "@/lib/db/client";
import {
  appErrorEvents,
  scanRuns,
  scanUncertainties,
  trustedLockers,
  directoryPlatforms,
  verdicts,
  deployers,
  tokenMarks,
  walletStains,
  launchpads,
  compareStats,
} from "@/lib/db/schema";
import { countCurveGraduations, countVisibleLaunches } from "@/lib/data/launches";
import type { LogFilters } from "@/app/admin/(dashboard)/logs/query";
import type { UncertaintyRow } from "@/lib/observability/uncertainties";

export async function readAdminOverviewStats(): Promise<number[]> {
  const conn = database();
  if (!conn) return Array(12).fill(0);

  const [
    pending,
    verdictsCount,
    indictedCount,
    trackedCount,
    publishedCount,
    openReview,
    activeMarksCount,
    activeStainsCount,
    unresolvedErrors,
    launchpadsEnabledCount,
    launchpadsTotalCount,
    lockersTotalCount,
  ] = await Promise.all([
    conn.select({ count: count() }).from(directoryPlatforms).where(eq(directoryPlatforms.status, "pending")),
    conn.select({ count: count() }).from(verdicts),
    conn.select({ count: count() }).from(deployers).where(gt(deployers.confirmedRugs, 0)),
    // §5.7 table collapse: tracked_launches (the pre-unified shortlist) is
    // retired — launch_candidates is the one surfaced-launch source now.
    countVisibleLaunches().then((n) => [{ count: n }]),
    conn.select({ count: count() }).from(directoryPlatforms).where(eq(directoryPlatforms.status, "published")),
    conn.select({ count: count() }).from(scanUncertainties).where(isNull(scanUncertainties.reviewedAt)),
    conn.select({ count: count() }).from(tokenMarks).where(isNull(tokenMarks.liftedAt)),
    conn.select({ count: count() }).from(walletStains).where(eq(walletStains.active, true)),
    conn.select({ count: count() }).from(appErrorEvents).where(isNull(appErrorEvents.resolvedAt)),
    conn.select({ count: count() }).from(launchpads).where(eq(launchpads.enabled, true)),
    conn.select({ count: count() }).from(launchpads),
    conn.select({ count: count() }).from(trustedLockers).where(eq(trustedLockers.enabled, true)),
  ]);

  return [
    pending[0]?.count ?? 0,
    verdictsCount[0]?.count ?? 0,
    indictedCount[0]?.count ?? 0,
    trackedCount[0]?.count ?? 0,
    publishedCount[0]?.count ?? 0,
    openReview[0]?.count ?? 0,
    activeMarksCount[0]?.count ?? 0,
    activeStainsCount[0]?.count ?? 0,
    unresolvedErrors[0]?.count ?? 0,
    launchpadsEnabledCount[0]?.count ?? 0,
    launchpadsTotalCount[0]?.count ?? 0,
    lockersTotalCount[0]?.count ?? 0,
  ];
}


export async function writeAppErrorEventRecord(
  row: typeof appErrorEvents.$inferInsert
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("db unconfigured");

  await conn.insert(appErrorEvents).values(row);
}

export async function writeScanRunRecord(
  row: typeof scanRuns.$inferInsert
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("db unconfigured");

  await conn.insert(scanRuns).values(row);
}

export interface AppErrorEventRow {
  id: number;
  occurred_at: string;
  severity: string;
  category: string;
  code: string;
  message: string;
  fingerprint?: string;
  route: string | null;
  operation: string | null;
  request_id?: string | null;
  scan_id?: string | null;
  token_address?: string | null;
  provider_id?: string | null;
  http_status?: number | null;
  request_outcome?: string | null;
  stack?: string | null;
  details?: unknown;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  resolved_at: string | null;
  resolved_by?: string | null;
}

export interface ScanRunRow {
  id: number;
  scan_id: string;
  request_id: string | null;
  token_address: string;
  started_at: string;
  duration_ms: number | null;
  outcome: string | null;
  source: string | null;
  receipt_action: string | null;
  verdict_id: number | null;

  score: number | null;
  tier: string | null;
  rpc_logical_calls: number | null;
  rpc_physical_attempts: number | null;
  rpc_expected_reverts: number | null;
  rpc_provider_switches: number | null;
  rpc_method_counts: unknown;
  rpc_total_latency_ms: number | null;
  rpc_budget_exceeded: boolean | null;
  provider_states: unknown;
  provider_calls: unknown;
  error_code: string | null;
  evidence_bytes: number | null;
}

export async function readRecentAppErrorEvents(
  limit = 50
): Promise<AppErrorEventRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(appErrorEvents)
    .orderBy(desc(appErrorEvents.occurredAt), desc(appErrorEvents.id))
    .limit(limit);

  return rows.map((r) => ({
    id: Number(r.id),
    occurred_at: r.occurredAt ? new Date(r.occurredAt).toISOString() : new Date().toISOString(),
    severity: r.severity,
    category: r.category,
    code: r.code,
    message: r.message,
    fingerprint: r.fingerprint,
    route: r.route ?? null,
    operation: r.operation ?? null,
    request_id: r.requestId ?? null,
    scan_id: r.scanId ?? null,
    token_address: r.tokenAddress ?? null,
    provider_id: r.providerId ?? null,
    http_status: r.httpStatus ?? null,
    request_outcome: r.requestOutcome ?? null,
    stack: r.stack ?? null,
    details: r.details,
    acknowledged_at: r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : null,
    acknowledged_by: r.acknowledgedBy ?? null,
    resolved_at: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
    resolved_by: r.resolvedBy ?? null,
  }));
}

export async function readUnresolvedAppErrorCount(): Promise<number> {
  const conn = database();
  if (!conn) return 0;

  const rows = await conn
    .select({ count: count() })
    .from(appErrorEvents)
    .where(isNull(appErrorEvents.resolvedAt));

  return rows[0]?.count ?? 0;
}

export async function readUnreviewedUncertaintyCount(): Promise<number> {
  const conn = database();
  if (!conn) return 0;

  const rows = await conn
    .select({ count: count() })
    .from(scanUncertainties)
    .where(isNull(scanUncertainties.reviewedAt));

  return rows[0]?.count ?? 0;
}

export async function queryErrorEventsData(
  f: LogFilters,
  limit: number
): Promise<AppErrorEventRow[]> {
  const conn = database();
  if (!conn) return [];

  const conditions = [];

  if (f.severity) conditions.push(eq(appErrorEvents.severity, f.severity));
  if (f.token) conditions.push(eq(appErrorEvents.tokenAddress, f.token.toLowerCase()));
  if (f.unresolvedOnly) conditions.push(isNull(appErrorEvents.resolvedAt));
  if (f.search) {
    conditions.push(
      or(
        ilike(appErrorEvents.code, `%${f.search}%`),
        ilike(appErrorEvents.message, `%${f.search}%`)
      )
    );
  }
  if (f.beforeId) conditions.push(lt(appErrorEvents.id, f.beforeId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await conn
    .select()
    .from(appErrorEvents)
    .where(whereClause)
    .orderBy(desc(appErrorEvents.id))
    .limit(limit);

  return rows.map((r) => ({
    id: Number(r.id),
    occurred_at: r.occurredAt ? new Date(r.occurredAt).toISOString() : new Date().toISOString(),
    severity: r.severity,
    category: r.category,
    code: r.code,
    message: r.message,
    fingerprint: r.fingerprint,
    route: r.route ?? null,
    operation: r.operation ?? null,
    request_id: r.requestId ?? null,
    scan_id: r.scanId ?? null,
    token_address: r.tokenAddress ?? null,
    provider_id: r.providerId ?? null,
    http_status: r.httpStatus ?? null,
    request_outcome: r.requestOutcome ?? null,
    stack: r.stack ?? null,
    details: r.details,
    acknowledged_at: r.acknowledgedAt ? new Date(r.acknowledgedAt).toISOString() : null,
    acknowledged_by: r.acknowledgedBy ?? null,
    resolved_at: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
    resolved_by: r.resolvedBy ?? null,
  }));
}

export async function queryScanRunsData(
  f: LogFilters,
  limit: number
): Promise<ScanRunRow[]> {
  const conn = database();
  if (!conn) return [];

  const conditions = [];

  if (f.outcome) conditions.push(eq(scanRuns.outcome, f.outcome));
  if (f.token) conditions.push(eq(scanRuns.tokenAddress, f.token.toLowerCase()));
  if (f.overBudgetOnly) conditions.push(eq(scanRuns.rpcBudgetExceeded, true));
  if (f.search) {
    conditions.push(
      or(
        ilike(scanRuns.errorCode, `%${f.search}%`),
        ilike(scanRuns.scanId, `%${f.search}%`)
      )
    );
  }
  if (f.beforeId) conditions.push(lt(scanRuns.id, f.beforeId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await conn
    .select()
    .from(scanRuns)
    .where(whereClause)
    .orderBy(desc(scanRuns.id))
    .limit(limit);

  return rows.map((r) => ({
    id: Number(r.id),
    scan_id: r.scanId,
    request_id: r.requestId ?? null,
    token_address: r.tokenAddress,
    started_at: r.startedAt ? new Date(r.startedAt).toISOString() : new Date().toISOString(),
    duration_ms: r.durationMs,
    outcome: r.outcome,
    source: r.source,
    receipt_action: r.receiptAction,
    verdict_id: r.verdictId != null ? Number(r.verdictId) : null,
    score: r.score ?? null,
    tier: r.tier ?? null,
    rpc_logical_calls: r.rpcLogicalCalls ?? null,
    rpc_physical_attempts: r.rpcPhysicalAttempts ?? null,
    rpc_expected_reverts: r.rpcExpectedReverts ?? null,
    rpc_provider_switches: r.rpcProviderSwitches ?? null,
    rpc_method_counts: r.rpcMethodCounts,
    rpc_total_latency_ms: r.rpcTotalLatencyMs ?? null,
    rpc_budget_exceeded: r.rpcBudgetExceeded ?? null,
    provider_states: r.providerStates,
    provider_calls: r.providerCalls,
    error_code: r.errorCode ?? null,
    evidence_bytes: r.evidenceBytes ?? null,
  }));
}

export async function updateErrorEventStamp(
  id: number,
  patch: {
    acknowledged_at?: string;
    acknowledged_by?: string;
    resolved_at?: string;
    resolved_by?: string;
  }
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  await conn
    .update(appErrorEvents)
    .set({
      acknowledgedAt: patch.acknowledged_at ?? undefined,
      acknowledgedBy: patch.acknowledged_by ?? undefined,
      resolvedAt: patch.resolved_at ?? undefined,
      resolvedBy: patch.resolved_by ?? undefined,
    })
    .where(eq(appErrorEvents.id, id));
}

export interface ScanUncertaintyRow {
  id: number;
  token_address: string;
  check_id: string;
  code: string;
  subject: string;
  summary: string;
  detail: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  last_verdict_id: number | null;
  times_seen: number;
  reviewed_at: string | null;
  reviewed_by: string | null;
  resolution: string | null;
}

export async function readScanUncertaintiesData(
  showAll = false,
  limit = 200
): Promise<ScanUncertaintyRow[]> {
  const conn = database();
  if (!conn) return [];

  const query = conn
    .select()
    .from(scanUncertainties)
    .where(showAll ? undefined : isNull(scanUncertainties.reviewedAt))
    .orderBy(desc(scanUncertainties.lastSeenAt))
    .limit(limit);

  const rows = await query;

  return rows.map((r) => ({
    id: Number(r.id),
    token_address: r.tokenAddress,
    check_id: r.checkId,
    code: r.code,
    subject: r.subject,
    summary: r.summary,
    detail: (r.detail as Record<string, unknown>) ?? null,
    first_seen_at: r.firstSeenAt ? new Date(r.firstSeenAt).toISOString() : new Date().toISOString(),
    last_seen_at: r.lastSeenAt ? new Date(r.lastSeenAt).toISOString() : new Date().toISOString(),
    last_verdict_id: r.lastVerdictId != null ? Number(r.lastVerdictId) : null,
    times_seen: r.timesSeen ?? 1,
    reviewed_at: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
    reviewed_by: r.reviewedBy ?? null,
    resolution: r.resolution ?? null,
  }));
}

export async function upsertScanUncertaintiesRecord(
  meta: { tokenAddress: string; scanId: string; verdictId: number | null },
  rows: UncertaintyRow[]
): Promise<void> {
  const conn = database();
  if (!conn) return;

  const token = meta.tokenAddress.toLowerCase();

  const existing = await conn
    .select({
      checkId: scanUncertainties.checkId,
      code: scanUncertainties.code,
      subject: scanUncertainties.subject,
      timesSeen: scanUncertainties.timesSeen,
    })
    .from(scanUncertainties)
    .where(eq(scanUncertainties.tokenAddress, token));

  const seen = new Map(
    existing.map((r) => [`${r.checkId}|${r.code}|${r.subject}`, r.timesSeen ?? 0])
  );

  const now = new Date().toISOString();

  for (const r of rows) {
    const timesSeen = (seen.get(`${r.checkId}|${r.code}|${r.subject}`) ?? 0) + 1;
    await conn
      .insert(scanUncertainties)
      .values({
        tokenAddress: token,
        checkId: r.checkId,
        code: r.code,
        subject: r.subject,
        summary: r.summary,
        detail: r.detail ?? null,
        lastSeenAt: now,
        lastScanId: meta.scanId,
        lastVerdictId: meta.verdictId,
        timesSeen,
      })
      .onConflictDoUpdate({
        target: [
          scanUncertainties.tokenAddress,
          scanUncertainties.checkId,
          scanUncertainties.code,
          scanUncertainties.subject,
        ],
        set: {
          summary: r.summary,
          detail: r.detail ?? null,
          lastSeenAt: now,
          lastScanId: meta.scanId,
          lastVerdictId: meta.verdictId,
          timesSeen,
        },
      });
  }
}

export async function resolveUncertaintyRecord(
  id: number,
  resolution: string,
  by: string
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  await conn
    .update(scanUncertainties)
    .set({
      reviewedAt: new Date().toISOString(),
      reviewedBy: by,
      resolution,
    })
    .where(eq(scanUncertainties.id, id));
}

export async function trustLockerAndResolveUncertainty(
  args: {
    id: number;
    address: string;
    label: string;
    kind: string;
    by: string;
  }
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  const now = new Date().toISOString();

  await conn
    .insert(trustedLockers)
    .values({
      address: args.address.toLowerCase(),
      label: args.label,
      kind: args.kind,
      enabled: true,
      notes: `Verified via /admin/review (uncertainty #${args.id}).`,
      addedBy: args.by,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: trustedLockers.address,
      set: {
        label: args.label,
        kind: args.kind,
        enabled: true,
        notes: `Verified via /admin/review (uncertainty #${args.id}).`,
        addedBy: args.by,
        updatedAt: now,
      },
    });

  await conn
    .update(scanUncertainties)
    .set({
      reviewedAt: now,
      reviewedBy: args.by,
      resolution: `Trusted as ${args.kind} locker: ${args.label}`,
    })
    .where(eq(scanUncertainties.id, args.id));
}

export async function purgeExpiredLogsRecord(
  table: "app_error_events" | "scan_runs",
  timeColumn: string,
  cutoffIso: string,
  batchSize = 500,
  maxBatches = 10
): Promise<{ deleted: number; exhausted: boolean }> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    let ids: number[] = [];
    if (table === "app_error_events") {
      const rows = await conn
        .select({ id: appErrorEvents.id })
        .from(appErrorEvents)
        .where(lt(appErrorEvents.occurredAt, cutoffIso))
        .orderBy(appErrorEvents.id)
        .limit(batchSize);
      ids = rows.map((r) => Number(r.id));
    } else {
      const rows = await conn
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(lt(scanRuns.startedAt, cutoffIso))
        .orderBy(scanRuns.id)
        .limit(batchSize);
      ids = rows.map((r) => Number(r.id));
    }

    if (ids.length === 0) return { deleted, exhausted: false };

    if (table === "app_error_events") {
      await conn.delete(appErrorEvents).where(inArray(appErrorEvents.id, ids));
    } else {
      await conn.delete(scanRuns).where(inArray(scanRuns.id, ids));
    }

    deleted += ids.length;
    if (ids.length < batchSize) return { deleted, exhausted: false };
  }

  return { deleted, exhausted: true };
}

export async function readCompareStats(): Promise<Record<string, number>> {
  const conn = database();
  if (!conn) return {};

  const rows = await conn.select({ key: compareStats.key, value: compareStats.value }).from(compareStats);
  const out: Record<string, number> = {};
  for (const r of rows) {
    out[r.key] = Number(r.value);
  }
  return out;
}

export interface PlatformCounters {
  /** Launchpads with adapters enabled in the registry. */
  launchpadsLive: number;
  /** curve_tokens rows that reached a DEX graduation. */
  curveGraduations: number;
}

/**
 * Coverage counters for the landing page's Record metrics — the same numbers
 * the project overview's snapshot table quotes. Live reads, not compareStats
 * accumulators: a registry toggle or a graduation lands here on the next
 * revalidate without a counter-increment job having to exist.
 */
export async function readPlatformCounters(): Promise<PlatformCounters> {
  const conn = database();
  if (!conn) return { launchpadsLive: 0, curveGraduations: 0 };

  /**
   * A graduation is only an event where a curve existed to graduate FROM.
   *
   * DEX_RESTRICTED pads launch straight into a pool, and their rows are born
   * `GRADUATED` because that is this schema's only word for "its market is a
   * DEX pool" (see cashcat-v1's header). Counting the status therefore counted
   * a venue flag as a lifecycle event: on prod the landing tile read 63,505
   * against 1,602 reconciled graduations. Joining the pad's venue model is what
   * separates the two — NOT `dex_pool_address is not null`, which would drop
   * every real V4 graduation, since a V4 pool has a poolId and no address.
   */
  const [padRows, curveGraduations] = await Promise.all([
    conn.select({ v: count() }).from(launchpads).where(eq(launchpads.enabled, true)),
    countCurveGraduations(),
  ]);
  return {
    launchpadsLive: Number(padRows[0]?.v ?? 0),
    curveGraduations,
  };
}

export interface LandingStats {
  verdicts_issued: number;
  anchors_onchain: number;
  wallets_indicted: number;
  launchpads_live: number;
  curve_graduations: number;
}

/**
 * The merge `/api/stats` and the landing page's server-rendered stats bar both
 * need — `readCompareStats`'s accumulators overlaid on `readPlatformCounters`'s
 * live reads. Pulled out so the two callers cannot drift on which field wins.
 */
export async function readLandingStats(): Promise<LandingStats> {
  try {
    const [loaded, counters] = await Promise.all([readCompareStats(), readPlatformCounters()]);
    const stats: LandingStats = {
      verdicts_issued: 0,
      anchors_onchain: 0,
      wallets_indicted: 0,
      launchpads_live: counters.launchpadsLive,
      curve_graduations: counters.curveGraduations,
    };
    for (const [key, value] of Object.entries(loaded)) {
      if (key in stats) stats[key as keyof LandingStats] = value;
    }
    return stats;
  } catch {
    return {
      verdicts_issued: 0,
      anchors_onchain: 0,
      wallets_indicted: 0,
      launchpads_live: 0,
      curve_graduations: 0,
    };
  }
}


