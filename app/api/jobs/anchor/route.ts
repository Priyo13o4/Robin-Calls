import { NextRequest, NextResponse } from "next/server";
import { anchorLedgerHead } from "@/lib/ledger/anchor";
import { requireJobAuth } from "@/lib/security/job-auth";

export const maxDuration = 60;

/**
 * Periodic anchoring job — call from Supabase pg_cron / an external cron:
 *   POST /api/jobs/anchor  with header  x-job-secret: $INTERNAL_JOB_SECRET
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  const result = await anchorLedgerHead();
  return NextResponse.json(result, { status: result.anchored ? 200 : 202 });
}
