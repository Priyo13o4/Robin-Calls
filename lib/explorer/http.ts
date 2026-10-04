import { createHash } from "node:crypto";
import { OUTBOUND_USER_AGENT } from "../config/user-agent";
import {
  currentExplorerMemo,
  emitProgress,
  explorerFaulted,
  recordExplorerCall,
  recordExplorerDedupe,
  recordProviderState,
} from "../observability/context";
import { explorerApiUrl } from "../config/chain";
import { reportError } from "../observability/reporter";
import { planExplorerRetry } from "./retry";
import { withExplorerSlot } from "./gate";
import { recordSequencerExplorerSpend, recordSequencerMetric } from "@/lib/data/sequencer";

export class ExplorerFault extends Error {
  constructor(message: string, public domain: "scoring" | "shadow-audit" = "scoring") {
    super(message);
    this.name = "ExplorerFault";
  }
}

/** Same scheme+host+port. Unparseable input is treated as foreign, not trusted. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/**
 * Every PRO credential we hold, in rotation order.
 *
 * `EXPLORER_API_KEYS` (comma-separated) wins; `EXPLORER_API_KEY` remains the
 * single-key form and stays valid on its own. Read per call so a key can be
 * added or pulled without a restart.
 *
 * Pooling works because Blockscout meters PER KEY, not per IP — measured
 * 2026-08-17: two keys bursting concurrently from one IP served 16 of 20
 * requests where a single key served 5 of 10, each keeping its own bucket.
 * Keys on separate ACCOUNTS also get separate daily credit pools.
 */
function apiKeys(): string[] {
  const many = process.env.EXPLORER_API_KEYS;
  if (many) {
    const keys = many.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length) return keys;
  }
  const one = process.env.EXPLORER_API_KEY;
  return one ? [one] : [];
}

let keyCursor = 0;

/** Test seam: rotation is process state, so cases must not inherit each other's. */
export function resetApiKeyRotationForTests(): void {
  keyCursor = 0;
}

/**
 * Attach a Blockscout PRO credential (api.blockscout.com's multichain gateway —
 * a different product from the per-instance keys documented for self-hosted
 * deployments). Unkeyed requests to that host get 402, not a lower rate limit.
 * With no key configured this is a no-op, same as before it existed.
 */
export function withApiKey(url: string): string {
  const keys = apiKeys();
  if (!keys.length) return url;
  // Scoped to the HOST the key was issued for — by origin, never by path
  // prefix. The verified-source fallback (lib/config/chain.ts) sends the same
  // paths to the community instance, and an unscoped append would put our PRO
  // credential in a query string on a third-party host (§6).
  //
  // Origin, because `explorerApiUrl` ends in `/api/v2` while `v1Base()` strips
  // that suffix: a `startsWith(explorerApiUrl)` test silently de-authenticated
  // every v1 call — `module=logs&action=getLogs` is 94.8% of our credit spend,
  // and unkeyed requests get 402, which the pipeline reads as
  // RC_EXPLORER_UNAVAILABLE and refuses to publish a verdict. Shipped and
  // caught in prod the same hour, 2026-08-17.
  if (!sameOrigin(url, explorerApiUrl)) return url;
  // Round-robin, advanced only when a key is actually attached — rotating on
  // calls to other hosts would skew the split and leave one key doing most of
  // the work, which is the whole point of holding two.
  const key = keys[keyCursor % keys.length];
  keyCursor = (keyCursor + 1) % keys.length;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}apikey=${encodeURIComponent(key)}`;
}

/**
 * Robinscan's Partner API authenticates by HEADER — `x-api-key`. Its docs state
 * that bearer auth and query-string keys are NOT supported, so `withApiKey`
 * above (which appends `?apikey=`) cannot serve it and this is a second
 * mechanism rather than a parameter on the first.
 *
 * Scoped to the configured robinscan origin, for the same reason the query form
 * is scoped to Blockscout's: a credential must never be attached to a host it
 * was not issued for (§6). With no key configured this returns no headers and
 * behaves exactly as before it existed.
 *
 * Timing: the public `robinscan.io/api` still answers unauthenticated today
 * (probed 2026-08-26, HTTP 200), but their changelog has all `/api/*` routes
 * moving behind `x-api-key`. When that lands, an unkeyed deployment loses
 * robinscan entirely — which would take the holder union (L46) and the only
 * failover for Blockscout's background 500s with it. Wiring is cheap now and an
 * outage later.
 */
export function authHeaders(url: string): Record<string, string> {
  const key = process.env.EXPLORER_ROBINSCAN_API_KEY;
  if (!key) return {};
  const base = process.env.EXPLORER_ROBINSCAN_URL || "https://robinscan.io/api";
  if (!sameOrigin(url, base)) return {};
  return { "x-api-key": key };
}

/**
 * The Etherscan-compatible endpoint, which lives at `/api` beside the v2 REST
 * base the rest of the explorer client uses. Two callers need it — the log
 * index and the ascending transaction window — and both are here rather than
 * each deriving the same regex.
 */
export function v1Base(): string {
  return explorerApiUrl.replace(/\/v2\/?$/, "");
}

export function classify(status: number): { state: string; code: "RC_EXPLORER_UNAVAILABLE" | null } {
  if (status === 404) return { state: "NOT_FOUND", code: null };
  if (status === 429) return { state: "RATE_LIMITED", code: "RC_EXPLORER_UNAVAILABLE" };
  return { state: "ERROR", code: "RC_EXPLORER_UNAVAILABLE" };
}

export function endpointOf(path: string): string {
  const [route, query = ""] = path.split("?");
  // The v1 Etherscan-compatible API puts the whole route in the query string, so
  // `route` is empty and every such call would otherwise be filed under "" —
  // silently pooling unrelated endpoints in scan_runs.explorer_endpoint_counts
  // and in providerStates, which is the one thing those columns exist to prevent.
  // Name it the way lib/explorer/logs.ts already labels its own v1 calls.
  if (!route) {
    const params = new URLSearchParams(query);
    const mod = params.get("module");
    const action = params.get("action");
    if (mod) return `/api?module=${mod}${action ? `&action=${action}` : ""}`;
    return "/api";
  }
  return route.replace(/0x[0-9a-fA-F]{40,64}/g, ":id").replace(/\/\d+/g, "/:n");
}

export interface ExplorerHttpOpts {
  domain?: "scoring" | "shadow-audit";
}

export type ExplorerAccountingDeps = {
  spend: typeof recordSequencerExplorerSpend;
  metric: typeof recordSequencerMetric;
};
const explorerAccountingDeps: ExplorerAccountingDeps = { spend: recordSequencerExplorerSpend, metric: recordSequencerMetric };

/** Credit rates measured from Blockscout PRO's dashboard. Unknown actions use the conservative default. */
export function blockscoutCreditsForUrl(rawUrl: string): number {
  try {
    const url = new URL(rawUrl);
    const action = (url.searchParams.get("action") ?? "").toLowerCase();
    const route = url.pathname.toLowerCase();
    if (action.includes("internal") || /\/internal[-_]transactions(?:\/|$)/.test(route)) return 40;
    if (action === "getlogs") return 20;
    if (action === "gettxinfo" || /\/transactions\/[^/]+$/.test(route)) return 20;
    if (/(^|\/)logs(?:\/|$)/.test(route)) return 30;
    return 20;
  } catch { return 20; }
}

/** One observation per actual wire attempt. Hashes the attached key before crossing into persistence. */
export async function accountBlockscoutHttpAttempt(input: {
  requestUrl: string;
  adapterId: string;
  domain: "scoring" | "shadow-audit";
  endpoint: string;
  outcome: string;
  latencyMs: number;
}, deps: ExplorerAccountingDeps = explorerAccountingDeps): Promise<void> {
  let url: URL;
  try { url = new URL(input.requestUrl); } catch { return; }
  if (!input.adapterId.toLowerCase().includes("blockscout") || !sameOrigin(url.toString(), explorerApiUrl)) return;
  const apiKey = url.searchParams.get("apikey");
  // Calls to the community host or unauthenticated setup probes do not consume a configured PRO account's credits.
  if (!apiKey) return;
  const accountId = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  const credits = blockscoutCreditsForUrl(input.requestUrl);
  const reason = `${input.domain}:${input.adapterId}:${endpointOf(input.endpoint)}`.slice(0, 120);
  await Promise.allSettled([
    Promise.resolve().then(() => deps.spend(accountId, credits)),
    Promise.resolve().then(() => deps.metric({ provider: "blockscout", event: input.outcome, reason, count: 1, credits, latencyMs: Math.max(0, Math.trunc(input.latencyMs)) })),
  ]);
}

/**
 * Identical explorer GETs currently in flight, process-wide, keyed by request.
 *
 * A scan issues the same read from several independent checks (an address's
 * info, a token's holders), and at ~3.5s per call on the PRO gateway with only
 * 3 concurrency slots, a duplicate is not just wasted work — it evicts a
 * different call from the queue. Bounded by construction: an entry is added
 * immediately before the request and removed in its `finally`.
 *
 * Deliberately NOT a result cache. It holds in-flight promises only, so a
 * joiner gets the answer from the same instant; nothing survives settling. The
 * per-scan reuse of a completed response is the memo on ScanRunContext, which
 * dies with the scan. Neither ever persists a fault.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Shared HTTP machinery for explorer adapters, preserving the retry, timeout,
 * circuit-breaker-adjacent fault classification, and observability calls.
 *
 * Deduped two ways before any request is made — see `inFlight` and
 * `explorerMemo`. Both are keyed on the full request, so they can only ever
 * return the answer to the question that was asked.
 */
export async function explorerFetch<T>(
  adapterId: string,
  baseUrl: string,
  path: string,
  opts?: ExplorerHttpOpts
): Promise<T | null> {
  const domain = opts?.domain ?? "scoring";

  if (explorerFaulted()) return null;

  // Domain is part of the key: a shadow-audit read and a scoring read of the
  // same path are separately classified and separately reported, so they must
  // not satisfy one another.
  const key = `${domain}\u0000${baseUrl}${path}`;

  const memo = currentExplorerMemo();
  if (memo?.has(key)) {
    recordExplorerDedupe();
    return memo.get(key) as T | null;
  }

  const joined = inFlight.get(key);
  if (joined) {
    recordExplorerDedupe();
    // A rejection propagates to joiners, which is correct — they would have
    // failed too. What must not happen is a FAULT being stored and replayed,
    // and nothing below stores one.
    return (await joined) as T | null;
  }

  const request = fetchOnce<T>(adapterId, baseUrl, path, domain, opts);
  inFlight.set(key, request);
  try {
    const result = await request;
    memo?.set(key, result);
    return result;
  } finally {
    // Identity-checked so a newer request for the same key is never evicted.
    if (inFlight.get(key) === request) inFlight.delete(key);
  }
}

async function fetchOnce<T>(
  adapterId: string,
  baseUrl: string,
  path: string,
  domain: "scoring" | "shadow-audit",
  opts?: ExplorerHttpOpts
): Promise<T | null> {
  const prefix = domain === "shadow-audit" ? `explorer-shadow:${adapterId}` : `explorer:${adapterId}`;
  const endpoint = endpointOf(path);
  const startedAt = Date.now();
  // Captured from the gate so the finally can bill queue and wire time apart;
  // stays 0 if we never got a slot (the throw path), which is correct — nothing
  // was spent upstream.
  let queuedMs = 0;

  try {
    return await withExplorerSlot(async (queued) => {
      queuedMs = queued;
      for (let attempt = 1; ; attempt++) {
        try {
          const requestUrl = withApiKey(`${baseUrl}${path}`);
          const attemptStartedAt = Date.now();
          let res: Response;
          try {
            res = await fetch(requestUrl, {
              headers: {
                accept: "application/json",
                // Cloudflare 403s a missing/non-browser-shaped UA on the community
                // instance, which is our verified-source fallback (L95).
                "user-agent": OUTBOUND_USER_AGENT,
                ...authHeaders(requestUrl),
              },
              cache: "no-store",
              signal: AbortSignal.timeout(15_000),
            });
          } catch (error) {
            await accountBlockscoutHttpAttempt({ requestUrl, adapterId, domain, endpoint, outcome: "transport_error", latencyMs: Date.now() - attemptStartedAt });
            throw error;
          }
          await accountBlockscoutHttpAttempt({ requestUrl, adapterId, domain, endpoint, outcome: `http_${res.status}`, latencyMs: Date.now() - attemptStartedAt });
          if (!res.ok) {
            const plan = planExplorerRetry({
              status: res.status,
              attempt,
              retryAfter: res.headers.get("retry-after"),
              nowMs: Date.now(),
            });
            if (plan.retry) {
              emitProgress({ type: "retry", source: "explorer", detail: `retrying explorer ${adapterId} (${endpoint})` });
              await new Promise((r) => setTimeout(r, plan.delayMs));
              continue;
            }
            const { state, code } = classify(res.status);
            recordProviderState(`${prefix}:${endpoint}`, state);
            if (state === "NOT_FOUND") {
              return null; // 404 is a domain answer
            }

            if (code) {
              const elapsedMs = Date.now() - startedAt;
              // `providerId` structured (not just embedded in `operation` text) so
              // the admin Logs panel can filter/group by it directly — before this,
              // every explorer fault row had `provider_id: null` regardless of
              // which host answered. `baseUrl`, never `requestUrl`: the latter
              // carries the PRO `apikey` query param (§6 — never log secrets).
              await reportError({
                code,
                message: `explorer ${adapterId} ${endpoint} returned ${res.status} after ${attempt} attempt${attempt > 1 ? "s" : ""} (${elapsedMs}ms elapsed, ${queuedMs}ms queued)`,
                operation: `explorer.${adapterId}.get ${endpoint}`,
                providerId: adapterId,
                httpStatus: res.status,
                requestOutcome: "degraded",
                details: {
                  baseUrl,
                  attempt,
                  elapsedMs,
                  queuedMs,
                  retryAfter: res.headers.get("retry-after"),
                },
              });
            }
            throw new ExplorerFault(`HTTP ${res.status}`, opts?.domain || "scoring");
          }
          recordProviderState(`${prefix}:${endpoint}`, "OK");
          return (await res.json()) as T;
        } catch (error) {
          if (error instanceof ExplorerFault) throw error;

          const plan = planExplorerRetry({ status: undefined, attempt, nowMs: Date.now() });
          if (plan.retry) {
            emitProgress({ type: "retry", source: "explorer", detail: `retrying explorer ${adapterId} (${endpoint})` });
            await new Promise((r) => setTimeout(r, plan.delayMs));
            continue;
          }
          const timeout = error instanceof Error && error.name === "TimeoutError";
          const elapsedMs = Date.now() - startedAt;
          recordProviderState(`${prefix}:${endpoint}`, timeout ? "TIMEOUT" : "ERROR");
          await reportError({
            code: "RC_EXPLORER_UNAVAILABLE",
            message: `explorer ${adapterId} ${endpoint} ${timeout ? "timed out" : "was unreachable"} after ${attempt} attempt${attempt > 1 ? "s" : ""} (${elapsedMs}ms elapsed, ${queuedMs}ms queued)`,
            operation: `explorer.${adapterId}.get ${endpoint}`,
            error,
            providerId: adapterId,
            requestOutcome: "degraded",
            details: {
              baseUrl,
              attempt,
              elapsedMs,
              queuedMs,
              timeout,
              // Distinguishes a hard 15s AbortSignal timeout from any other
              // thrown-before-response fault (DNS, socket reset, etc.) — both
              // classify as "network" in retry.ts, but they are different
              // incidents and were previously indistinguishable in this log.
              errorName: error instanceof Error ? error.name : typeof error,
            },
          });
          throw new ExplorerFault("Network or timeout error");
        }
      }
    });
  } finally {
    recordExplorerCall(endpoint, queuedMs, Date.now() - startedAt - queuedMs);
  }
}
