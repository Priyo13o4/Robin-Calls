import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Shared authentication for the internal `/api/jobs/*` endpoints.
 *
 * Every job route previously inlined:
 *
 *   if (!secret || req.headers.get("x-job-secret") !== secret) -> 401
 *
 * Eight copies of a security check is eight places for one to drift. It also
 * compared with `!==`, which short-circuits on the first differing byte and so
 * leaks the secret's length and prefix through response timing. These
 * endpoints trigger anchoring, deletion (log retention) and ingestion, so the
 * secret is worth protecting properly.
 *
 * Hashing both sides to a fixed 32 bytes before comparing keeps the compare
 * constant-time regardless of the candidate's length.
 */

const JOB_SECRET_HEADER = "x-job-secret";

function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns a 401 response when the caller is not an authorized internal job,
 * or `null` when the request is authorized and the route may proceed.
 *
 * Fails closed: an unset or blank `INTERNAL_JOB_SECRET` rejects every request
 * rather than leaving the endpoints open.
 */
export function requireJobAuth(req: NextRequest): NextResponse | null {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || secret.trim() === "") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const provided = req.headers.get(JOB_SECRET_HEADER);
  if (!provided || !constantTimeEquals(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * The response a flag-gated job returns when its feature flag is off.
 *
 * 200, not 403. These endpoints are driven by pg_cron via curl, which records
 * any non-2xx as a failed run — so a job that was intentionally left scheduled
 * ahead of its flag flip produced a failure every five minutes forever. That
 * noise is not free: it trains you to ignore the cron history, which is where
 * a genuine job failure would show up.
 *
 * A disabled job did exactly what it was asked to do, so it reports success
 * and says it skipped. Callers can still distinguish the cases via `skipped`.
 */
export function jobDisabled(reason: string, code?: string): NextResponse {
  return NextResponse.json(
    { skipped: true, reason, ...(code ? { code } : {}) },
    { status: 200 }
  );
}
