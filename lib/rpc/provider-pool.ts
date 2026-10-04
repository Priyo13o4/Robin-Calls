import { http, type Transport } from "viem";
import { robinhoodChain, ROBINHOOD_CHAIN_ID } from "../config/chain";
import {
  currentScanContext,
  emitProgress,
  recordProviderState,
  recordRpcAttempt,
  type RpcOutcome,
} from "../observability/context";
import { reportError } from "../observability/reporter";
import { circuitAllows, providerGate, type AdmissionDenial } from "./admission";
import { cuLimiter } from "./cu-limiter";
import {
  configuredEndpoints,
  configuredSwapEndpoints,
  refreshRpcEndpoints,
  resetRpcEndpointsForTests,
  rpcEndpointGeneration,
} from "../config/rpc-endpoints";

/**
 * Ordered RPC provider pool (PRD §11.1, §11.3, §11.4).
 *
 * - `RPC_ENDPOINTS_JSON` is the source of truth; the legacy
 *   `ROBINHOOD_RPC_URL` / `ROBINHOOD_RPC_FALLBACK_URL` pair is translated into
 *   a pool when it is absent (and is deprecated).
 * - Each provider has an independent CLOSED/OPEN/HALF_OPEN circuit. Failover
 *   is sequential — never speculative-parallel — and only for transport-class
 *   faults. Deterministic EVM results (execution reverted, bad params,
 *   missing method) are chain facts: they are thrown immediately and never
 *   replayed against the next provider (§11.3). A splittable
 *   `eth_getLogs`-range/result-cap refusal (`isSplittableRangeError`) is its
 *   own third outcome, distinct from both: the provider is healthy, so it
 *   never opens a circuit, but it isn't a chain fact either, so it isn't
 *   cached/retried like a revert — it just propagates for the caller to
 *   subdivide (§M15 — this is the direct fix for one background job's
 *   oversized-range errors opening the circuit for every interactive scan).
 * - Inside a scan context the remaining `RPC_SCAN_DEADLINE_MS` bounds every
 *   attempt, so a long provider list cannot multiply the route timeout.
 * - Wrong-chain endpoints are disabled after a one-time `eth_chainId` probe.
 * - Provider order composes method preference with the in-process
 *   least-inflight scheduler (`lib/rpc/scheduler.ts`), and a provider's
 *   configured `maxConcurrentRequests` is enforced for real: at its ceiling,
 *   `poolRequest` skips to the next eligible provider instead of queueing
 *   (§M15). This is single-instance enforcement only — see scheduler.ts's
 *   module doc for what's still not covered here.
 *
 * Circuit state is per serverless instance. Cross-instance circuit sharing
 * belongs to the §11.2 throughput scheduler, which is only required before
 * SCAN_GLOBAL_MAX_CONCURRENT is raised above 1 — until then the Upstash
 * concurrency gate already serializes pipeline load globally.
 */

/**
 * What an endpoint is CAPABLE of, as opposed to what it PREFERS (`preferMethods`
 * is a soft ordering hint; this is a hard routing constraint). A request the
 * descriptor forbids is never sent to this provider — it is filtered out before
 * ranking, so an incapacity becomes a routing rule instead of a runtime error
 * the circuit breaker then misreads as a fault.
 *
 * The motivating case: Alchemy's free tier serves eth_getLogs only up to a
 * 10-block range and Goldsky Edge only up to 20,000 (`toBlock − fromBlock ≤
 * 19,999`). Declaring `maxLogSpan` routes a wide log read away from them
 * automatically, rather than paying a guaranteed rejection and opening their
 * breaker on a request no retry could satisfy.
 */
export interface ProviderCapabilities {
  /**
   * Largest `toBlock − fromBlock` this endpoint will serve for `eth_getLogs`.
   * Omit for an unbounded provider (this chain's own public RPC). A read wider
   * than this is routed to a capable provider; if none can serve it, the pool
   * raises a splittable-range signal so the caller subdivides (see poolRequest).
   */
  maxLogSpan?: number;
  /** Methods this endpoint cannot serve at all — routed away pre-flight. */
  denyMethods?: string[];
  /** If set, the ONLY methods this endpoint serves; everything else is routed away. */
  allowMethods?: string[];
}

export interface ProviderEndpoint {
  /** Stable, non-secret identifier used in evidence and logs. */
  id: string;
  url: string;
  maxCuPerSecond?: number;
  maxRequestsPerSecond?: number;
  maxConcurrentRequests?: number;
  /**
   * JSON-RPC methods this endpoint should serve FIRST, jumping the pool order
   * (audit HIGH-2). The chain's public RPC serves unbounded eth_getLogs that
   * Alchemy range-caps and 429s, so `"preferMethods": ["eth_getLogs"]` on the
   * public entry routes log indexing there while eth_call stays on the paid
   * primary. Ordering only — failover across the rest of the pool is unchanged.
   */
  preferMethods?: string[];
  /** Hard routing constraints (§11.2 capability router) — see the type doc. */
  capabilities?: ProviderCapabilities;
  /** rpc_endpoints.pool = 'swap': served to `poolRequest(args, "swap")` only, ahead of the shared pool. */
  swapOnly?: boolean;
}

interface PoolConfig {
  requestTimeoutMs: number;
  scanDeadlineMs: number;
  circuitFailureThreshold: number;
  circuitOpenSeconds: number;
  recoveryProbeSeconds: number;
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function poolConfig(): PoolConfig {
  return {
    requestTimeoutMs: intEnv("RPC_REQUEST_TIMEOUT_MS", 12_000),
    // 60s floor (was 45s): tokens with a deep pool plus a wide V4 fee-tier fan-out
    // (SWOGE: V3 + 35 V4 pools) legitimately need >45s to index every custody
    // read. Deepest-pool-first ordering (checkLpCustody §15.10c) means the
    // price-backing pool completes well inside this even under pressure; the
    // headroom is for the long tail of surplus pools, not the verdict-critical one.
    scanDeadlineMs: intEnv("RPC_SCAN_DEADLINE_MS", 60_000),
    circuitFailureThreshold: intEnv("RPC_CIRCUIT_FAILURE_THRESHOLD", 5),
    circuitOpenSeconds: intEnv("RPC_CIRCUIT_OPEN_SECONDS", 60),
    recoveryProbeSeconds: intEnv("RPC_RECOVERY_PROBE_SECONDS", 30),
  };
}

const DEFAULT_PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";

/** Non-secret provider identity when config gives none: hostname only. */
function providerIdFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

/**
 * Parse and validate the configured endpoint list (§11.1). Throws on a
 * malformed `RPC_ENDPOINTS_JSON` — a misconfigured pool must fail loudly,
 * not silently scan through the wrong infrastructure.
 */
export function parseEndpointConfig(
  env: Record<string, string | undefined>
): ProviderEndpoint[] {
  const raw = env.RPC_ENDPOINTS_JSON?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("RPC_ENDPOINTS_JSON is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("RPC_ENDPOINTS_JSON must be a non-empty JSON array");
    }
    const seen = new Set<string>();
    return parsed.map((entry, index) => {
      const e = entry as Partial<ProviderEndpoint>;
      if (typeof e.id !== "string" || e.id.trim() === "") {
        throw new Error(`RPC_ENDPOINTS_JSON[${index}] is missing a stable "id"`);
      }
      if (seen.has(e.id)) {
        throw new Error(`RPC_ENDPOINTS_JSON has duplicate provider id "${e.id}"`);
      }
      seen.add(e.id);
      if (typeof e.url !== "string" || !/^https?:\/\//.test(e.url)) {
        throw new Error(`RPC_ENDPOINTS_JSON["${e.id}"] needs an http(s) url`);
      }
      if (
        e.preferMethods !== undefined &&
        (!Array.isArray(e.preferMethods) || e.preferMethods.some((m) => typeof m !== "string"))
      ) {
        throw new Error(`RPC_ENDPOINTS_JSON["${e.id}"].preferMethods must be an array of method names`);
      }
      const capabilities = validateCapabilities(e.id, e.capabilities);
      return {
        id: e.id,
        url: e.url,
        maxCuPerSecond: e.maxCuPerSecond,
        maxRequestsPerSecond: e.maxRequestsPerSecond,
        maxConcurrentRequests: e.maxConcurrentRequests,
        preferMethods: e.preferMethods,
        capabilities,
      };
    });
  }

  // Legacy translation (§11.1) — deprecated once RPC_ENDPOINTS_JSON is set.
  const primary = env.ROBINHOOD_RPC_URL ?? DEFAULT_PUBLIC_RPC;
  const endpoints: ProviderEndpoint[] = [{ id: providerIdFor(primary), url: primary }];
  if (env.ROBINHOOD_RPC_FALLBACK_URL) {
    endpoints.push({
      id: providerIdFor(env.ROBINHOOD_RPC_FALLBACK_URL),
      url: env.ROBINHOOD_RPC_FALLBACK_URL,
    });
  }
  return endpoints;
}

/**
 * Validate a raw `capabilities` block from config, throwing on malformed input
 * (same fail-loud policy as the rest of `parseEndpointConfig` — a misdeclared
 * capability would silently route traffic the wrong way).
 */
function validateCapabilities(
  id: string,
  raw: unknown,
): ProviderCapabilities | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`RPC_ENDPOINTS_JSON["${id}"].capabilities must be an object`);
  }
  const c = raw as Partial<ProviderCapabilities>;
  if (
    c.maxLogSpan !== undefined &&
    (typeof c.maxLogSpan !== "number" || !Number.isInteger(c.maxLogSpan) || c.maxLogSpan <= 0)
  ) {
    throw new Error(`RPC_ENDPOINTS_JSON["${id}"].capabilities.maxLogSpan must be a positive integer`);
  }
  for (const key of ["denyMethods", "allowMethods"] as const) {
    const v = c[key];
    if (v !== undefined && (!Array.isArray(v) || v.some((m) => typeof m !== "string"))) {
      throw new Error(`RPC_ENDPOINTS_JSON["${id}"].capabilities.${key} must be an array of method names`);
    }
  }
  return {
    maxLogSpan: c.maxLogSpan,
    denyMethods: c.denyMethods,
    allowMethods: c.allowMethods,
  };
}

/** Parse a block tag/quantity to a number, or null for a symbolic tag. */
function blockParamToNumber(v: unknown): bigint | null {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string") {
    if (/^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
    if (/^\d+$/.test(v)) return BigInt(v);
  }
  return null; // "latest" / "earliest" / "pending" / "safe" / "finalized"
}

/**
 * The `toBlock − fromBlock` span of an `eth_getLogs` params array, or null when
 * it can't be bounded (a symbolic tag, a filterId call, a malformed shape). A
 * null span is deliberately NOT filtered against `maxLogSpan`: we only route
 * away a read we can PROVE is too wide; an unbounded one is left to try and, if
 * refused, to the splittable-range path.
 */
export function logSpanOf(params: unknown): number | null {
  const first = Array.isArray(params) ? params[0] : undefined;
  if (!first || typeof first !== "object") return null;
  const f = first as { fromBlock?: unknown; toBlock?: unknown };
  const from = blockParamToNumber(f.fromBlock);
  const to = blockParamToNumber(f.toBlock);
  if (from === null || to === null) return null;
  return Number(to - from);
}

/**
 * Does this `eth_getLogs` pin at least one topic beyond `topic0`?
 *
 * A node's cost for a log read is driven by index selectivity, not raw block
 * width: pinning an indexed argument turns a scan into a lookup. Measured
 * 2026-08-25 — this chain's public node answers a 45.8M-block query filtered to
 * one contract + one event + one indexed currency in about a second, while
 * declaring a 10,000-block cap. The cap describes UNSELECTIVE reads.
 *
 * `topics[0]` alone does not count: an event type with no argument pinned still
 * matches every emission chain-wide, which is exactly the wide read the cap is
 * for. An array member (topic OR) still pins the position, so it counts.
 */
export function logQueryIsSelective(params: unknown): boolean {
  const first = Array.isArray(params) ? params[0] : undefined;
  if (!first || typeof first !== "object") return false;
  const topics = (first as { topics?: unknown }).topics;
  if (!Array.isArray(topics)) return false;
  return topics.slice(1).some((t) => t !== null && t !== undefined);
}

/**
 * Narrow a relaxed (selectivity-admitted) oversized log read to the providers
 * with the WIDEST declared window.
 *
 * `logQueryIsSelective` stops a precise query being refused for its width, but
 * admission is not preference: it put every capped provider back in the pool,
 * including the one declaring a 10-block window, which then sorts first and
 * takes a 45.8M-block read it cannot serve. Measured in the smoke stack
 * 2026-08-25 — two consecutive scans of the same token, one recovering the real
 * pool and one falling back to a 90%-fee decoy, purely on which provider caught
 * the lookup.
 *
 * An undeclared cap counts as widest: it is the absence of a limit, not a small
 * one. Returns the input untouched unless it can actually discriminate.
 */
export function preferWidestLogSpan<T extends { endpoint: ProviderEndpoint }>(
  candidates: readonly T[],
): readonly T[] {
  if (candidates.length < 2) return candidates;
  const spanOf = (c: T) => c.endpoint.capabilities?.maxLogSpan ?? Number.POSITIVE_INFINITY;
  const widest = Math.max(...candidates.map(spanOf));
  const kept = candidates.filter((c) => spanOf(c) === widest);
  return kept.length > 0 ? kept : candidates;
}

/** Does this endpoint's capability descriptor permit `method` at all? */
export function providerServesMethod(
  cap: ProviderCapabilities | undefined,
  method: string,
): boolean {
  if (!cap) return true;
  if (cap.allowMethods && !cap.allowMethods.includes(method)) return false;
  if (cap.denyMethods?.includes(method)) return false;
  return true;
}

/**
 * Full capability check for one concrete (method, params): the method must be
 * permitted, and for eth_getLogs a provably-oversized range against a declared
 * `maxLogSpan` excludes the provider.
 */
export function providerServes(
  endpoint: ProviderEndpoint,
  method: string,
  params: unknown,
): boolean {
  const cap = endpoint.capabilities;
  if (!providerServesMethod(cap, method)) return false;
  if (method === "eth_getLogs" && cap?.maxLogSpan !== undefined) {
    const span = logSpanOf(params);
    // A selective read is not PROVABLY too wide, and this filter's own contract
    // (see `logSpanOf`) is to route away only what we can prove. Excluding every
    // provider from a one-second lookup because the block range is large is how
    // a pool's recipe became unreadable while the node held it (L45).
    if (span !== null && span > cap.maxLogSpan && !logQueryIsSelective(params)) {
      return false;
    }
  }
  return true;
}

/**
 * The widest `eth_getLogs` window worth STARTING a walk at, given what the pool
 * declares it can serve. Null means "no useful bound" — some capable provider
 * declares no cap, so a single full-range read is the right first attempt.
 *
 * WHY THIS EXISTS. `walkLogRange` used to begin at the caller's full range and
 * discover the cap by being refused, halving until something fit. That is
 * wasteful in the obvious way (a 5.2M-block top-up spent 511 guaranteed-refusal
 * round trips before its first useful read) and broken in a subtler one: the
 * leaf width is then decided by the ARITHMETIC OF HALVING rather than by what
 * providers serve. Measured on the live pool — caps 10 / 10,000 / 19,999 —
 * repeated halving of a 5.2M gap lands on 10,174-block windows, which is 174
 * blocks over the chain's own public RPC. So every one of the 512 windows was
 * routed to the single provider capping at 19,999, while the endpoint
 * explicitly configured `preferMethods: ["eth_getLogs"]` served none of them.
 * That single-provider funnel is what tripped its breaker and produced
 * RC_RPC_NO_HEALTHY_PROVIDER ("every configured provider is ... circuit-open
 * (method eth_getLogs)") while the other endpoints sat idle and healthy.
 *
 * THE POLICY. Pick the declared cap `C` maximizing `C × N(C)`, where `N(C)` is
 * how many providers can serve a window that wide — the aggregate width the
 * pool can carry per round, so it trades window count against how many
 * endpoints share the load. On the live config that selects 10,000 (2 × 10,000
 * = 20,000) over 19,999 (1 × 19,999), i.e. it prefers two providers splitting
 * slightly narrower windows to one provider carrying every window alone. It
 * also rejects the degenerate 10-block cap (3 × 10 = 30) that "serve the most
 * providers" alone would have chosen.
 *
 * This only picks the STARTING width. A provider whose declared cap is more
 * optimistic than its real one still gets refused, and the bisection in
 * `walkLogRange` still narrows from there — the declaration is a hint, never a
 * promise.
 */
export function logStrideSpan(endpoints: readonly ProviderEndpoint[]): number | null {
  const capable = endpoints.filter((e) => providerServesMethod(e.capabilities, "eth_getLogs"));
  if (capable.length === 0) return null;
  // An uncapped capable provider can serve any width — nothing to stride at.
  if (capable.some((e) => e.capabilities?.maxLogSpan === undefined)) return null;

  const caps = [...new Set(capable.map((e) => e.capabilities!.maxLogSpan!))].sort((a, b) => a - b);
  let best = caps[caps.length - 1];
  let bestScore = -1;
  for (const c of caps) {
    const servers = capable.filter((e) => e.capabilities!.maxLogSpan! >= c).length;
    const score = c * servers;
    // `>=` with an ascending scan breaks ties toward the WIDER window: same
    // aggregate throughput, fewer round trips.
    if (score >= bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Narrowest declared span among providers that PREFER eth_getLogs, or null. Ingest sizes
 * its windows to it so that provider is admitted and, on a sort-order tie, served first.
 */
export function preferredLogSpan(endpoints: readonly ProviderEndpoint[]): number | null {
  const spans = endpoints
    .filter((e) => e.preferMethods?.includes("eth_getLogs") && providerServesMethod(e.capabilities, "eth_getLogs"))
    .map((e) => e.capabilities?.maxLogSpan)
    .filter((s): s is number => typeof s === "number");
  return spans.length > 0 ? Math.min(...spans) : null;
}

let preferredSpanCache: number | null | undefined;
let preferredSpanGeneration = -1;

/** Memoized `preferredLogSpan` over the live config, on the pool's generation. */
export function configuredPreferredLogSpan(): number | null {
  if (preferredSpanCache !== undefined && preferredSpanGeneration === rpcEndpointGeneration()) {
    return preferredSpanCache;
  }
  preferredSpanGeneration = rpcEndpointGeneration();
  try {
    preferredSpanCache = preferredLogSpan(activeEndpointConfig());
  } catch {
    preferredSpanCache = null;
  }
  return preferredSpanCache;
}

let strideCache: number | null | undefined;
let strideGeneration = -1;

/**
 * Memoized `logStrideSpan` over the live endpoint config. Falls back to null
 * (single full-range attempt, the pre-existing behavior) if the config cannot
 * be parsed — a stride is an optimization, and it must never be the thing that
 * turns a bad config into a failed log read. `buildProviders` reports that
 * fault properly.
 */
export function configuredLogStride(): number | null {
  // Keyed on the SAME generation as the pool: the stride is derived from the
  // declared caps, so an operator disabling the 19,999-span provider must not
  // leave a stride nothing can serve.
  if (strideCache !== undefined && strideGeneration === rpcEndpointGeneration()) {
    return strideCache;
  }
  strideGeneration = rpcEndpointGeneration();
  try {
    strideCache = logStrideSpan(activeEndpointConfig());
  } catch {
    strideCache = null;
  }
  return strideCache;
}

/**
 * Raised when no configured provider can serve an `eth_getLogs` at the
 * requested span — every capable one caps below it. This is a "subdivide"
 * signal, not an outage: it is classified as a splittable-range error so the
 * caller's range walker bisects and retries narrower, exactly as it would for a
 * provider's own oversized-range refusal.
 */
export class OversizedLogRangeError extends Error {
  /** Tag read by isSplittableRangeError (message-independent). */
  readonly splittableRange = true;
  /** Widest window a healthy narrower-capped provider still serves; `walkLogRange` re-strides to it. */
  readonly servableSpan: number | null;
  constructor(span: number | null, servableSpan: number | null = null) {
    super(
      `eth_getLogs range of ${span ?? "unknown"} blocks exceeds the range limit of every eligible provider`,
    );
    this.name = "OversizedLogRangeError";
    this.servableSpan = servableSpan;
  }
}

// ── error classification (§11.3/§11.4) ───────────────────────

/**
 * `isExecutionRevert` and `shouldFailover` now live in `./fault`, beside
 * `isTransientRpcError`, and are re-exported here so every existing caller and
 * test keeps naming them from the same place.
 *
 * They moved because they are pure predicates over an error object while this
 * module is a transport: it opens sockets, reads the environment and writes to
 * the AsyncLocalStorage scan context. `lib/audit/read-context.ts` imported
 * `shouldFailover` from here and, in doing so, bound the entire contract audit
 * to this server — one predicate dragging a whole provider pool behind it.
 */
export { isExecutionRevert, shouldFailover } from "./fault";
import { isExecutionRevert, isMethodUnavailableError, isMissingBlockStateError, shouldFailover } from "./fault";

/** State reads that can name a block. Their LAST param is the block tag. */
const BLOCK_TAGGED_READS = new Set(["eth_call", "eth_getBalance", "eth_getCode", "eth_getStorageAt"]);

/**
 * Does this request ask for state at an explicit block NUMBER (not a tag)?
 * Structural gate for the missing-state branch in `poolRequest`, same pattern as
 * `rangeBearing`: provider prose is only trusted where the request can earn it.
 */
export function requestsHistoricalState(method: string, params: unknown): boolean {
  if (!BLOCK_TAGGED_READS.has(method) || !Array.isArray(params) || params.length === 0) return false;
  const tag = params[params.length - 1];
  return typeof tag === "string" && /^0x[0-9a-f]+$/i.test(tag);
}

/**
 * A splittable `eth_getLogs`-style range/result-cap refusal: the provider
 * answered — it just declined a query it considers too big. This is
 * DIFFERENT from a genuine transport fault: the provider is healthy, and
 * whatever walked the range too wide can subdivide and retry a narrower
 * window. Matched on MESSAGE TEXT only, deliberately not on JSON-RPC code
 * (including -32000): `lib/rpc/log-index.ts` and `lib/explorer/logs.ts`
 * both document this chain's own RPC nodes answering an overlong
 * `eth_getLogs` walk with `-32000 log query timed out` — a real,
 * degraded-node TIMEOUT, not a "your query is too large, retry narrower"
 * refusal. Keying this classifier off -32000 (or any code) would silently
 * reclassify that genuine outage as a healthy provider's range refusal and
 * mask real degradation from the circuit breaker. The message patterns below
 * mirror common provider wording (Alchemy/Infura "query returned more than
 * N results", Erigon/geth-family "block range too large" /
 * "exceeds the range limit", "eth_getLogs is limited to ... range"), and the
 * 4663 public node's "query spans N blocks ... only M are allowed" (2026-09-28:
 * 10M blocks, 100k when a topic position ORs several values).
 */
const SPLITTABLE_RANGE_MESSAGE =
  /query returned more than \d+ results|range.{0,20}too large|too large.{0,20}range|block range exceeds|range.{0,15}(is )?limited|is limited to.{0,20}range|exceeds?( the)? range|exceeded max allowed range|ErrGetLogsExceededMaxAllowedRange|exceeds limit of|is limited to \d+ blocks|query spans \d+ blocks/i;

/**
 * "limit exceeded" WITHOUT a subject is not a range refusal.
 *
 * The bare alternative used to sit in the regex above, and Alchemy's
 * quota-exhaustion message — "Monthly capacity limit exceeded" — matched it.
 * That routed a dead provider into the healthy-provider branch of
 * `poolRequest`, which rethrows immediately: **no failover to the two working
 * providers, and no circuit open**, so the dead provider stayed first in the
 * ranking forever. Measured in prod 2026-08-21/22: factory-event discovery
 * failed on 100% of its 10-minute runs, starting the hour the monthly quota
 * ran out.
 *
 * The polarity is what makes this the dangerous direction to get wrong. Calling
 * a range refusal a transport fault costs one needless failover; calling a
 * transport fault a range refusal disables failover entirely. So the limit
 * wording must name what it is a limit ON.
 */
const LIMIT_WORDING = /limit exceeded|exceeds?( the)? limit/i;
const RANGE_SUBJECT = /\bblocks?\b|\branges?\b|\blogs?\b|\bresults?\b/i;

/**
 * JSON-RPC codes that mean "your log range is too big, retry narrower" — and
 * ONLY that. Goldsky Edge RPC normalizes its oversized-`eth_getLogs` rejection
 * to -32012 ("Range too large") with an HTTP 413; it is unambiguous and, unlike
 * -32000, is not used by this chain's own nodes for genuine timeouts, so
 * matching it by code is safe. Goldsky's other normalized codes stay in their
 * natural lanes: -32005 (rate limit) and -32015 (node timeout) are transient →
 * failover; -32016 (unauthorized) fails over so the public RPC still serves
 * while the breaker sidelines a mis-keyed Goldsky.
 */
const SPLITTABLE_RANGE_CODES = new Set([-32012]);

export function isSplittableRangeError(error: unknown): boolean {
  let cursor: unknown = error;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as {
      message?: string;
      code?: number;
      status?: number;
      splittableRange?: boolean;
      cause?: unknown;
    };
    // Our own synthetic OversizedLogRangeError carries an explicit tag.
    if (e.splittableRange === true) return true;
    // viem's 10 MB body cap on a healthy node's answer. A busy 200-block slice of
    // this chain is 12 MB, so an unsplit window froze launch ingest (2026-09-15).
    if ((e as { name?: string }).name === "ResponseBodyTooLargeError") return true;
    if (typeof e.status === "number" && (e.status === 403 || e.status === 413)) return true;
    if (typeof e.code === "number" && SPLITTABLE_RANGE_CODES.has(e.code)) return true;
    if (typeof e.message === "string") {
      if (SPLITTABLE_RANGE_MESSAGE.test(e.message)) return true;
      // Generic limit wording counts only when the message says what the limit
      // is on — see LIMIT_WORDING above for the outage this prevents.
      if (LIMIT_WORDING.test(e.message) && RANGE_SUBJECT.test(e.message)) return true;
      if (/403|forbidden|access denied/i.test(e.message) && /block|range|log|getlogs|http/i.test(e.message)) return true;
    }
    cursor = e.cause;
  }
  return false;
}

// ── the pool ─────────────────────────────────────────────────

interface ActiveProvider {
  endpoint: ProviderEndpoint;
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  /** false once the eth_chainId probe proves this endpoint is another chain. */
  enabled: boolean;
  /** Never route ordinary calls until this endpoint has proved its chain. */
  chainIdVerified: boolean;
  /** Failed probes are retried after a short cooldown, not on every request. */
  chainIdRetryAtMs: number;
  /** One probe per endpoint even when many RPC calls arrive together. */
  chainIdProbe: Promise<void> | null;
}

let providers: ActiveProvider[] | null = null;
let builtGeneration = -1;
let legacyWarned = false;

/**
 * The pool the process should be using right now: the operator's table when it
 * has one, otherwise the `RPC_ENDPOINTS_JSON` seed.
 *
 * An unseeded table, an unreachable database and an unset DATABASE_URL all
 * arrive here as `null` from `configuredEndpoints()`, and all three mean the
 * same thing — no operator opinion — so all three fall through to the seed.
 * None of them may mean "no providers" (§4).
 */
function activeEndpointConfig(): ProviderEndpoint[] {
  return [...(configuredEndpoints() ?? parseEndpointConfig(process.env)), ...configuredSwapEndpoints()];
}

function buildProviders(): ActiveProvider[] {
  // Out of band, because this function is sync and on every RPC path. See
  // refreshRpcEndpoints() for why the wiring lives here and not at call sites.
  refreshRpcEndpoints();
  if (providers && builtGeneration === rpcEndpointGeneration()) return providers;
  const cfg = poolConfig();
  let endpoints: ProviderEndpoint[];
  try {
    endpoints = activeEndpointConfig();
  } catch (error) {
    void reportError({
      code: "RC_CONFIG_INVALID",
      message: error instanceof Error ? error.message : "invalid RPC endpoint config",
      operation: "providerPool.parseConfig",
    });
    throw error;
  }
  if (!process.env.RPC_ENDPOINTS_JSON && process.env.ROBINHOOD_RPC_FALLBACK_URL && !legacyWarned) {
    legacyWarned = true;
    console.warn(
      "[provider-pool] ROBINHOOD_RPC_URL/ROBINHOOD_RPC_FALLBACK_URL are deprecated — move to RPC_ENDPOINTS_JSON (PRD §11.1)"
    );
  }

  // A rebuilt pool may contain an endpoint this process has never probed, so
  // the wrong-chain guard has to run again — otherwise an endpoint added at
  // /admin/rpc inherits a clean bill of health it never earned.
  builtGeneration = rpcEndpointGeneration();
  providers = endpoints.map((endpoint) => {
    const transport: Transport = http(endpoint.url, {
      timeout: cfg.requestTimeoutMs,
      retryCount: 0, // retries and failover are the pool's job, not viem's
    });
    const { request } = transport({ chain: robinhoodChain });
    // EIP1193RequestFn's higher-kinded generics collapse to this shape at runtime.
    return {
      endpoint,
      request: request as ActiveProvider["request"],
      enabled: true,
      chainIdVerified: false,
      chainIdRetryAtMs: 0,
      chainIdProbe: null,
    };
  });
  return providers;
}

/**
 * Verify each endpoint once before routing any user method to it. Probe faults
 * leave the endpoint unverified and therefore unusable for this call; a later
 * request may retry after the cooldown. The per-endpoint promise is the
 * single-flight boundary, so concurrent requests neither duplicate probes nor
 * borrow another request's unverified result.
 */
async function validateChainIds(
  active: ActiveProvider[],
  args: { method: string; params?: unknown },
  scope: "shared" | "swap",
): Promise<void> {
  const retryMs = intEnv("RPC_CHAIN_ID_REPROBE_MS", 5_000);
  const now = Date.now();
  const checks: Promise<void>[] = [];
  for (const p of active) {
    if (!p.enabled || p.chainIdVerified || now < p.chainIdRetryAtMs) continue;
    if (!p.chainIdProbe) {
      p.chainIdProbe = (async () => {
        try {
          const raw = await p.request({ method: "eth_chainId" });
          // A prefix parse such as parseInt("0x1237junk", 16) accepts a
          // malformed response as chain 4663. Fail closed and let the bounded
          // retry treat it as an unknown probe result.
          if (typeof raw !== "string" || !/^0x[0-9a-f]+$/i.test(raw)) {
            throw new Error("provider returned a malformed eth_chainId");
          }
          const actual = BigInt(raw);
          if (actual !== BigInt(ROBINHOOD_CHAIN_ID)) {
            p.enabled = false;
            await reportError({
              code: "RC_RPC_WRONG_CHAIN",
              message: `provider "${p.endpoint.id}" answers for chain ${actual.toString()}, expected ${ROBINHOOD_CHAIN_ID} — disabled`,
              operation: "providerPool.validateChainIds",
              providerId: p.endpoint.id,
            }).catch(() => {});
            return;
          }
          p.chainIdVerified = true;
        } catch {
          // A failed probe is unknown, never permission to send a chain read.
          p.chainIdRetryAtMs = Date.now() + retryMs;
        } finally {
          p.chainIdProbe = null;
        }
      })();
    }
    checks.push(p.chainIdProbe);
  }
  // A verified provider that can serve this request is already a safe route.
  // Keep the call on its route deadline instead of making it wait for an
  // unrelated endpoint's cold probe or cooldown re-probe. When no such route
  // exists, wait for probes so a newly verified capable endpoint can serve it.
  const hasVerifiedRoute = active.some((p) =>
    p.enabled &&
    p.chainIdVerified &&
    (scope === "swap" || !p.endpoint.swapOnly) &&
    providerServes(p.endpoint, args.method, args.params)
  );
  if (!hasVerifiedRoute) await Promise.all(checks);
}

export class NoHealthyProviderError extends Error {
  readonly code = "RC_RPC_NO_HEALTHY_PROVIDER";
  constructor() {
    super("No healthy RPC provider is available for Robinhood Chain.");
    this.name = "NoHealthyProviderError";
  }
}

export class RpcSaturatedError extends Error {
  readonly code = "RC_RPC_SATURATED";
  constructor() {
    super("Every RPC provider is at its rate or concurrency limit.");
    this.name = "RpcSaturatedError";
  }
}

/** Milliseconds left on the current scan's RPC deadline; null outside a scan (jobs have route timeouts). */
export function scanTimeLeftMs(): number | null {
  return remainingDeadlineMs(poolConfig());
}

function remainingDeadlineMs(cfg: PoolConfig): number | null {
  const ctx = currentScanContext();
  if (!ctx) return null; // jobs have route-level timeouts instead
  return cfg.scanDeadlineMs - (Date.now() - ctx.startedAt);
}

function raceDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`scan deadline exhausted after ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * EIP-1193-style request that viem's `custom()` transport consumes. Walks the
 * ordered pool: first healthy provider serves; transport faults advance to the
 * next; deterministic results throw immediately.
 *
 * When the WHOLE pool faults on transport-class errors (audit HIGH-2: a burst
 * of 429s used to become a silent SKIP), the walk is retried after a short
 * backoff — bounded by RPC_RETRY_WALKS and the scan deadline, so a retry can
 * ride out a rate-limit window without stretching the route timeout.
 */
export async function poolRequest(
  args: { method: string; params?: unknown },
  scope: "shared" | "swap" = "shared",
): Promise<unknown> {
  const cfg = poolConfig();
  const pool = buildProviders();
  await validateChainIds(pool, args, scope);
  // Every throttle — circuit, concurrency ceiling, CU/RPS budget — is decided
  // by this one gate (lib/rpc/admission.ts). The pool below only routes and
  // retries; it never re-implements an admission rule.
  const gate = providerGate();

  // Capability filter (§11.2): drop providers that cannot serve THIS concrete
  // (method, params) before ranking — an incapacity is a routing rule, not a
  // runtime fault. Static for the whole call, so computed once.
  // Swap-only keys never serve scans; the swap walks them first, then the shared pool.
  const enabledPool = pool.filter((p) => p.enabled && p.chainIdVerified && (scope === "swap" || !p.endpoint.swapOnly));
  const admitted = enabledPool.filter((p) => providerServes(p.endpoint, args.method, args.params));
  // Only when selectivity is what admitted them: a read every declared window
  // would otherwise have refused must go to the widest window available, not to
  // whichever provider happens to sort first.
  const relaxedAdmission =
    args.method === "eth_getLogs" &&
    logQueryIsSelective(args.params) &&
    admitted.some((p) => {
      const cap = p.endpoint.capabilities?.maxLogSpan;
      const span = logSpanOf(args.params);
      return cap !== undefined && span !== null && span > cap;
    });
  const capable = relaxedAdmission ? [...preferWidestLogSpan(admitted)] : admitted;
  // Every endpoint in scope is still unproven (probes faulted, cooling down): an outage, not a
  // capability gap, so neither the span error nor the "excluded all" report below applies.
  if (enabledPool.length === 0 && pool.some((p) => p.enabled && (scope === "swap" || !p.endpoint.swapOnly))) {
    const err = new Error("no RPC endpoint has confirmed its chain id yet");
    err.name = "TimeoutError";
    throw err;
  }
  if (capable.length === 0) {
    // Every capable-of-the-method provider was excluded by an eth_getLogs span
    // cap → tell the caller to subdivide (the range walker bisects) rather than
    // hard-failing. Otherwise the method itself is genuinely unservable here.
    const excludedBySpan =
      args.method === "eth_getLogs" &&
      enabledPool.some((p) => providerServesMethod(p.endpoint.capabilities, args.method));
    if (excludedBySpan) throw new OversizedLogRangeError(logSpanOf(args.params));
    await reportError({
      code: "RC_RPC_NO_HEALTHY_PROVIDER",
      message: `no configured provider can serve ${args.method} (capability filter excluded all)`,
      operation: "providerPool.request",
    });
    throw new NoHealthyProviderError();
  }

  // Can this request be refused for its RANGE at all? eth_getLogs is the only
  // range-bearing method the pool routes. Deliberately keyed on the method
  // alone and not also on `logSpanOf(params) !== null`: a blockHash filter
  // still carries a result cap, and narrowing the gate further would change
  // behaviour for a case that is not implicated in the bug.
  const rangeBearing = args.method === "eth_getLogs";
  const historical = requestsHistoricalState(args.method, args.params);
  // Healthy providers dropped ONLY for their span. When every wider one faults, a narrower
  // window is still servable (OrbitFlare's 150 behind a 429ing public node, 2026-09-15).
  const narrowerSpan = (): number | null => {
    if (!rangeBearing) return null;
    const span = logSpanOf(args.params);
    const now = Date.now();
    const spans = enabledPool
      .filter((p) => !admitted.includes(p) && providerServesMethod(p.endpoint.capabilities, args.method))
      .filter((p) => circuitAllows(gate.circuitFor(p.endpoint.id), cfg, now))
      .map((p) => p.endpoint.capabilities?.maxLogSpan)
      .filter((s): s is number => typeof s === "number");
    const best = spans.length > 0 ? Math.max(...spans) : null;
    return best !== null && span !== null && best < span ? best : null;
  };

  const maxWalks = intEnv("RPC_RETRY_WALKS", 2);
  const backoffMs = intEnv("RPC_RETRY_BACKOFF_MS", 300);
  // Queueing delays get their own wait rather than consuming fault walks.
  // Bounded by scan deadline or total waited ms for background jobs.
  const saturationWaitMs = intEnv("RPC_SATURATION_WAIT_MS", 50);
  const saturationMaxWaitMs = intEnv("RPC_SATURATION_MAX_WAIT_MS", 30_000);
  let totalSaturationWaitMs = 0;
  let totalAttempted = 0;
  let lastError: unknown = null;

  const callerSignal = currentScanContext()?.signal;
  for (let walk = 0; walk < maxWalks; walk++) {
    const ranked = scope === "swap"
      ? [
        ...gate.rank(capable.filter((p) => p.endpoint.swapOnly), args.method),
        ...gate.rank(capable.filter((p) => !p.endpoint.swapOnly), args.method),
      ]
      : gate.rank(capable, args.method);

    // Why a provider did not serve is COUNTED, never inferred. The previous
    // version reconstructed "the pool is merely busy" from `lastError === null`
    // — "nobody threw, so everyone must have been skipped" — which was wrong in
    // two ways. It could not tell a concurrency skip from a budget skip, and
    // `lastError` persists ACROSS walks, so a second walk that was purely
    // saturated still looked like a fault (because walk 1 had set lastError)
    // and took the backoff path instead of the short saturation wait.
    let attempted = 0;
    let transientDenials = 0;
    let prunedStateMisses = 0;
    let unavailable = 0;
    const deniedBy = new Map<AdmissionDenial, string[]>();
    const budgetDenied: ProviderEndpoint[] = [];

    for (const provider of ranked) {
      const providerId = provider.endpoint.id;
      callerSignal?.throwIfAborted();

      // Deadline first: out of time means we neither reserve a concurrency slot
      // nor spend CU on a call that cannot happen. (The old order checked this
      // after the concurrency test, so a doomed request could still burn
      // budget.)
      const remaining = remainingDeadlineMs(cfg);
      if (remaining !== null && remaining < 1_000) {
        // No time left for another upstream attempt — surface as a timeout.
        const err = lastError ?? new Error("scan deadline exhausted before RPC attempt");
        if (err instanceof Error && !lastError) err.name = "TimeoutError";
        throw err;
      }
      const attemptTimeout =
        remaining === null ? cfg.requestTimeoutMs : Math.min(cfg.requestTimeoutMs, remaining);

      // THE admission decision. Circuit, concurrency ceiling and CU/RPS budget
      // all compose inside lib/rpc/admission.ts, in an order that module owns;
      // a grant reserves the slot until the underlying provider request settles.
      const admission = gate.tryAdmit(provider.endpoint, args.method, cfg);
      if (!admission.admitted) {
        if (admission.transient) transientDenials += 1;
        if (admission.reason === "over-budget") budgetDenied.push(provider.endpoint);
        const seen = deniedBy.get(admission.reason);
        if (seen) seen.push(providerId);
        else deniedBy.set(admission.reason, [providerId]);
        continue;
      }

      attempted += 1;
      totalAttempted += 1;
      const started = Date.now();
      // The route deadline may win while viem's own HTTP timeout still has the
      // request open. Keep the admission slot until the actual provider work
      // settles; otherwise a second call can exceed maxConcurrentRequests.
      const work = Promise.resolve().then(() => provider.request(args));
      void work.then(admission.release, admission.release);
      let result: unknown;
      try {
        result = await raceDeadline(work, attemptTimeout);
      } catch (error) {
        const revert = isExecutionRevert(error);
        const callerCancelled = callerSignal?.aborted === true;
        const outcome: RpcOutcome = revert ? "expected-revert" : "transport-error";
        recordRpcAttempt({
          method: args.method,
          providerId,
          latencyMs: Date.now() - started,
          outcome,
        });
        if (revert) {
          // A revert proves the provider answered correctly: chain fact, no failover.
          gate.onSuccess(provider.endpoint);
          throw error;
        }
        // Cancellation is local to the caller. Do not count its timing out or
        // leaving as a provider failure; the request promise still owns the
        // admission slot until the underlying HTTP work settles.
        if (callerCancelled) callerSignal!.throwIfAborted();
        // Only a request that HAS a block range can be refused for its range.
        // The message classifier is a heuristic over provider prose, and this
        // branch disables failover AND the circuit — the most expensive thing
        // a misread can buy. A method with no range cannot legitimately reach
        // it, so the structural fact gates the textual guess rather than the
        // other way round. (`eth_blockNumber` hitting this is precisely how a
        // quota-exhausted provider took factory discovery down.)
        if (rangeBearing && isSplittableRangeError(error)) {
          // The provider is healthy — it just refused an oversized range.
          // Never a circuit fault (open or close): let it propagate so
          // whatever walked the range too wide can subdivide and retry.
          throw error;
        }
        // L144. A pruned node is healthy, it just keeps less history than this
        // block needs (public ~6,200 blocks, Alchemy full archive). Try the next
        // provider and never count it against this one's circuit.
        if (historical && isMissingBlockStateError(error)) {
          prunedStateMisses += 1;
          lastError = error;
          continue;
        }
        if (isMethodUnavailableError(error)) {
          unavailable += 1;
          lastError = error;
          continue;
        }
        if (!shouldFailover(error)) throw error; // deterministic non-revert fault
        const phase = gate.onFailure(provider.endpoint, cfg, Date.now());
        recordProviderState(providerId, phase === "OPEN" ? "ERROR" : "TIMEOUT");
        lastError = error;
        continue;
      }
      recordRpcAttempt({
        method: args.method,
        providerId,
        latencyMs: Date.now() - started,
        outcome: "ok",
      });
      gate.onSuccess(provider.endpoint);
      // The caller may have left while the provider was still working. The
      // answer is real, but it must not keep a cancelled route doing work.
      callerSignal?.throwIfAborted();
      return result;
    }

    // Every provider we reached lacks this block's state and none was merely
    // busy, so a retry walk would ask the same nodes the same question.
    if (attempted > 0 && prunedStateMisses + unavailable === attempted && transientDenials === 0) throw lastError;

    // Nothing was attempted and nothing was merely busy: every capable provider
    // is circuit-open. That IS an unhealthy pool, and waiting cannot fix it —
    // a breaker is a 60-second condition, not a queueing delay.
    if (attempted === 0 && transientDenials === 0) {
      const narrower = narrowerSpan();
      if (narrower !== null) throw new OversizedLogRangeError(logSpanOf(args.params), narrower);
      if (lastError) throw lastError; // retried into an all-open pool: keep the real cause
      await reportError({
        code: "RC_RPC_NO_HEALTHY_PROVIDER",
        message: `every configured provider is disabled or circuit-open (method ${args.method})`,
        operation: "providerPool.request",
      });
      throw new NoHealthyProviderError();
    }

    // Nothing was attempted, but at least one provider was healthy-and-busy.
    // These are NOT the same condition and must not be conflated: the requests
    // were never sent, so the pool is SATURATED, not unhealthy.
    //
    // This distinction is why a scan could report RC_RPC_NO_HEALTHY_PROVIDER
    // while the upstream dashboard showed nothing but HTTP 200s. The RWA basket
    // probe fans out ~25-wide (lib/config/trusted-addresses.ts), against a pool
    // whose ceilings sum to far fewer slots, so the surplus callers found every
    // provider busy, were skipped without an attempt, and fell out of the walk
    // loop with no error to report. `recordRpcAttempt` never fired either,
    // making the starvation invisible in our own telemetry — which is why the
    // wait branch below now records the throttle that actually bit.
    //
    // Saturation resolves on its own — an in-flight call finishes and frees a
    // slot — so it is worth WAITING for, unlike a fault. Waiting is bounded by
    // the scan deadline, and a saturation wait is deliberately NOT counted
    // against `maxWalks`: that budget exists to bound retries against broken
    // providers, and spending it on healthy-but-busy ones is what turned a
    // queueing delay into a hard failure.
    const saturated = attempted === 0;
    if (saturated) {
      // Surface WHICH throttle blocked us. Recorded only here — where a denial
      // actually cost the request an attempt — so a provider that was briefly
      // skipped and then served is not slandered in the scan summary.
      for (const [reason, ids] of deniedBy) {
        if (reason === "circuit-open") continue; // already recorded as ERROR on the fault
        const state = reason === "at-concurrency" ? "SATURATED" : "THROTTLED";
        for (const id of ids) recordProviderState(id, state);
      }

      const remaining = remainingDeadlineMs(cfg);
      if (remaining !== null) {
        if (remaining < saturationWaitMs + 1_000) break;
      } else if (totalSaturationWaitMs >= saturationMaxWaitMs) {
        break;
      }

      let sleepMs = saturationWaitMs;
      if (budgetDenied.length > 0) {
        const now = Date.now();
        const limiter = cuLimiter();
        let smallestMs = Number.POSITIVE_INFINITY;
        for (const ep of budgetDenied) {
          const ms = limiter.msUntilAvailable(ep, args.method, now);
          if (ms < smallestMs) smallestMs = ms;
        }
        sleepMs = Math.max(saturationWaitMs, Math.min(1000, smallestMs));
      }

      totalSaturationWaitMs += sleepMs;
      walk -= 1;
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
      continue;
    }

    // A genuine pool-wide fault. Back off and retry if time permits.
    if (walk + 1 >= maxWalks) break;
    const wait = backoffMs * (walk + 1);
    const remaining = remainingDeadlineMs(cfg);
    if (remaining !== null && remaining < wait + 2_000) break;
    emitProgress({ type: "retry", source: "rpc", detail: `retrying ${args.method}` });
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  const narrower = narrowerSpan();
  if (narrower !== null) throw new OversizedLogRangeError(logSpanOf(args.params), narrower);
  if (totalAttempted === 0) throw new RpcSaturatedError();
  throw lastError ?? new NoHealthyProviderError();
}

/** Provider ids in configured order — readiness reporting only, never URLs. */
export function providerIds(): string[] {
  return buildProviders().map((p) => p.endpoint.id);
}

/** Test hook: rebuild the pool and re-run chain validation on next request. */
export function resetProviderPoolForTests(): void {
  providers = null;
  builtGeneration = -1;
  legacyWarned = false;
  strideCache = undefined;
  strideGeneration = -1;
  preferredSpanCache = undefined;
  preferredSpanGeneration = -1;
  resetRpcEndpointsForTests();
}
