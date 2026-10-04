import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Per-request scan context (PRD §20.1, §11.7).
 *
 * Carried through the pipeline with AsyncLocalStorage so the RPC transport,
 * error reporter, and scan-run recorder correlate without threading a context
 * argument through every scanner function. Node runtime only — the edge proxy
 * never imports this module.
 */

export type RpcOutcome = "ok" | "expected-revert" | "transport-error";

export interface RpcCounters {
  /** Settled JSON-RPC calls (success or deterministic revert). */
  logicalCalls: number;
  /** Every transport attempt, including retries and failovers. */
  physicalAttempts: number;
  /** Deterministic EVM reverts — probe outcomes, not provider failures (§5.4). */
  expectedReverts: number;
  /** Attempts served by a provider other than the first one used this scan. */
  providerSwitches: number;
  /**
   * Per-provider `{n, err, ms}` over attempts that were SERVED — the answer to
   * "who actually carried this scan", which nothing persisted before (L40).
   *
   * Strictly the complement of `providerStates`, which provider-pool writes
   * ONLY on denial. Absence means opposite things in the two maps: missing from
   * `providerStates` means never denied, missing from here means never served.
   * Reading one for the other is the confusion this exists to end.
   */
  providerCalls: Record<string, { n: number; err: number; ms: number }>;
  methodCounts: Record<string, number>;
  totalLatencyMs: number;
  /**
   * Multicall3 batches that physically landed this scan (docs/ways-of-work/
   * plan/.../implementation-plan.md's observability requirement — see
   * docs/KNOWN-PROBLEMS.md C5). `multicallBatchedCalls` is the sum of calls
   * those batches carried, so batch size is recoverable as the average
   * (`multicallBatchedCalls / multicallBatches`) without a per-batch array.
   */
  multicallBatches: number;
  multicallBatchedCalls: number;
  /** Reverted (not faulted) subcalls inside a landed batch — expected noise
   *  for reads like V4 ownerOf, not a fault (see lib/rpc/multicall.ts). */
  multicallSubcallFailures: number;
  /** Chunks that fell back to individual `eth_call`s this scan, whichever
   *  reason (Multicall3 unavailable, a chunk faulted, a short result array). */
  multicallFallbackCount: number;
}

/**
 * Real-time scan progress (§UX — replaces the client's fake step timer).
 * `phase` marks a real pipeline checkpoint; `retry` names what's being
 * retried (surfaced verbatim on the scan page instead of a silent wait).
 */
export type ScanProgressEvent =
  | { type: "phase"; step: "ingest" | "honeypot" | "checks" | "receipt" }
  | { type: "retry"; source: "explorer" | "rpc"; detail: string }
  | { type: "done"; body: unknown }
  | { type: "error"; code: string; message: string; httpStatus: number };

/**
 * Resource accounting for the contract/authority audit check specifically
 * (docs/ways-of-work/plan/.../implementation-plan.md, its budget section) —
 * kept separate from `RpcCounters` because the audit has its own
 * extra-call/CPU/explorer budgets layered on top of the scan-wide ones.
 */
export interface AuditCounters {
  cpuMs: number;
  extraRpcCalls: number;
  explorerCalls: number;
  cacheStatus: "hit" | "miss" | "partial" | null;
  targetsAnalyzed: number;
  truncationReason: string | null;
}

/**
 * Cumulative wall-clock time spent waiting on each upstream this scan
 * (Runtime Safety Amendment, M14) — the direct answer to "where did the
 * 101s go" that `scan_runs` couldn't give during the incident that drove
 * this. Wall time, not CPU: retries and backoff count, since that's what
 * ate the route's `maxDuration` budget. Only `explorerWallMs` is wired to a
 * real call site this milestone (`lib/explorer/blockscout.ts`'s `get<T>()`);
 * the other three exist so market/DB/Upstash instrumentation has somewhere
 * to write once it lands.
 */
export interface UpstreamCounters {
  explorerWallMs: number;
  /**
   * Of `explorerWallMs`, the part spent QUEUED behind the concurrency gate
   * rather than on the wire.
   *
   * Split out because the combined number is actively misleading: it is a sum
   * over calls, and every queued call bills the same wall-clock second, so a
   * scan can report far more "explorer time" than it spent. Measured
   * 2026-08-01: 72.6s reported against a 90.6s scan, of which the real
   * on-the-wire share is what `explorerWallMs - explorerQueueMs` now isolates.
   * Optimizing the wrong half of that number is the whole reason this exists.
   */
  explorerQueueMs: number;
  /** Explorer HTTP calls made this scan (all endpoints, retries not counted twice). */
  explorerCalls: number;
  /**
   * Requests answered WITHOUT touching the network — served from the scan memo
   * or joined onto an identical in-flight request. Counted so the dedupe's value
   * is measurable rather than assumed; at ~3.5s/call these are the calls that
   * did not happen.
   */
  explorerDeduped: number;
  /**
   * Per-endpoint `{n, ms}`, where `ms` is on-the-wire time with queue EXCLUDED —
   * so it ranks endpoints by what they actually cost upstream, independent of
   * how unlucky they were in the queue. Same shape rationale as
   * `rpc_method_counts`.
   */
  explorerEndpoints: Record<string, { n: number; ms: number }>;
  marketWallMs: number;
  dbWallMs: number;
  upstashWallMs: number;
}

/**
 * Route-level terminal deadline (Runtime Safety Amendment, M13). One shared
 * cutoff every subsystem can check instead of each computing its own budget
 * off `startedAt` independently — the route races the whole pipeline against
 * this so a client gets a response by ~50s instead of riding a slow scan to
 * the platform's route `maxDuration`, where a platform can close the stream
 * under an in-flight `send()`.
 */
export interface ScanDeadline {
  readonly deadlineAtMs: number;
  remainingMs(): number;
  expired(): boolean;
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * KNOWN-PROBLEMS L110. This was 180_000 — identical to the route's own
 * `maxDuration`, and LATER than the client's real connection lifetime.
 *
 * Measured on prod 2026-09-05, two runs on 0x8490acd2…: the edge closed the
 * response at ~162s both times, and `scan_runs` recorded
 * `RC_SCAN_DEADLINE_EXCEEDED` at exactly 180000ms. So the guard fired and wrote
 * its terminal error into a socket that had been gone for 18 seconds. The
 * server knew; the caller got HTTP 200 and an unterminated stream.
 *
 * The budget that matters is therefore the DELIVERY window, not `maxDuration`:
 * a terminal event nobody can receive is not a terminal event.
 * `tests/scan-deadline-budget.test.ts` pins the margin, because the original
 * defect was one constant drifting into another with a comment that still
 * described the old distance between them.
 */
export const SCAN_DELIVERY_WINDOW_MS = 162_000;
/** Headroom for the error to be written and flushed before the edge cuts. */
export const SCAN_DEADLINE_MARGIN_MS = 22_000;

function scanTerminalDeadlineMs(): number {
  return intEnv(
    "SCAN_TERMINAL_DEADLINE_MS",
    SCAN_DELIVERY_WINDOW_MS - SCAN_DEADLINE_MARGIN_MS,
  );
}

function createScanDeadline(startedAtMs: number): ScanDeadline {
  const deadlineAtMs = startedAtMs + scanTerminalDeadlineMs();
  return {
    deadlineAtMs,
    remainingMs: () => deadlineAtMs - Date.now(),
    expired: () => Date.now() >= deadlineAtMs,
  };
}

export interface ScanRunContext {
  scanId: string;
  requestId: string;
  /** Set by the pipeline once the input address is normalized. */
  tokenAddress: string | null;
  startedAt: number;
  rpc: RpcCounters;
  /** First provider that served this scan; basis for switch counting. */
  firstProviderId: string | null;
  providerStates: Record<string, string>;
  audit: AuditCounters;
  deadline: ScanDeadline;
  upstream: UpstreamCounters;
  /** Small aggregate for DEX discovery and sell probes; never contains route evidence. */
  adapterCoverage: AdapterCoverage | null;
  /**
   * Successful explorer GET responses already fetched during THIS scan, keyed by
   * request URL. Bounded by construction — it lives and dies with the scan
   * (~90s), so it is not an unbounded process-local map (CLAUDE.md §5).
   *
   * Only successes are stored: a fault must never be replayed as an answer, and
   * an empty/404 body is a domain answer that the call site already knows how to
   * read. Reusing a response WITHIN one scan is also more correct than
   * re-fetching, since the scan's checks are supposed to describe one moment.
   */
  explorerMemo: Map<string, unknown>;
  /** Set by the route to stream progress; unset (and a no-op) for every other caller. */
  onEvent?: (event: ScanProgressEvent) => void;
  /** The caller left (swap route: a newer quote replaced this one). The pool sends nothing more. */
  signal?: AbortSignal;
}

export interface AdapterCoverage {
  discovery: {
    candidatePools: number;
    v4CandidatePools: number;
    complete: boolean;
    v4Complete: boolean;
  };
  sellSimulation: {
    ran: boolean;
    candidateCount: number;
    attempted: number;
    omitted: number;
    pass: number;
    critical: number;
    inconclusive: number;
    v4Attempted: number;
    v4Pass: number;
    v4Critical: number;
    v4Inconclusive: number;
    blockedRouteObserved: boolean;
  };
}

const MAX_COVERAGE_COUNT = 100_000;
function coverageCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(MAX_COVERAGE_COUNT, Math.trunc(value))) : 0;
}

/** Record bounded adapter discovery totals without retaining addresses or evidence. */
export function recordAdapterDiscoveryCoverage(
  coverage: AdapterCoverage["discovery"],
  ctx?: ScanRunContext,
): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  target.adapterCoverage = {
    discovery: {
      candidatePools: coverageCount(coverage.candidatePools),
      v4CandidatePools: coverageCount(coverage.v4CandidatePools),
      complete: coverage.complete === true,
      v4Complete: coverage.v4Complete === true,
    },
    sellSimulation: target.adapterCoverage?.sellSimulation ?? {
      ran: false, candidateCount: 0, attempted: 0, omitted: 0,
      pass: 0, critical: 0, inconclusive: 0,
      v4Attempted: 0, v4Pass: 0, v4Critical: 0, v4Inconclusive: 0,
      blockedRouteObserved: false,
    },
  };
}

/** Replace the sell-simulation summary after its existing adapter fold completes. */
export function recordAdapterSellCoverage(
  coverage: AdapterCoverage["sellSimulation"],
  ctx?: ScanRunContext,
): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  const countKeys = ["candidateCount", "attempted", "omitted", "pass", "critical", "inconclusive", "v4Attempted", "v4Pass", "v4Critical", "v4Inconclusive"] as const;
  const bounded = Object.fromEntries(countKeys.map((key) => [key, coverageCount(coverage[key])])) as Pick<AdapterCoverage["sellSimulation"], typeof countKeys[number]>;
  target.adapterCoverage = {
    discovery: target.adapterCoverage?.discovery ?? {
      candidatePools: 0, v4CandidatePools: 0, complete: false, v4Complete: false,
    },
    sellSimulation: {
      ...bounded,
      ran: coverage.ran === true,
      blockedRouteObserved: coverage.blockedRouteObserved === true,
    },
  };
}

const storage = new AsyncLocalStorage<ScanRunContext>();

export function createScanContext(requestId?: string): ScanRunContext {
  const startedAt = Date.now();
  return {
    scanId: randomUUID(),
    requestId: requestId ?? randomUUID(),
    tokenAddress: null,
    startedAt,
    rpc: {
      logicalCalls: 0,
      physicalAttempts: 0,
      expectedReverts: 0,
      providerSwitches: 0,
      providerCalls: {},
      methodCounts: {},
      totalLatencyMs: 0,
      multicallBatches: 0,
      multicallBatchedCalls: 0,
      multicallSubcallFailures: 0,
      multicallFallbackCount: 0,
    },
    firstProviderId: null,
    providerStates: {},
    audit: {
      cpuMs: 0,
      extraRpcCalls: 0,
      explorerCalls: 0,
      cacheStatus: null,
      targetsAnalyzed: 0,
      truncationReason: null,
    },
    deadline: createScanDeadline(startedAt),
    explorerMemo: new Map(),
    adapterCoverage: null,
    upstream: {
      explorerWallMs: 0,
      explorerQueueMs: 0,
      explorerCalls: 0,
      explorerDeduped: 0,
      explorerEndpoints: {},
      marketWallMs: 0,
      dbWallMs: 0,
      upstashWallMs: 0,
    },
  };
}

export function runWithScanContext<T>(ctx: ScanRunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function currentScanContext(): ScanRunContext | undefined {
  return storage.getStore();
}

/** Shared refills outlive any one caller; keep accounting and deadlines, but not its cancellation. */
export function runSharedRpcWork<T>(load: () => Promise<T>): Promise<T> {
  const ctx = currentScanContext();
  return ctx?.signal ? runWithScanContext({ ...ctx, signal: undefined }, load) : load();
}

export interface RpcAttempt {
  method: string;
  providerId: string;
  latencyMs: number;
  outcome: RpcOutcome;
}

/**
 * Record one transport attempt into the active scan context (no-op outside a
 * scan — background jobs and cold paths don't accumulate into nothing).
 */
export function recordRpcAttempt(attempt: RpcAttempt, ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  const { rpc } = target;
  const latency = Math.max(0, attempt.latencyMs);
  rpc.physicalAttempts += 1;
  rpc.methodCounts[attempt.method] = (rpc.methodCounts[attempt.method] ?? 0) + 1;
  rpc.totalLatencyMs += latency;
  // Attribute the attempt to the provider that took it. Counted for EVERY
  // outcome including transport-error: a provider that fails a lot has still
  // been used, and dropping its failures would make it look idle rather than
  // unhealthy — the exact misreading L40 is about.
  const prev = rpc.providerCalls[attempt.providerId] ?? { n: 0, err: 0, ms: 0 };
  rpc.providerCalls[attempt.providerId] = {
    n: prev.n + 1,
    err: prev.err + (attempt.outcome === "transport-error" ? 1 : 0),
    ms: prev.ms + latency,
  };
  if (attempt.outcome !== "transport-error") rpc.logicalCalls += 1;
  if (attempt.outcome === "expected-revert") rpc.expectedReverts += 1;
  if (target.firstProviderId === null) {
    target.firstProviderId = attempt.providerId;
  } else if (attempt.providerId !== target.firstProviderId) {
    rpc.providerSwitches += 1;
  }
}

/**
 * Account for the subcalls inside a successful Multicall3 batch.
 *
 * `recordRpcAttempt` counts ONE logical call per transport attempt, which is
 * correct for individual reads and wrong for a batch: 15 metadata reads
 * carried by one `eth_call` would otherwise register as 1: the scan would look
 * 15x cheaper than the work it did, and `isOverRpcBudget` — which gates on
 * logical calls — would loosen by the same factor.
 *
 * The batch envelope already counted itself, so only the remaining `count - 1`
 * are added here. The implementation-plan states the contract directly:
 * "Preserve one logical subcall record per result even though one physical
 * eth_call carries the batch."
 *
 * Only called on a batch that actually landed. A faulted batch falls back to
 * individual reads, and each of those accounts for itself.
 */
export function recordBatchedSubcalls(count: number, ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  if (!target || count <= 1) return;
  target.rpc.logicalCalls += count - 1;
}

/**
 * Record one Multicall3 batch that physically landed (docs/KNOWN-PROBLEMS.md
 * C5 — batch size, subcall failures, and fallback count were plan-required
 * but unwritten). `subcallCount` is the batch's size; `failures` is how many
 * of its subcalls reverted (a real on-chain answer, not a fault — see
 * lib/rpc/multicall.ts's own module doc on why that distinction matters).
 */
export function recordMulticallBatch(
  subcallCount: number,
  failures: number,
  ctx?: ScanRunContext,
): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  target.rpc.multicallBatches += 1;
  target.rpc.multicallBatchedCalls += subcallCount;
  target.rpc.multicallSubcallFailures += failures;
}

/** Record one chunk that fell back to individual `eth_call`s this scan. */
export function recordMulticallFallback(ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  target.rpc.multicallFallbackCount += 1;
}

/**
 * Merge partial audit resource-accounting fields into the active scan
 * context (no-op outside a scan). Called incrementally as the audit check
 * progresses through its own milestones, not once at the end, so a truncated
 * audit still reports accurate partial counters.
 */
export function recordAuditMetrics(fields: Partial<AuditCounters>, ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  Object.assign(target.audit, fields);
}

/**
 * Only the plain-number counters are accumulable. Naming them explicitly (vs.
 * `keyof UpstreamCounters`) keeps `explorerEndpoints`, which is a map, out of
 * reach of `+=`.
 */
type AccumulableUpstreamKey = "explorerWallMs" | "marketWallMs" | "dbWallMs" | "upstashWallMs";

const UPSTREAM_FIELD: Record<"explorer" | "market" | "db" | "upstash", AccumulableUpstreamKey> = {
  explorer: "explorerWallMs",
  market: "marketWallMs",
  db: "dbWallMs",
  upstash: "upstashWallMs",
};

/**
 * Accumulate wall-clock time spent on one upstream call into the active scan
 * context (no-op outside a scan, same convention as `recordRpcAttempt`/
 * `recordAuditMetrics` — background jobs and cold paths don't need to
 * accumulate into nothing).
 *
 * For the explorer, prefer `recordExplorerCall` — it maintains the same
 * `explorerWallMs` total AND the queue/endpoint breakdown. Calling both for one
 * request double-counts it.
 */
export function recordUpstreamLatency(
  kind: "explorer" | "market" | "db" | "upstash",
  ms: number,
  ctx?: ScanRunContext
): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  target.upstream[UPSTREAM_FIELD[kind]] += Math.max(0, ms);
}

/**
 * Record one explorer HTTP call, split into the time it waited for a gate slot
 * and the time it actually spent upstream.
 *
 * This is the explorer's replacement for `recordUpstreamLatency("explorer", …)`
 * — call ONE of them, never both, or `explorerWallMs` double-counts. It keeps
 * `explorerWallMs` on its original meaning (total time the call site was
 * blocked, queue included) so historical rows stay comparable, while making the
 * queue share and the per-endpoint breakdown separately visible.
 */
export function recordExplorerCall(
  endpoint: string,
  queuedMs: number,
  httpMs: number,
  ctx?: ScanRunContext
): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  const queue = Math.max(0, queuedMs);
  const http = Math.max(0, httpMs);
  target.upstream.explorerWallMs += queue + http;
  target.upstream.explorerQueueMs += queue;
  target.upstream.explorerCalls += 1;
  const prev = target.upstream.explorerEndpoints[endpoint] ?? { n: 0, ms: 0 };
  target.upstream.explorerEndpoints[endpoint] = { n: prev.n + 1, ms: prev.ms + http };
}

/**
 * The active scan's explorer memo, or null outside a scan.
 *
 * Null is a correct, safe answer — a background job or cold path simply does not
 * dedupe, exactly as before. It must never fall back to a process-global map:
 * that would share responses ACROSS scans with no bound, which is a different
 * (and unsafe) thing from reusing one response within one scan.
 */
export function currentExplorerMemo(): Map<string, unknown> | null {
  return currentScanContext()?.explorerMemo ?? null;
}

/** Count one explorer request served without touching the network. */
export function recordExplorerDedupe(ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  target.upstream.explorerDeduped += 1;
}

/** Record a provider's normalized health state for the scan summary (§11.6). */
export function recordProviderState(providerId: string, state: string, ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  if (!target) return;
  target.providerStates[providerId] = state;
}

/**
 * Emit a progress event to whoever is listening (no-op unless the route
 * wired `onEvent` — MCP and background-job callers of `scanToken` never set
 * it, so this stays free for them).
 */
export function emitProgress(event: ScanProgressEvent, ctx?: ScanRunContext): void {
  const target = ctx ?? currentScanContext();
  target?.onEvent?.(event);
}

/**
 * True once any explorer read has faulted this scan. The verdict is already
 * void the moment this is true (see pipeline.ts's hard gate), so every
 * explorer client call site uses this as a per-scan circuit breaker: once one
 * read fails, every other explorer call still pending in the same scan —
 * across every check, every pool, every DEX — short-circuits to null instead
 * of paying its own timeout+retry, since the answer is already known to be
 * discarded. Without this, a token with pools on N DEXes turned one real
 * outage into N × (2 attempts × up to 20s) of dead waiting before the 503.
 */
export function explorerFaulted(ctx?: ScanRunContext): boolean {
  const target = ctx ?? currentScanContext();
  return Object.entries(target?.providerStates ?? {}).some(
    // We now trip the scan-wide latch ONLY on total exhaustion of all capable
    // adapters for a method (recorded via the 'explorer-exhausted:' prefix by the router),
    // rather than on a single adapter's fault. This allows a healthy adapter to
    // fulfill the request if another faults, preserving the scan. Individual adapter
    // faults ('explorer:...') still appear in providerStates for metrics.
    ([id, state]) => id.startsWith("explorer-exhausted:") && state !== "OK" && state !== "NOT_FOUND",
  );
}
