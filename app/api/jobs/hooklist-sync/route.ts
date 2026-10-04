import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { syncUniswapHooklist } from "@/lib/hooks/sync";
import { reportError } from "@/lib/observability/reporter";

export const maxDuration = 60;

/** Daily copy of Uniswap's hook list (Robinhood Chain entries) into uniswap_hooks. */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.hooklistSync) return jobDisabled("hook list sync is disabled", "RC_HOOKLIST_DISABLED");
  try {
    return NextResponse.json(await syncUniswapHooklist());
  } catch (error) {
    await reportError({ code: "RC_JOB_FAILED", message: "Uniswap hook list sync failed", operation: "job.hooklistSync", error });
    // The previous list stays in place; a failed sync never empties it.
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" }, { status: 503 });
  }
}
