import { createPublicClient, http } from "viem";
import { isSplittableRangeError } from "./provider-pool";
import { recordRpcAttempt } from "../observability/context";

export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

let memoizedPublicClient: ReturnType<typeof createPublicClient> | null = null;

const HISTORY_RPC_START_INTERVAL_MS = 500;
const HISTORY_RPC_MAX_ACTIVE = 2;
type Admission = { signal?: AbortSignal; resolve(release: () => void): void; reject(error: Error): void; abort?: () => void };
const historyAdmissions: Admission[] = [];
let historyActive = 0;
let historyLastStart = 0;
let historyAdmissionTimer: ReturnType<typeof setTimeout> | undefined;

function pumpHistoryAdmissions() {
  if (historyAdmissionTimer) {
    clearTimeout(historyAdmissionTimer);
    historyAdmissionTimer = undefined;
  }
  while (historyAdmissions[0]?.signal?.aborted) {
    const expired = historyAdmissions.shift()!;
    expired.signal?.removeEventListener("abort", expired.abort!);
    expired.reject(new Error("public history request deadline expired while waiting for RPC admission"));
  }
  if (!historyAdmissions.length || historyActive >= HISTORY_RPC_MAX_ACTIVE) return;
  const delayMs = Math.max(0, historyLastStart + HISTORY_RPC_START_INTERVAL_MS - Date.now());
  if (delayMs > 0) {
    historyAdmissionTimer = setTimeout(pumpHistoryAdmissions, delayMs);
    return;
  }
  const next = historyAdmissions.shift()!;
  next.signal?.removeEventListener("abort", next.abort!);
  historyActive++;
  historyLastStart = Date.now();
  let released = false;
  next.resolve(() => {
    if (released) return;
    released = true;
    historyActive = Math.max(0, historyActive - 1);
    pumpHistoryAdmissions();
  });
  pumpHistoryAdmissions();
}

function admitHistoryRpc(signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const entry: Admission = { signal, resolve, reject };
    if (signal?.aborted) {
      reject(new Error("public history request deadline expired before RPC admission"));
      return;
    }
    entry.abort = () => {
      const index = historyAdmissions.indexOf(entry);
      if (index >= 0) {
        historyAdmissions.splice(index, 1);
        reject(new Error("public history request deadline expired while waiting for RPC admission"));
        pumpHistoryAdmissions();
      }
    };
    signal?.addEventListener("abort", entry.abort, { once: true });
    historyAdmissions.push(entry);
    pumpHistoryAdmissions();
  });
}

export function publicRpcClient() {
  if (!memoizedPublicClient) {
    memoizedPublicClient = createPublicClient({
      transport: http(PUBLIC_RPC, { timeout: 30_000, retryCount: 0 }),
    });
  }
  return memoizedPublicClient;
}

/** A separate public client whose transport aborts within the caller's remaining deadline. */
export function publicRpcClientWithTimeout(timeoutMs: number) {
  return createPublicClient({
    transport: http(PUBLIC_RPC, {
      timeout: Math.max(1, Math.min(30_000, Math.floor(timeoutMs))),
      retryCount: 0,
      fetchFn: async (input, init) => {
        const started = Date.now();
        let method = "eth_unknown";
        try {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) as { method?: unknown } : null;
          if (typeof body?.method === "string") method = body.method;
        } catch { /* The response still counts as a physical transport attempt. */ }
        const release = await admitHistoryRpc(init?.signal ?? undefined);
        try {
          const response = await fetch(input, init);
          recordRpcAttempt({ method, providerId: "public-history", latencyMs: Date.now() - started, outcome: response.ok ? "ok" : "transport-error" });
          return response;
        } catch (error) {
          recordRpcAttempt({ method, providerId: "public-history", latencyMs: Date.now() - started, outcome: "transport-error" });
          throw error;
        } finally {
          release();
        }
      },
    }),
  });
}


export function isTooManyLogsError(error: unknown): boolean {
  if (isSplittableRangeError(error)) return true;
  const TOO_MANY = /exceeds limit|too large|response size|ResponseBodyTooLarge|log query timed out/i;
  let cursor: unknown = error;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as { message?: string; name?: string; cause?: unknown };
    if (typeof e.message === "string" && TOO_MANY.test(e.message)) return true;
    if (typeof e.name === "string" && TOO_MANY.test(e.name)) return true;
    cursor = e.cause;
  }
  return false;
}

export function isRateLimitError(error: unknown): boolean {
  const RATE_LIMIT = /too many requests|rate limit/i;
  let cursor: unknown = error;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as { message?: string; status?: number; statusCode?: number; code?: unknown; cause?: unknown };
    if (e.status === 429 || e.statusCode === 429 || e.code === 429) return true;
    if (typeof e.message === "string" && (RATE_LIMIT.test(e.message) || /\b429\b/.test(e.message))) return true;
    cursor = e.cause;
  }
  return false;
}

export interface AdaptiveWalkOptions<Row> {
  from: number;
  to: number;
  fetch(from: number, to: number): Promise<Row[]>;
  targetLogs: number;
  minWindow: number;
  maxWindow: number;
  initialWindow: number;
  deadlineMs?: number;
  now?: () => number;
  /** Called after each window succeeds, in block order. Throwing aborts the walk. */
  onWindow?(rows: Row[], from: number, to: number): Promise<void>;
}

export type AdaptiveWalkResult<Row> = {
  rows: Row[];
  next: number;
  calls: number;
  stopped: null | "budget" | "rate-limited" | "window-floor";
};

export async function adaptiveLogWalk<Row>(o: AdaptiveWalkOptions<Row>): Promise<AdaptiveWalkResult<Row>> {
  const now = o.now ?? (() => Date.now());
  const start = now();
  let next = o.from;
  let window = Math.min(o.maxWindow, Math.max(o.minWindow, o.initialWindow));
  let calls = 0;
  const rows: Row[] = [];
  let stopped: AdaptiveWalkResult<Row>["stopped"] = null;

  while (next <= o.to) {
    if (o.deadlineMs !== undefined && now() - start >= o.deadlineMs) {
      stopped = "budget";
      break;
    }

    const to = Math.min(o.to, next + window - 1);
    calls++;
    let fetchedRows: Row[];

    try {
      fetchedRows = await o.fetch(next, to);
    } catch (err) {
      if (isRateLimitError(err)) {
        stopped = "rate-limited";
        break;
      }
      if (isTooManyLogsError(err)) {
        if (window <= o.minWindow) {
          stopped = "window-floor";
          break;
        }
        window = Math.max(o.minWindow, Math.floor(window / 2));
        continue;
      }
      throw err;
    }

    if (o.onWindow) {
      await o.onWindow(fetchedRows, next, to);
    }
    rows.push(...fetchedRows);
    next = to + 1;

    const calculated = Math.floor((window * o.targetLogs) / Math.max(fetchedRows.length, 1));
    const capped = Math.min(calculated, window * 4);
    window = Math.min(o.maxWindow, Math.max(o.minWindow, capped));
  }

  return {
    rows,
    next,
    calls,
    stopped,
  };
}
