import { after, NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { reportError } from "@/lib/observability/reporter";
import { jobDisabled, requireJobAuth } from "@/lib/security/job-auth";
import { runLiquidityHistoryBackfillSingleFlight } from "@/lib/launches/liquidity-history-backfill";

export const maxDuration = 300;

/** Advance confirmed pool liquidity history and finish explicitly deferred scans. */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.liquidityHistory) {
    return jobDisabled("Pool liquidity history is disabled", "RC_LIQUIDITY_HISTORY_DISABLED");
  }

  after(async () => {
    try {
      const summary = await runLiquidityHistoryBackfillSingleFlight();
      console.log("[liquidity-history]", JSON.stringify(summary));
    } catch (error) {
      await reportError({
        code: "RC_JOB_FAILED",
        message: "Pool liquidity history job failed",
        operation: "job.liquidityHistory",
        error,
      });
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
