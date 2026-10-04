import { NextRequest, NextResponse } from "next/server";
import { requireJobAuth } from "@/lib/security/job-auth";
import { reportError } from "@/lib/observability/reporter";
import {
  BadReadRequest,
  READS,
  READ_NAMES,
  ReadUnavailable,
  isReadName,
} from "@/lib/internal/reads";

/**
 * Internal read dispatcher for the FastAPI agent plane.
 *
 *   POST /api/internal/v1/read/<name>
 *   headers: x-job-secret: $INTERNAL_JOB_SECRET, x-rc-trace-id: <id>
 *   body:    { "args": { … } }
 *
 * Secret-first, following the `/api/jobs/*` precedent (`requireJobAuth` fails
 * closed on an unset secret). nginx additionally denies `/api/internal/` from
 * the public edge — CLAUDE.md §6's "both are required" doctrine, and the
 * second layer is four lines. Do not rely on either one alone.
 *
 * ── The response envelope, and why `found` exists ───────────────────────────
 *
 *   200 { ok: true,  found: true,  value: … }   the read answered
 *   200 { ok: true,  found: false, value: null } the read ran; nothing on record
 *   400 { ok: false, error, code: "bad_request" }
 *   401 { ok: false, error, code: "unauthorized" }
 *   404 { ok: false, error, code: "unknown_read", available: [ … ] }
 *   503 { ok: false, error, code: "read_unavailable", transient: true }
 *   500 { ok: false, error, code: "read_failed" }
 *
 * Three outcomes, not two, and the third is the one that matters. `lib/data/`
 * reads degrade to an empty value when the database is absent (CLAUDE.md §1),
 * and an agent that cannot tell "no deployer on record" from "we could not
 * look" will narrate the second as the first — publishing a clean bill of
 * health sourced from an outage (CLAUDE.md §4, "an empty result is not a
 * fact"). `found` separates the first two; `ReadUnavailable` → 503 separates
 * the third, which a plain emptiness test cannot see because the empty value is
 * non-null and nothing throws.
 *
 * Every branch carries `ok`, including the 401 — a consumer switching on
 * `payload.ok` must not see `undefined` for the one case it most needs.
 */

export const maxDuration = 30;

const ROUTE = "/api/internal/v1/read";

function traceId(req: NextRequest): string | null {
  const raw = req.headers.get("x-rc-trace-id");
  if (!raw) return null;
  // Bounded and character-restricted: this string is logged, and an unbounded
  // caller-supplied value in a log line is a log-injection vector.
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw) ? raw : null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  const { name } = await params;
  const trace = traceId(req);

  if (!isReadName(name)) {
    // Enumerating the registry here is deliberate: the caller is already
    // authenticated with the internal secret, and a typo'd tool `read` should
    // fail loudly with the valid set rather than send someone hunting.
    return NextResponse.json(
      { ok: false, error: `Unknown read \`${name}\`.`, code: "unknown_read", available: READ_NAMES },
      { status: 404 }
    );
  }

  let args: Record<string, unknown> = {};
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const raw = (body as { args?: unknown }).args;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        args = raw as Record<string, unknown>;
      }
    }
  } catch {
    // An absent or unparseable body means "no arguments" for the zero-arg
    // reads (get_methodology, get_indicted_stats); the arg-requiring reads
    // then reject on their own validation below, with a useful message.
  }

  try {
    const value = await READS[name](args);
    const found = value !== null && value !== undefined;
    return NextResponse.json(
      { ok: true, found, value: found ? value : null, trace },
      { status: 200, headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof BadReadRequest) {
      return NextResponse.json(
        { ok: false, error: err.message, code: "bad_request", trace },
        { status: 400 }
      );
    }
    await reportError({
      code: "RC_INTERNAL_READ_FAILED",
      message: `${name}: ${err instanceof Error ? err.message : String(err)}`,
      route: ROUTE,
      operation: name,
      error: err,
      details: trace ? { traceId: trace } : undefined,
    });
    return NextResponse.json(
      { ok: false, error: "The read failed.", code: "read_failed", trace },
      { status: 500 }
    );
  }
}
