import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { runLaunchIngest } from "@/lib/launches/ingest";

export const maxDuration = 60;

/**
 * Launch registry ingest (docs/ways-of-work/plan/launchpad-tracking/ARCHITECTURE.md §6.2),
 * scheduled every minute by migration 0093.
 *   POST /api/jobs/launch-ingest  header  x-job-secret: $INTERNAL_JOB_SECRET
 * A degraded run answers 503: pg_cron's only health signal is curl's exit code.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.launchIngest) {
    return jobDisabled("launch ingest retired in favor of realtime sequencer stream", "RC_SEQUENCER_ACTIVE");
  }
  const result = await runLaunchIngest();
  if (result.ok && (result.windows.some((w) => w.launches + w.events > 0) || (result.state?.read ?? 0) > 0)) {
    revalidatePath("/night-market");
  }
  const healthy = result.ok && result.degraded.length === 0;
  return NextResponse.json(result, { status: healthy ? 200 : 503 });
}
