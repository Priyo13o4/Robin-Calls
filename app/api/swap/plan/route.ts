import { randomUUID } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { buildSwapPlan } from "@/lib/swap/plan";
import { createScanContext, runWithScanContext } from "@/lib/observability/context";
import { recordSwapPlanRun } from "@/lib/data/swap-plan-runs";
import { buildSwapRouteAnalytics, rpcMethodSummary } from "@/lib/swap/route-analytics";
import { cuCost } from "@/lib/rpc/cu-limiter";
import { readBoundedJson, validateSwapRequest } from "@/lib/swap/request-validation";
import type { SwapPlanDiagnostic, SwapPlanResponse } from "@/lib/swap/types";
import { refundRateLimit } from "@/lib/security/ratelimit";
import { clientIpFromHeaders } from "@/lib/security/client-ip";

/**
 * Maps swap plan response statuses to HTTP status codes.
 * Transport/config faults return 503, invalid requests return 400, and
 * domain answers (disabled, no-route, ready) return 200 (CLAUDE.md §4).
 */
export function httpStatusForPlan(status: SwapPlanResponse["status"]): number {
  switch (status) {
    case "invalid":
      return 400;
    case "config-unavailable":
      return 503;
    case "disabled":
    case "fee-unconfigured":
    case "unsupported-pair":
    case "no-route":
    case "quote-unavailable":
    case "ready":
      return 200;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/**
 * Safely schedules a background task after the response is sent.
 * Uses Next.js after() when running inside a request context, and falls back to
 * a detached promise in contexts without request store (e.g. unit tests).
 */
function safePostResponse(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task().catch(() => {
      console.error("[swap-plan-log] Failed to record swap plan run.");
    });
  }
}

/**
 * POST endpoint: Permit2 blobs belong in the body and results must never
 * be cached. Hardened with 64 KiB body bounds and runtime validation before planning.
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const startTime = Date.now();

  const bodyResult = await readBoundedJson(req);
  if (!bodyResult.ok) {
    return NextResponse.json(bodyResult.error, {
      status: 400,
      headers: { "Cache-Control": "no-store", "x-swap-request-id": requestId },
    });
  }

  const validation = validateSwapRequest(bodyResult.data);
  if (!validation.ok) {
    return NextResponse.json(validation.error, {
      status: 400,
      headers: { "Cache-Control": "no-store", "x-swap-request-id": requestId },
    });
  }

  let diagnostic: SwapPlanDiagnostic | null = null;
  let graphSearch: SwapPlanDiagnostic | null = null;
  // The scanner's per-request RPC record: every attempt, by provider, from both the swap
  // client and the pool. Stored on the plan run so a slow quote explains itself.
  const trace = createScanContext(requestId);
  trace.signal = req.signal;
  const result = await runWithScanContext(trace, () => buildSwapPlan(validation.value, {}, (diag) => {
    if (diag.code === "route_graph_search") graphSearch = diag;
    else diagnostic = diag;
  }));
  // A quote the user replaced while typing should not count against their 10 a minute.
  if (req.signal.aborted) void refundRateLimit("swapPlan", clientIpFromHeaders(req.headers) ?? "anon", 10);
  const rpcProviders = Object.entries(trace.rpc.providerCalls)
    .map(([id, c]) => `${id}:${c.n}${c.err ? `/${c.err}err` : ""}:${Math.round(c.ms)}ms`).join(",");
  const durationMs = Math.max(0, Date.now() - startTime);

  safePostResponse(async () => {
    try {
      await recordSwapPlanRun({
        requestId,
        account: validation.value.account.toLowerCase(),
        tokenIn: validation.value.tokenIn.toLowerCase(),
        tokenOut: validation.value.tokenOut.toLowerCase(),
        amountIn: validation.value.amountIn,
        status: result.status,
        stage: diagnostic?.stage ?? (result.status === "ready" ? "ready" : "routing"),
        // Its RPC stopped when the browser moved on, so its failure says nothing about the route.
        code: req.signal.aborted ? "client_aborted" : diagnostic?.code ?? result.status,
        durationMs,
        metadata: {
          ...buildSwapRouteAnalytics(result, diagnostic, graphSearch),
          rpcAttempts: trace.rpc.physicalAttempts,
          rpcProviders,
          ...rpcMethodSummary(trace.rpc.methodCounts, cuCost),
        },
      });
    } catch {
      console.error("[swap-plan-log] Failed to record swap plan run.");
    }
  });

  const status = httpStatusForPlan(result.status);
  return NextResponse.json(result, {
    status,
    // expiresAt is on this clock; the browser rebases it by this header (ui-state toLocalClock).
    headers: {
      "Cache-Control": "no-store",
      "x-server-time": String(Date.now()),
      "x-swap-request-id": requestId,
    },
  });
}
