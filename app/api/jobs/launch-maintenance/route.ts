import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { runLaunchMaintenance } from "@/lib/launches/maintenance";

export const maxDuration = 60;

/**
 * Hourly: prune launch telemetry and recount random committed windows (§6.3).
 *   POST /api/jobs/launch-maintenance  header  x-job-secret: $INTERNAL_JOB_SECRET
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.sequencerIngest && !flags.launchIngest) return jobDisabled("launch ingestion and maintenance are disabled", "RC_CURVES_DISABLED");
  const result = await runLaunchMaintenance();
  const healthy = result.ok && result.degraded.length === 0 && (result.recount?.missing.length ?? 0) === 0;
  return NextResponse.json(result, { status: healthy ? 200 : 503 });
}
