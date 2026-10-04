import { NextRequest, NextResponse } from "next/server";

import { flags } from "@/lib/config/flags";
import { jobDisabled, requireJobAuth } from "@/lib/security/job-auth";
import { reportError } from "@/lib/observability/reporter";
import { resolveSaleAddress } from "@/lib/sale/address";
import { reconcileContributions } from "@/lib/referrals/reconcile";

export const maxDuration = 60;

/**
 * The contribution mirror's backstop (docs/prds/REFERRALS.md).
 *
 *   POST /api/jobs/sale-index   header  x-job-secret: $INTERNAL_JOB_SECRET
 *
 * No walker, no cursor, no blocks. The pass does two things:
 *
 *   1. re-verify every claim the endpoint left pending (receipt, status,
 *      Contributed log, the log's contributor — the same check, because a
 *      claim must never be refused on anything but a chain answer)
 *   2. read the contract's own census (`contributorCount()`,
 *      `contributors(i)`, `contributed(w)`) for contributors nobody claimed
 *      a hash for, and refresh every known wallet's total
 *
 * Idempotent end to end: claims are keyed by tx hash, census slots by
 * wallet, and totals are overwritten with the contract's current answer.
 * Schedule it every minute while the sale is open — the cheap cycle is one
 * multicall.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.tokenSale) {
    return jobDisabled("token sale disabled", "RC_TOKEN_SALE_DISABLED");
  }

  const sale = await resolveSaleAddress();
  if (sale.kind !== "address") {
    // Three states, and they are not the same job outcome. "Not configured"
    // is a correct no-op; "could not look" is a failure that must not report
    // success, or the mirror silently stops while cron stays green.
    if (sale.kind === "unconfigured") {
      return NextResponse.json({ ok: true, skipped: true, reason: "no sale address configured" });
    }
    return NextResponse.json({ ok: false, error: "sale address could not be read" }, { status: 503 });
  }

  try {
    const result = await reconcileContributions({
      saleAddress: sale.address,
      chainId: sale.chainId,
    });
    if (result.noContractAtSaleAddress) {
      await reportError({
        code: "RC_SALE_NO_CONTRACT",
        message: "the sale address holds no contract on the chain we resolved, so nothing can be indexed",
        operation: "jobs.saleIndex",
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await reportError({
      code: "RC_JOB_FAILED",
      message: "contribution reconciler run failed: referral eligibility is not advancing",
      operation: "jobs.saleIndex",
      error,
    });
    return NextResponse.json({ ok: false, error: "contribution reconciler run failed" }, { status: 500 });
  }
}
