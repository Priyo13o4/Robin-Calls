import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/observability/reporter";

export const dynamic = "force-dynamic";

/**
 * Collector for the Report-Only CSP set in `docker/nginx/nginx.conf`.
 *
 * The policy cannot be enforced until we know what it would break — this app
 * renders three.js, GSAP, framer-motion and Next's inline bootstrap — so it
 * runs in Report-Only and this route is what makes that mode worth anything.
 * Without a collector, Report-Only is a header that does nothing.
 *
 * Deliberately cheap and unauthenticated: browsers send these without
 * credentials and will not retry. That makes it an open POST sink, so it is
 * rate-limited (`classifyPath` → "report") and hard-capped on body size below.
 *
 * Always answers 204, even on junk. A 4xx teaches nothing — the browser does
 * not act on it — and returning detail to an unauthenticated caller only helps
 * someone probe the endpoint.
 */

/** A violation report is a few hundred bytes. Anything larger is not one. */
const MAX_BODY_BYTES = 8_192;

/** Reports arrive in two shapes: CSP Level 2, and the newer Reporting API. */
interface CspViolation {
  documentUri?: string;
  blockedUri?: string;
  violatedDirective?: string;
  disposition?: string;
}

function normalize(payload: unknown): CspViolation[] {
  if (payload && typeof payload === "object" && "csp-report" in payload) {
    const r = (payload as Record<string, Record<string, unknown>>)["csp-report"] ?? {};
    return [
      {
        documentUri: String(r["document-uri"] ?? ""),
        blockedUri: String(r["blocked-uri"] ?? ""),
        violatedDirective: String(r["violated-directive"] ?? r["effective-directive"] ?? ""),
        disposition: String(r["disposition"] ?? "report"),
      },
    ];
  }
  if (Array.isArray(payload)) {
    return payload
      .filter((e) => e && typeof e === "object" && (e as Record<string, unknown>).type === "csp-violation")
      .map((e) => {
        const b = ((e as Record<string, unknown>).body ?? {}) as Record<string, unknown>;
        return {
          documentUri: String(b.documentURL ?? ""),
          blockedUri: String(b.blockedURL ?? ""),
          violatedDirective: String(b.effectiveDirective ?? ""),
          disposition: String(b.disposition ?? "report"),
        };
      });
  }
  return [];
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  // Bound the read before parsing. An unauthenticated endpoint that JSON.parses
  // whatever it is handed is a free CPU sink.
  if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Malformed report. Nothing to learn and nothing to fix — the browser sent
    // it, not a user, and it will not be retried.
    return new NextResponse(null, { status: 204 });
  }

  for (const v of normalize(payload)) {
    if (!v.violatedDirective) continue;
    // Fingerprinted on (code, route, operation), and `operation` carries the
    // directive — so a hundred pages violating `img-src` dedupe into one row
    // per directive rather than flooding the table. That is the point: what we
    // need out of Report-Only is the SET of directives that would break, not a
    // count of page views.
    await reportError({
      code: "RC_CSP_VIOLATION",
      message: `${v.violatedDirective} blocked ${v.blockedUri || "(inline)"}`,
      route: "/api/csp-report",
      operation: `csp.${v.violatedDirective}`,
      details: {
        documentUri: v.documentUri,
        blockedUri: v.blockedUri,
        disposition: v.disposition,
      },
      requestOutcome: "completed",
    });
  }

  return new NextResponse(null, { status: 204 });
}
