import { after, NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { pruneLpPositions } from "@/lib/data/lp-positions-prune";
import { graphPoolsToTrack } from "@/lib/data/lp-positions";
import { reportError } from "@/lib/observability/reporter";
import { jobDisabled, requireJobAuth } from "@/lib/security/job-auth";
import { trackPool } from "@/lib/trade/lp-hydrate";

export const maxDuration = 300;

/** Daily bounded cleanup for the tracked LP position store. */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.lpPositions) return jobDisabled("LP position storage is disabled", "RC_LP_POSITIONS_DISABLED");

  const task = new URL(req.url).searchParams.get("task");
  if (task !== "prune" && task !== "graph") {
    return NextResponse.json({ error: "task must be prune or graph" }, { status: 400 });
  }

  // The scheduler's curl deadline is 30 seconds; answer first and do bounded
  // database batches after the response.
  after(async () => {
    try {
      if (task === "prune") {
        const result = await pruneLpPositions();
        console.log("[lp-positions-prune]", JSON.stringify(result));
        return;
      }

      // One bounded graph batch per invocation. An empty pool_depth table is a
      // normal no-op until the depth sweep has populated it.
      const candidates = await graphPoolsToTrack(100);
      const results = [];
      for (const candidate of candidates) {
        results.push(await trackPool(candidate.pool, candidate.protocol, "graph"));
      }
      console.log("[lp-positions-graph]", JSON.stringify({ selected: candidates.length, results }));
    } catch (error) {
      await reportError({
        code: "RC_JOB_FAILED",
        message: `LP position ${task} task failed`,
        operation: `job.lpPositions.${task}`,
        error,
      });
    }
  });

  return NextResponse.json({ accepted: true, task }, { status: 202 });
}
