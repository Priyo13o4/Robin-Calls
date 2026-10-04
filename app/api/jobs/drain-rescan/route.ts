import { after, NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { runDrainRescans } from "@/lib/wanted/drain-rescan";

export const maxDuration = 300;

/**
 * Hourly drain rescan job (L177 defect 2).
 * Rescans tokens with active drains whose newest verdict predates the drain.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  if (!flags.wantedIngestion || !flags.freshScan) {
    return jobDisabled("Drain rescan is disabled.");
  }

  // call_robincalls_job's curl gives up at 30s and one scan can take longer: answer now, scan after.
  after(async () => {
    const summary = await runDrainRescans();
    console.log("[drain-rescan]", JSON.stringify(summary));
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
