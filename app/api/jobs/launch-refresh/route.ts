import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { runLaunchRefresh } from "@/lib/launches/refresh";

export const maxDuration = 60;

/** Five-minute bounded curve-state and market refresh; discovery is handled by the live feeds. */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.sequencerIngest && !flags.launchIngest) {
    return jobDisabled("launch ingestion and refresh are disabled", "RC_CURVES_DISABLED");
  }
  const result = await runLaunchRefresh();
  if (result.ok && result.degraded.length === 0) revalidatePath("/night-market");
  const healthy = result.ok && result.degraded.length === 0;
  return NextResponse.json(result, { status: healthy ? 200 : 503 });
}
