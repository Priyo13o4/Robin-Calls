import type { ScanRunContext } from "./context";
import type { ErrorCode } from "./codes";

/**
 * Scan-run summaries (PRD §20.3): one bounded row per pipeline execution,
 * carrying the RPC call-budget counters from §11.7. Never one row per RPC call.
 */

/**
 * §11.7 observability threshold — flags `rpc_budget_exceeded` for admin
 * triage. It NEVER stops, caps or degrades a scan: nothing branches on it.
 * (It reads like a cap and is not one — that misreading cost a session.)
 *
 * A flag that is almost always true carries no information. This constant has
 * now gone stale twice for that reason: 25 -> 50 when cross-DEX custody grew,
 * and 50 -> 1000 here. Measured over 309 prod scan_runs on 2026-09-05:
 *
 *   p50 192 · p90 674 · p99 5,452 · max 7,095
 *   flagged at 50 -> 92.2%   at 400 -> 28.5%   at 1000 -> 4.5%
 *
 * 1000 sits just above p95, so it names the genuine outliers and lets an
 * ordinary multi-venue scan through. Re-measure before moving it again; the
 * right value is a property of the workload, not of this file.
 */
export function rpcCallBudget(): number {
  const parsed = Number.parseInt(process.env.SCAN_RPC_CALL_BUDGET ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_000;
}

export interface ScanRunSummary {
  outcome: "complete" | "partial" | "rejected" | "failed";
  source?: "fresh" | "cache" | "database" | "stale-fallback";
  receiptAction?: "appended" | "reused" | "none";
  verdictId?: number | null;
  score?: number | null;
  tier?: string | null;
  dexProtocols?: string[];
  adapterOutcomes?: Record<string, unknown> | null;
  errorCode?: ErrorCode | null;
  /** Which clause behind `errorCode` fired; falls back to the code. */
  terminalCause?: string | null;
  /** Serialized verdict payload size — feeds the DB-runway estimate (§20.1). */
  evidenceBytes?: number | null;
}

export function isOverRpcBudget(ctx: ScanRunContext): boolean {
  return ctx.rpc.logicalCalls > rpcCallBudget();
}

/** Stable, bounded JSON shape for adapter coverage, with no pool identities or RPC detail. */
export function buildAdapterCoverageTelemetry(ctx: ScanRunContext): Record<string, unknown> {
  const coverage = ctx.adapterCoverage;
  if (!coverage) return { schema: 1, discovery: null, sellSimulation: null };
  return {
    schema: 1,
    discovery: {
      candidatePools: coverage.discovery.candidatePools,
      v4CandidatePools: coverage.discovery.v4CandidatePools,
      complete: coverage.discovery.complete,
      v4Complete: coverage.discovery.v4Complete,
    },
    sellSimulation: { ...coverage.sellSimulation },
  };
}

/**
 * Pure row-mapping logic, split out from `persistScanRun` so it's testable
 * without a live database connection (M14).
 *
 * The return type is pinned to the Drizzle insert shape on purpose. This
 * mapper previously emitted snake_case column names, which Drizzle silently
 * discards — every scan logged a NOT NULL violation on `scan_id` and no
 * `scan_runs` row was ever written. Typing it here makes that class of drift
 * a compile error rather than a runtime-only failure.
 */
export function buildScanRunRow(
  ctx: ScanRunContext,
  summary: ScanRunSummary
): typeof scanRuns.$inferInsert {
  const finishedAt = Date.now();
  return {
    scanId: ctx.scanId,
    requestId: ctx.requestId,
    tokenAddress: ctx.tokenAddress ? ctx.tokenAddress.toLowerCase() : "unknown",
    startedAt: new Date(ctx.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - ctx.startedAt,
    outcome: summary.outcome,
    source: summary.source ?? "fresh",
    receiptAction: summary.receiptAction ?? "none",
    verdictId: summary.verdictId ?? null,
    score: summary.score ?? null,
    tier: summary.tier ?? null,
    dexProtocols: summary.dexProtocols ?? [],
    adapterOutcomes:
      summary.adapterOutcomes !== undefined
        ? summary.adapterOutcomes
        : buildAdapterCoverageTelemetry(ctx),
    providerStates: Object.keys(ctx.providerStates).length ? ctx.providerStates : null,
    rpcLogicalCalls: ctx.rpc.logicalCalls,
    rpcPhysicalAttempts: ctx.rpc.physicalAttempts,
    rpcExpectedReverts: ctx.rpc.expectedReverts,
    rpcProviderSwitches: ctx.rpc.providerSwitches,
    // NULL when nothing was attempted — "we never looked", distinct from a map
    // that attempted calls and shows a provider served none of them (§4).
    providerCalls: ctx.rpc.physicalAttempts > 0 ? ctx.rpc.providerCalls : null,
    rpcMethodCounts: ctx.rpc.methodCounts,
    rpcTotalLatencyMs: ctx.rpc.totalLatencyMs,
    rpcBudgetExceeded: isOverRpcBudget(ctx),
    errorCode: summary.errorCode ?? null,
    // The gate clause when the thrower named one (RC_RPC_UNAVAILABLE's two causes), else the code.
    terminalCause: summary.terminalCause ?? summary.errorCode ?? null,
    evidenceBytes: summary.evidenceBytes ?? null,
    auditCpuMs: ctx.audit.cpuMs || null,
    auditExtraRpcCalls: ctx.audit.extraRpcCalls || null,
    auditExplorerCalls: ctx.audit.explorerCalls || null,
    auditCacheStatus: ctx.audit.cacheStatus,
    auditTargetsAnalyzed: ctx.audit.targetsAnalyzed || null,
    auditTruncationReason: ctx.audit.truncationReason,
    explorerWallMs: ctx.upstream.explorerWallMs || null,
    // Unlike the wall totals above, these are MEASUREMENTS where zero is a real
    // reading: "0 queue ms" means the gate never made us wait, which is exactly
    // the healthy value you want to watch drift away from (CLAUDE.md §8.3). So
    // they are gated on whether any explorer call happened at all, not on
    // truthiness of the value itself.
    explorerQueueMs: ctx.upstream.explorerCalls > 0 ? ctx.upstream.explorerQueueMs : null,
    explorerCalls: ctx.upstream.explorerCalls > 0 ? ctx.upstream.explorerCalls : null,
    // Gated on either counter: a scan that deduped everything and made zero
    // network calls is a real (excellent) reading, not an unmeasured one.
    explorerDeduped:
      ctx.upstream.explorerCalls > 0 || ctx.upstream.explorerDeduped > 0
        ? ctx.upstream.explorerDeduped
        : null,
    explorerEndpointCounts:
      ctx.upstream.explorerCalls > 0 ? ctx.upstream.explorerEndpoints : null,
    marketWallMs: ctx.upstream.marketWallMs || null,
    dbWallMs: ctx.upstream.dbWallMs || null,
    upstashWallMs: ctx.upstream.upstashWallMs || null,
    // A zero here is a MEASUREMENT, not an absence: "0 subcall failures" and
    // "0 fallbacks" are the healthy readings, and they are the two values you
    // actually want to watch drift away from zero. A per-field truthiness
    // guard (`x || null`) erases exactly those healthy readings and makes a
    // clean batch indistinguishable from an unmeasured one — CLAUDE.md §8.3,
    // falsy-zero coercion, which this codebase has already been bitten by on
    // both the read and write side.
    //
    // Only the total absence of batching activity is genuinely unknown, so
    // that is what gates NULL. `multicallFallbackCount` is deliberately part
    // of the condition: when Multicall3 itself is unavailable every chunk
    // falls back, giving 0 batches and N fallbacks — the single most
    // important case to record, and the one a `batches > 0` gate would hide.
    ...(ctx.rpc.multicallBatches > 0 || ctx.rpc.multicallFallbackCount > 0
      ? {
          multicallBatches: ctx.rpc.multicallBatches,
          multicallBatchedCalls: ctx.rpc.multicallBatchedCalls,
          multicallSubcallFailures: ctx.rpc.multicallSubcallFailures,
          multicallFallbackCount: ctx.rpc.multicallFallbackCount,
        }
      : {
          multicallBatches: null,
          multicallBatchedCalls: null,
          multicallSubcallFailures: null,
          multicallFallbackCount: null,
        }),
  };
}

/**
 * Persist the summary. Best-effort by design: a metrics write must never turn
 * a completed scan into a failed response, so failures degrade to console.
 */
import { writeScanRunRecord } from "../data/observability";
import type { scanRuns } from "../db/schema";

export async function persistScanRun(
  ctx: ScanRunContext,
  summary: ScanRunSummary
): Promise<void> {
  const row = buildScanRunRow(ctx, summary);

  try {
    await writeScanRunRecord(row);
  } catch (err) {
    console.error("[RC_DB_WRITE_FAILED] scan_runs insert failed:", err, {
      scanId: ctx.scanId,
      token: ctx.tokenAddress,
    });
  }
}
