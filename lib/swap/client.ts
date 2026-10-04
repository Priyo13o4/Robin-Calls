import type { SwapPlanResponse, SwapRequest } from "./types";
import { planResponseFromHttp, toLocalClock } from "./ui-state";
import { discoverClientPoolHints } from "./client-discovery";

export const SWAP_PLAN_TIMEOUT_MS = 45_000;

/** A plan request cancelled because a newer one replaced it. Callers drop it silently. */
export class SupersededPlanError extends Error {
  constructor() { super("Superseded by a newer quote request."); this.name = "SupersededPlanError"; }
}

export function isSupersededPlanError(error: unknown): boolean {
  return error instanceof SupersededPlanError;
}

// Last route served per direction, sent back as preferRoute so quotes do not flip routes (L213).
const PREFER_ROUTE_TTL_MS = 5 * 60_000;
let lastRoute: { pair: string; key: string; at: number } | null = null;
const pairOf = (req: SwapRequest) => `${req.tokenIn}>${req.tokenOut}`.toLowerCase();

export function withPreferredRoute(req: SwapRequest, now = Date.now()): SwapRequest {
  if (req.preferRoute || !lastRoute || lastRoute.pair !== pairOf(req) || now - lastRoute.at > PREFER_ROUTE_TTL_MS) return req;
  return { ...req, preferRoute: lastRoute.key };
}

export function rememberServedRoute(req: SwapRequest, res: SwapPlanResponse, now = Date.now()): void {
  if (res.status === "ready" && res.plan.routeKey) lastRoute = { pair: pairOf(req), key: res.plan.routeKey, at: now };
}

let inflightPlan: { key: string; promise: Promise<SwapPlanResponse>; controller: AbortController } | null = null;

/**
 * Client-side helper to request a real swap plan from /api/swap/plan.
 * At most one unsigned plan request is in flight: an identical request joins it,
 * a different one cancels it (latest wins). Signed permit steps are never cancelled.
 */
export function fetchSwapPlan(input: SwapRequest): Promise<SwapPlanResponse> {
  const req = withPreferredRoute(input);
  if (req.permit) return fetchSwapPlanOnce(req, new AbortController());
  const key = JSON.stringify([req.account, req.tokenIn, req.tokenOut, req.amountIn, req.slippageBps, req.poolHints ?? null, req.atomicBatch ?? false, req.preferRoute ?? null]).toLowerCase();
  if (inflightPlan?.key === key) return inflightPlan.promise;
  inflightPlan?.controller.abort(new SupersededPlanError());
  const controller = new AbortController();
  const entry = {
    key,
    controller,
    promise: fetchSwapPlanOnce(req, controller).finally(() => {
      if (inflightPlan === entry) inflightPlan = null;
    }),
  };
  inflightPlan = entry;
  return entry.promise;
}

async function fetchSwapPlanOnce(req: SwapRequest, controller: AbortController): Promise<SwapPlanResponse> {
  const timeout = globalThis.setTimeout(() => controller.abort(), SWAP_PLAN_TIMEOUT_MS);
  try {
    let request: SwapRequest = req;
    if (typeof window !== "undefined" && !req.poolHints?.length) {
      try {
        const poolHints = await discoverClientPoolHints(req.tokenIn, req.tokenOut, controller.signal);
        if (poolHints.length) request = { ...req, poolHints };
      } catch {
        // Optional discovery is best effort; the server retains its normal route search.
      }
    }
    const res = await fetch("/api/swap/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const localNowMs = Date.now();
    const serverTimeHeader = res.headers.get("x-server-time");
    const requestIdHeader = res.headers.get("x-swap-request-id");
    const data = await res.json().catch(() => null);
    const planRes = planResponseFromHttp(res.status, data);
    const clocked = toLocalClock(planRes, serverTimeHeader, localNowMs);
    if (requestIdHeader) {
      clocked.requestId = requestIdHeader;
    }
    rememberServedRoute(req, clocked);
    return clocked;
  } catch (error) {
    if (controller.signal.reason instanceof SupersededPlanError) throw controller.signal.reason;
    if (controller.signal.aborted) throw new Error("Swap quote timed out. Please try again.");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
