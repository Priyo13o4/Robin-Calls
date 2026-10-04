import { NextRequest, NextResponse } from "next/server";

import { flags } from "@/lib/config/flags";
import { jobDisabled, requireJobAuth } from "@/lib/security/job-auth";
import { reportError } from "@/lib/observability/reporter";
import { resolveSaleAddress } from "@/lib/sale/address";
import { buildAirdropSnapshot } from "@/lib/referrals/snapshot";
import {
  SnapshotIsFinalError,
  readSnapshotHeaders,
  readSnapshotById,
  type SnapshotHeader,
  type SnapshotRow,
} from "@/lib/data/sale-referrals";

export const maxDuration = 60;

/**
 * Freeze airdrop eligibility (docs/prds/REFERRALS.md §"The close").
 *
 *   POST /api/jobs/sale-snapshot   header  x-job-secret: $INTERNAL_JOB_SECRET
 *   body: { "id": "rehearsal-2026-09-06", "final": false, "notes": "..." }
 *
 * NOT on a schedule. It is run by hand — as a rehearsal any number of times
 * while the sale is open, and once for real after it closes.
 *
 * `final: true` is a request, never a promise. The run still happens and is
 * still stored, but it is only MARKED final when every gate passed; otherwise
 * it lands as a dry run with `blockers` saying exactly what stopped it. That is
 * the whole point of rehearsing: the failure arrives while there is still time
 * to fix it, not at the close.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.tokenSale) {
    return jobDisabled("token sale disabled", "RC_TOKEN_SALE_DISABLED");
  }

  let body: { id?: unknown; final?: unknown; notes?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  // An id is required rather than generated: re-running the same id REPLACES
  // that run, which is what makes a rehearsal repeatable — and a generated one
  // would quietly pile up a new snapshot per attempt instead. A run that is
  // already FINAL is the exception and is refused with a 409.
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) {
    return NextResponse.json(
      { error: "id must be 3-64 chars, lowercase letters, digits and hyphens" },
      { status: 400 },
    );
  }

  const sale = await resolveSaleAddress();
  if (sale.kind !== "address") {
    return NextResponse.json(
      { error: sale.kind === "unconfigured" ? "no sale address configured" : "sale address could not be read" },
      { status: sale.kind === "unconfigured" ? 400 : 503 },
    );
  }

  try {
    const outcome = await buildAirdropSnapshot({
      id,
      saleAddress: sale.address,
      chainId: sale.chainId,
      final: body.final === true,
      notes: typeof body.notes === "string" ? body.notes : null,
    });

    return NextResponse.json({
      ok: true,
      id: outcome.id,
      isFinal: outcome.isFinal,
      // Requested final but not marked final: the blockers say why, and this
      // flag is what a caller checks rather than assuming `final: true` took.
      finalRefused: body.final === true && !outcome.isFinal,
      blockers: outcome.blockers,
      contributorCount: outcome.contributorCount,
      buyerBonusCount: outcome.buyerBonusCount,
      qualifiedReferrerCount: outcome.qualifiedReferrerCount,
      totalRaisedWei: outcome.totalRaisedWei?.toString() ?? null,
      // Null means the read faulted, and a blocker says so. Never a zero, and
      // never the published SALE_TOKENS constant standing in (§8 #11).
      tokensForSale: outcome.tokensForSale?.toString() ?? null,
      mirroredWei: outcome.mirroredWei.toString(),
      owedBuyerTokens: outcome.owedBuyerTokens.toString(),
      owedReferrerTokens: outcome.owedReferrerTokens.toString(),
      owedReferrerWei: outcome.owedReferrerWei.toString(),
      headBlock: outcome.headBlock,
    });
  } catch (error) {
    // A refused overwrite is an answer, not a fault. 409 and the reason, so the
    // operator sees "that one is frozen" rather than "something broke".
    if (error instanceof SnapshotIsFinalError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 409 });
    }
    await reportError({
      code: "RC_JOB_FAILED",
      message: "airdrop snapshot run failed",
      operation: "jobs.saleSnapshot",
      error,
    });
    return NextResponse.json({ ok: false, error: "snapshot run failed" }, { status: 500 });
  }
}

function serializeHeader(h: SnapshotHeader) {
  return {
    ...h,
    totalRaisedWei: h.totalRaisedWei?.toString() ?? null,
    tokensForSale: h.tokensForSale?.toString() ?? null,
    mirroredWei: h.mirroredWei.toString(),
    qualifiedReferredWei: h.qualifiedReferredWei.toString(),
    owedBuyerTokens: h.owedBuyerTokens.toString(),
    owedReferrerTokens: h.owedReferrerTokens.toString(),
    owedReferrerWei: h.owedReferrerWei.toString(),
  };
}

function serializeRow(r: SnapshotRow) {
  return {
    ...r,
    contributedWei: r.contributedWei.toString(),
    saleAllocationTokens: r.saleAllocationTokens.toString(),
    buyerBonusTokens: r.buyerBonusTokens.toString(),
    referredWei: r.referredWei.toString(),
    referredAllocationTokens: r.referredAllocationTokens.toString(),
    referrerCommissionTokens: r.referrerCommissionTokens.toString(),
    referrerRebateWei: r.referrerRebateWei.toString(),
  };
}

/**
 * Read snapshot runs back.
 *
 *   GET /api/jobs/sale-snapshot              lists all runs, newest first
 *   GET /api/jobs/sale-snapshot?id=<id>      returns one run's header and every row
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.tokenSale) {
    return jobDisabled("token sale disabled", "RC_TOKEN_SALE_DISABLED");
  }

  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const result = await readSnapshotById(id);
    if (result.kind === "unavailable") {
      return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
    }
    if (result.kind === "absent") {
      return NextResponse.json({ ok: false, error: "snapshot not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      header: serializeHeader(result.header),
      rows: result.rows.map(serializeRow),
    });
  }

  const result = await readSnapshotHeaders();
  if (result.kind === "unavailable") {
    return NextResponse.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
  return NextResponse.json({
    ok: true,
    runs: result.runs.map(serializeHeader),
  });
}
