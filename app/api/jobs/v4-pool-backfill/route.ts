import { after, NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { advanceV4PoolBackfill } from "@/lib/launches/v4-pool-backfill";
import { createScanContext, runWithScanContext } from "@/lib/observability/context";
import { reportError } from "@/lib/observability/reporter";
import { jobDisabled, requireJobAuth } from "@/lib/security/job-auth";

export const maxDuration = 300;

/** Bounded historical backfill for Uniswap V4 PoolManager Initialize events. */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.v4PoolBackfill) return jobDisabled("V4 pool backfill is disabled", "RC_V4_POOL_BACKFILL_DISABLED");

  after(async () => {
    try {
      const result = await runWithScanContext(createScanContext(), () => advanceV4PoolBackfill());
      console.log("[v4-pool-backfill]", JSON.stringify(result));
    } catch (error) {
      await reportError({
        code: "RC_JOB_FAILED",
        message: "V4 pool backfill failed",
        operation: "job.v4PoolBackfill",
        error,
      });
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
