import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { propagateStains, retireContractStains } from "@/lib/lineage/stains";
import { revalidatePath } from "next/cache";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import {
  readLineageTraceTargets,
  readLatestRugForDeployer,
  updateStainsStatCount,
} from "@/lib/data/lineage";

export const maxDuration = 60;

/**
 * Funding-lineage propagation job (#4). For each confirmed rugger, walk the
 * funding web ≤2 hops and stain the linked wallets (hubs break the chain).
 *
 * Gated twice, like wanted-ingest: the job secret AND ENABLE_LINEAGE_TRACE.
 * Idempotent — stains upsert on (address, origin_rug_id).
 *
 *   POST /api/jobs/lineage-trace
 *   header: x-job-secret: $INTERNAL_JOB_SECRET
 *   body (optional): { deployers?: string[], limit?: number, retireLimit?: number }
 *
 * Also sweeps active stains for CONTRACT addresses and retires them — the gate
 * that prevents them is forward-only (KNOWN-PROBLEMS / handoff).
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.lineageTrace) {
    return jobDisabled("Lineage tracing is disabled.");
  }

  let body: { deployers?: string[]; limit?: number; retireLimit?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body is fine */
  }

  // targets: explicit deployers, or every confirmed rugger
  let targets: { address: string }[] = [];
  if (Array.isArray(body.deployers) && body.deployers.length) {
    targets = body.deployers.map((a) => ({ address: a.toLowerCase() }));
  } else {
    targets = await readLineageTraceTargets(Math.min(body.limit ?? 25, 100));
  }

  let stained = 0;
  let hubs = 0;
  let hubsOverridden = 0;
  for (const t of targets) {
    const rugId = await readLatestRugForDeployer(t.address);
    if (rugId === null) continue;
    const result = await propagateStains({ rugId, deployer: t.address });
    stained += result.stained;
    hubs += result.hubs;
    hubsOverridden += result.hubsOverridden;
  }

  // The CONTRACT gate above is forward-only, so rows written before it exists
  // are only reachable by re-reading them. Bounded per run and idempotent: an
  // already-retired stain is not active, so it is never revisited.
  const retired = await retireContractStains(Math.min(body.retireLimit ?? 200, 500));

  await updateStainsStatCount();

  if (stained > 0 || retired.rowsRetired > 0) {
    revalidatePath("/wanted");
    for (const target of targets) revalidatePath(`/wanted/${target.address}`);
  }

  // hubsOverridden (L63) is not persisted anywhere — this response, and job
  // logs of it, is the only auditable record that the fund-returned override
  // fired for a wallet that fan-out alone would have hub-blocked.
  return NextResponse.json({ processed: targets.length, stained, hubs, hubsOverridden, retired });
}
