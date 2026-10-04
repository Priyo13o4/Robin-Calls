import { NextRequest, NextResponse } from "next/server";
import { purgeExpiredLogsRecord } from "@/lib/data/observability";
import { purgeExpiredSwapPlanRuns } from "@/lib/data/swap-plan-runs";
import { reportError } from "@/lib/observability/reporter";
import { requireJobAuth } from "@/lib/security/job-auth";

export const maxDuration = 60;

/**
 * Daily log-retention maintenance (PRD §20.3): delete expired app_error_events,
 * scan_runs, and swap_plan_runs rows in bounded batches. Aggregate metrics may outlive raw
 * events, but stack traces and request details must not.
 *
 * Bounded by design: at most MAX_BATCHES × BATCH_SIZE rows per table per
 * invocation, so a backlog never produces an unbounded delete. Retention never
 * touches verdicts, marks, rugs, or anchors.
 *
 *   POST /api/jobs/log-retention
 *   header: x-job-secret: $INTERNAL_JOB_SECRET
 */

const BATCH_SIZE = 500;
const MAX_BATCHES = 10;

function retentionDays(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

interface Target {
  table: "app_error_events" | "scan_runs";
  timeColumn: string;
  cutoffIso: string;
}

export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  const dayMs = 24 * 60 * 60 * 1000;
  const targets: Target[] = [
    {
      table: "app_error_events",
      timeColumn: "occurred_at",
      cutoffIso: new Date(
        Date.now() - retentionDays("APP_ERROR_RETENTION_DAYS", 30) * dayMs
      ).toISOString(),
    },
    {
      table: "scan_runs",
      timeColumn: "started_at",
      cutoffIso: new Date(
        Date.now() - retentionDays("SCAN_RUN_RETENTION_DAYS", 30) * dayMs
      ).toISOString(),
    },
  ];

  const summary: Record<string, { deleted: number; exhausted: boolean }> = {};
  try {
    for (const target of targets) {
      summary[target.table] = await purgeExpiredLogsRecord(
        target.table,
        target.timeColumn,
        target.cutoffIso,
        BATCH_SIZE,
        MAX_BATCHES
      );
    }

    const swapPlanCutoffIso = new Date(
      Date.now() - retentionDays("SWAP_PLAN_RUN_RETENTION_DAYS", 30) * dayMs
    ).toISOString();
    summary["swap_plan_runs"] = await purgeExpiredSwapPlanRuns(
      swapPlanCutoffIso,
      BATCH_SIZE,
      MAX_BATCHES
    );
  } catch (error) {

    await reportError({
      code: "RC_JOB_FAILED",
      message: "log-retention purge failed",
      route: "/api/jobs/log-retention",
      operation: "job.logRetention",
      error,
      details: { summary },
    });
    return NextResponse.json(
      { error: "retention purge failed", code: "RC_JOB_FAILED", summary },
      { status: 500 }
    );
  }

  // exhausted=true means a backlog remains; the next daily run keeps draining.
  return NextResponse.json({ ok: true, summary });
}
