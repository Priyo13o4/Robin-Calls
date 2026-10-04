import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { evaluateRug, type RugEvidenceInput } from "@/lib/wanted/rug-criteria";
import { assembleRugCandidates, type SkippedCandidate } from "@/lib/wanted/producer";
import { reportError } from "@/lib/observability/reporter";
import { revalidatePath } from "next/cache";
import { processRugCandidate, updateIndictedStatCount } from "@/lib/data/wanted";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { propagateStains } from "@/lib/lineage/stains";
import { readLatestRugForDeployer, updateStainsStatCount } from "@/lib/data/lineage";

export const maxDuration = 60;

/**
 * Wanted Board ingestion (PRD §7.6). Runs evidence through the rug-criteria
 * gate and writes ONLY confirmed rugs — with their evidence bundle — plus bumps
 * the deployer's counters.
 *
 * Two modes:
 *   - SELF-ASSEMBLING (no `candidates` in the body): the producer builds the
 *     candidate set from recorded evidence — active drains from The Watch and
 *     active honeypot marks. This is the cron path; the board fills itself.
 *   - EXPLICIT (`candidates` provided): judge exactly these. For backfills and
 *     testing.
 *
 * Gated twice: the job secret AND ENABLE_WANTED_INGESTION. The board stays
 * empty until the criteria are finalized and the flag is flipped.
 *
 *   POST /api/jobs/wanted-ingest
 *   header: x-job-secret: $INTERNAL_JOB_SECRET
 *   body (optional): { candidates?: RugEvidenceInput[], limit?: number }
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.wantedIngestion) {
    return jobDisabled("Wanted ingestion is disabled (rug criteria not finalized).");
  }
  let body: { candidates?: unknown; limit?: number } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body — the cron path; fall through to self-assembly */
  }

  let candidates: RugEvidenceInput[];
  let skipped: SkippedCandidate[] = [];
  let controlKindUnresolved: string[] = [];
  // An explicit candidate list was not assembled here, so nothing was cut here.
  let nominationsTruncated = 0;
  let mode: "explicit" | "self-assembled";
  if (body.candidates === undefined) {
    mode = "self-assembled";
    ({ candidates, skipped, nominationsTruncated, controlKindUnresolved } =
      await assembleRugCandidates({ limit: body.limit }));
  } else if (Array.isArray(body.candidates)) {
    mode = "explicit";
    candidates = body.candidates as RugEvidenceInput[];
  } else {
    return NextResponse.json(
      { error: "candidates must be an array when provided; omit it to self-assemble." },
      { status: 400 }
    );
  }

  let indicted = 0;
  const indictedDeployers = new Set<string>();
  for (const raw of candidates) {
    const match = evaluateRug(raw);
    if (!match.isRug) continue;

    const deployerAddr = raw.deployer.toLowerCase();
    try {
      const isNew = await processRugCandidate(raw, match);
      if (isNew) {
        indicted += 1;
        indictedDeployers.add(deployerAddr);
      }
    } catch (err: any) {
      await reportError({
        code: "RC_DB_WRITE_FAILED",
        message: err.message,
        operation: "job.wantedIngest.processRugCandidate",
        details: { deployer: deployerAddr, token: raw.tokenAddress.toLowerCase() },
      });
    }
  }

  // A fresh indictment traces its own funding web immediately.
  //
  // `propagateStains` had exactly one driver — /api/jobs/lineage-trace — and
  // that route was never given a pg_cron row (0010 and 0039 schedule anchor,
  // curve-poll, launch-retention, log-retention, slow-rug, tracker-poll and
  // wanted-ingest; lineage-trace is absent). So `wallet_stains` sat empty and
  // every board row rendered "THE WEB —" whether or not the rugger had funded
  // anyone. Chaining it here means the web is computed at the one moment we
  // know it matters, instead of depending on a schedule that does not exist.
  //
  // Best-effort by construction: a stain is an enrichment, and failing to
  // compute one must never lose the indictment we just wrote (§1 — best-effort
  // writes log and continue).
  let stained = 0;
  let hubsOverridden = 0;
  if (indicted > 0) {
    await updateIndictedStatCount();

    if (flags.lineageTrace) {
      for (const deployer of indictedDeployers) {
        try {
          const rugId = await readLatestRugForDeployer(deployer);
          if (rugId === null) continue;
          const result = await propagateStains({ rugId, deployer });
          stained += result.stained;
          hubsOverridden += result.hubsOverridden;
        } catch (err) {
          await reportError({
            code: "RC_LINEAGE_TRACE_FAILED",
            message: "post-indictment lineage trace failed; the rug row still stands",
            operation: "job.wantedIngest.propagateStains",
            error: err,
            details: { deployer },
          });
        }
      }
      if (stained > 0) await updateStainsStatCount();
    }

    revalidatePath("/wanted");
    for (const deployer of indictedDeployers) {
      revalidatePath(`/wanted/${deployer}`);
    }
  }


  return NextResponse.json({
    ok: true,
    mode,
    evaluated: candidates.length,
    indicted,
    stained,
    // L63: how often a fund-returned wallet was walked through instead of
    // hub-blocked on fan-out alone. Not persisted elsewhere.
    hubsOverridden,
    // Suspects seen but not judgeable — the board's blind spots, in the open.
    skipped: skipped.length,
    skippedReasons: skipped,
    // L194 — nominated suspects the run's limit cut before any criterion saw
    // them. Zero on every run whose union fits the budget; a rising number
    // means the board is judging a slice of its own queue.
    nominationsTruncated,
    // Tokens whose custody read DEPLOYER_CONTROLLED but never resolved a
    // wallet-vs-contract kind: the verdict predates `deployerKind`, or the
    // classification faulted. Criterion A is silent on these, and that silence
    // is indistinguishable from a clean pool unless it is counted — it stayed
    // uncounted because the producer computed this and nothing read it (§8 #10).
    // A non-zero count here is the size of the rescan, not a fault.
    controlKindUnresolved: controlKindUnresolved.length,
    controlKindUnresolvedTokens: controlKindUnresolved.slice(0, 50),
  });
}
