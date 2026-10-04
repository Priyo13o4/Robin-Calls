import { after, NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { runPoolDepthJob } from "@/lib/swap/depth-refresh";
import { reportError } from "@/lib/observability/reporter";

export const maxDuration = 300;

/** Pool depth sweep (docs/cross-dex-router/ROUTE-GRAPH-PLAN.md, Freshness). `?tier=hot|full`. */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.poolDepthSweep) return jobDisabled("pool depth sweep is disabled", "RC_POOL_DEPTH_DISABLED");

  const tier = new URL(req.url).searchParams.get("tier");
  if (tier !== "full" && tier !== "hot") return NextResponse.json({ error: "tier must be full or hot" }, { status: 400 });

  // call_robincalls_job's curl gives up at 30s and a full sweep takes minutes: answer now, sweep after.
  after(async () => {
    try {
      const out = await runPoolDepthJob(tier);
      console.log("[pool-depth]", JSON.stringify(out));
    } catch (error) {
      await reportError({ code: "RC_JOB_FAILED", message: `Pool depth sweep (${tier}) failed`, operation: "job.poolDepth", error });
    }
  });
  return NextResponse.json({ accepted: true, tier }, { status: 202 });
}
