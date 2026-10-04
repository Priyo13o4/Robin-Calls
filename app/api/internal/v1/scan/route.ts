import { isIP } from "node:net";
import { NextRequest, NextResponse } from "next/server";
import { requireJobAuth } from "@/lib/security/job-auth";
import { POST as publicScan } from "@/app/api/scan/route";

/**
 * Internal scan endpoint for the FastAPI agent plane.
 *
 *   POST /api/internal/v1/scan
 *   headers: x-job-secret, x-rc-trace-id, x-rc-caller-ip
 *   body:    { "address": "0x…" }
 *
 * ── Why this delegates instead of reimplementing ────────────────────────────
 *
 * `POST /api/scan` is the whole §7 state machine: cooldown cache → database
 * pointer → both kill switches → atomic multi-budget admission → per-token
 * lock → join-in-flight → pipeline → receipt policy → failure cache →
 * `persistScanRun` → uncertainty collection → compare-and-release. Copying
 * that here to get a non-streaming response would be the eighth-copy defect
 * CLAUDE.md §2 names, and the copy that drifts is the one holding the
 * capacity budgets — an agent that quietly skipped `admitFreshPipeline` would
 * launch unbounded pipelines while the dashboard showed a healthy global
 * gauge.
 *
 * So this route is a **transport adapter, not a second scanner**. It calls the
 * real handler in-process and collapses its NDJSON progress stream into one
 * JSON object, because an MCP `tools/call` has nowhere to put progress events.
 * Every budget, kill switch, and side effect runs exactly once, in the code
 * that already exists and is already tested.
 *
 * The caller's identity is forwarded as `x-forwarded-for` so the per-IP
 * fresh-scan budget applies to the end user rather than pooling every agent
 * request into the container's own address.
 *
 * `x-rc-caller-ip` is therefore a *budget key*, and a budget key an attacker
 * writes is not a budget. Two layers hold it:
 *
 *   1. nginx overwrites the header with `$remote_addr` on every location that
 *      reaches the agent, so a value set by the public caller never survives
 *      the edge.
 *   2. this route accepts it only if it parses as an IP address. Anything else
 *      is dropped rather than passed through, so a malformed or hostile value
 *      degrades to "the agent container's own address" — every agent scan
 *      sharing one budget, which is a capacity annoyance, not a way to spend
 *      someone else's allowance or to mint unlimited ones.
 *
 * Without those, randomising the header defeats `SCAN_IP_DAILY_LIMIT` entirely,
 * and setting it to a real user's address burns *their* daily budget and 429s
 * them on robincalls.com for the rest of the UTC day.
 */

export const maxDuration = 180; // must match /api/scan — the pipeline's budget

interface TerminalEvent {
  type: "done" | "error";
  body?: unknown;
  code?: string;
  message?: string;
  httpStatus?: number;
}

/**
 * Collapse the NDJSON progress stream to its terminal line.
 *
 * A stream commits to HTTP 200 before the outcome is known, so the real status
 * lives in the final `done`/`error` line's `httpStatus`. Losing that mapping is
 * failure mode §12.5 in the plan: a 503 "the explorer is down, no verdict was
 * recorded" arriving as a 200 body would be narrated by the agent as a finding
 * about the token. The transport fault must stay a transport fault.
 */
async function collapseNdjson(res: Response): Promise<NextResponse> {
  const text = await res.text();
  let terminal: TerminalEvent | null = null;
  const retries: unknown[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: { type?: string };
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // a partial line at the tail is not an outcome
    }
    if (event.type === "retry") retries.push(event);
    if (event.type === "done" || event.type === "error") {
      terminal = event as TerminalEvent;
    }
  }

  if (!terminal) {
    // The stream ended without committing to an outcome — a truncated
    // response, not a verdict. Never fabricate one from the partial lines.
    return NextResponse.json(
      {
        ok: false,
        code: "RC_SCAN_PIPELINE_FAILED",
        error: "The scan stream ended without a result.",
        transient: true,
      },
      { status: 502 }
    );
  }

  if (terminal.type === "error") {
    const status = terminal.httpStatus ?? 500;
    return NextResponse.json(
      {
        ok: false,
        code: terminal.code ?? "RC_SCAN_PIPELINE_FAILED",
        error: terminal.message ?? "The scan failed.",
        // The transient/definite split the agent needs. 5xx and 429 are
        // infrastructure or capacity: retryable, and NOT a statement about the
        // token. 4xx below 429 is a domain rejection (not a contract, bad
        // input) — a real answer the agent may repeat to the user.
        transient: status >= 500 || status === 429,
        retries: retries.length,
      },
      { status }
    );
  }

  return NextResponse.json(
    { ok: true, ...(terminal.body as Record<string, unknown>), retries: retries.length },
    { status: 200 }
  );
}

export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  const body = await req.text();

  const headers = new Headers({ "content-type": "application/json" });
  const callerIp = req.headers.get("x-rc-caller-ip");
  // `isIP` returns 0 for anything that is not a v4 or v6 address, which also
  // rules out a comma-joined list — one header, one caller, one budget key.
  if (callerIp && isIP(callerIp) !== 0) headers.set("x-forwarded-for", callerIp);
  const trace = req.headers.get("x-rc-trace-id");
  // The scan context adopts `x-request-id`, so reusing the agent's trace id
  // here makes one identifier span the chat turn, this scan, `scan_runs`, and
  // anything `reportError` writes.
  if (trace && /^[A-Za-z0-9_-]{1,64}$/.test(trace)) headers.set("x-request-id", trace);

  const inner = new NextRequest(new URL("/api/scan", req.url), {
    method: "POST",
    headers,
    body,
  });

  const res = await publicScan(inner);

  // Non-streaming outcomes (cache hit, database pointer, capacity denial, a
  // kill switch) are already JSON and already carry the right status.
  if (res.headers.get("content-type")?.includes("application/x-ndjson")) {
    return collapseNdjson(res);
  }
  const json = await res.json().catch(() => null);
  return NextResponse.json(
    res.ok
      ? { ok: true, ...(json as Record<string, unknown>) }
      : {
          ok: false,
          ...(json as Record<string, unknown>),
          transient: res.status >= 500 || res.status === 429,
        },
    { status: res.status }
  );
}
