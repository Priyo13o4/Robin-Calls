/**
 * Resource guards for the contract/authority audit (PRD "Capacity and Cost
 * Budget"), layered ON TOP OF the existing scan-wide `RPC_SCAN_DEADLINE_MS`
 * (lib/rpc/provider-pool.ts) — never a replacement for it. The audit has its
 * own, tighter wall-clock cutoff so it always leaves the route time for
 * scoring, receipt policy, persistence, and cleanup even when the rest of the
 * scan is otherwise healthy.
 */

/**
 * `process.env` is guarded because this module is now loadable in a browser,
 * where `process` may not exist and where a dynamic key is not something the
 * bundler can substitute at build time. Every limit below then falls back to
 * its literal — which is the correct client behaviour anyway: these are OUR
 * capacity guards, tuned to OUR route, and a visitor's tab is not spending our
 * budget.
 */
function intEnv(name: string, fallback: number): number {
  const raw = typeof process === "undefined" ? undefined : process.env?.[name];
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Raised 15 -> 48 and 10 -> 24 (2026-08-26, KNOWN-PROBLEMS L50).
 *
 * These were sized against a route that made ~25 RPC calls. It now makes
 * 150-400 logical calls per scan, so the audit was rationed to ~4% of the
 * scan's own appetite and bailed at one of `orchestrator.ts`'s five
 * `budget.exceeded()` exits. Measured in prod: 44 of 157 published verdicts
 * (28%) had `ownership` SKIP blaming "the contract audit did not complete" /
 * "could not attribute the authority surface", and those runs finished in
 * 17.6s against a 51s wall — they were not out of TIME, they were out of
 * CALLS. Every one of those SKIPs is unread scoring surface, which caps the
 * score at 84 (`UNREAD_SURFACE_CLEAR_CAP`).
 *
 * A ceiling only binds on contracts that need the calls, so this costs
 * nothing on the simple majority. The wall clock below is the real safety
 * net, and it always yields to the route's own deadline.
 */
export const auditMaxExtraRpcCalls = () => intEnv("AUDIT_MAX_EXTRA_RPC_CALLS", 48);
export const auditMaxExplorerCalls = () => intEnv("AUDIT_MAX_EXPLORER_CALLS", 24);
export const auditMaxProxyDepth = () => intEnv("AUDIT_MAX_PROXY_DEPTH", 4);
export const auditMaxDiamondFacets = () => intEnv("AUDIT_MAX_DIAMOND_FACETS", 8);
export const auditMaxSourceBytes = () => intEnv("AUDIT_MAX_SOURCE_BYTES", 1_048_576);
export const auditStaticCpuTargetMs = () => intEnv("AUDIT_STATIC_CPU_TARGET_MS", 500);

/**
 * PRD: "Audit work must stop around 50-52 seconds so the route retains time
 * for scoring, receipt policy, persistence, and cleanup." Measured from the
 * SAME `startedAt` as the rest of the scan (not a fresh clock at audit
 * start), since the 50-52s line is a route-lifetime budget, not an
 * audit-lifetime one. Read lazily (like every other guard above), not cached
 * at module load, so it stays consistent with the rest of this file and
 * testable via env override.
 *
 * This is a fallback only: `createAuditBudget(clock)` prefers the enclosing
 * scan's shared deadline (Runtime Safety Amendment, M13) when one is handed to
 * it, so the audit shares one source of truth with the rest of the route
 * instead of racing its own independently-configured cutoff against it.
 * `AUDIT_WALL_CLOCK_CUTOFF_MS` still applies when there is no enclosing scan
 * and as a floor even when there is — see `msRemaining` below.
 */
const auditWallClockCutoffMs = () => intEnv("AUDIT_WALL_CLOCK_CUTOFF_MS", 70_000);
// 51s -> 70s alongside the call-budget raise above: a bigger call budget means
// the audit can now legitimately run longer, and 51s was sized against a 60s
// route (prod has run RPC_SCAN_DEADLINE_MS=90000 for some time). Safe at any
// route length because `msRemaining` takes the MIN with the scan's own
// deadline, so this can never outlive the request that started it.

/**
 * The enclosing scan's clock, when the audit is running inside one.
 *
 * Passed in rather than looked up. The lookup was `currentScanContext()` from
 * `lib/observability/context`, which is built on AsyncLocalStorage and
 * `node:crypto` — so this module, and through it the entire audit, could not be
 * loaded outside a Node server at all. The dependency was real but it was
 * one-directional and tiny: two numbers. `lib/audit/server-run.ts` supplies
 * them; a browser has no scan to belong to and supplies nothing.
 */
export interface AuditScanClock {
  /** When the enclosing route started — the 51s line is a route budget, not an audit one. */
  startedAt: number;
  /** The route's own terminal cutoff, which always wins when tighter. */
  remainingMs(): number;
}

export interface AuditBudget {
  rpcRemaining(): number;
  explorerRemaining(): number;
  /**
   * What the audit actually SPENT. `scan_runs.audit_extra_rpc_calls` /
   * `audit_explorer_calls` are these two numbers; without them a truncated
   * audit is indistinguishable from one that never ran (CLAUDE.md §8 #9).
   */
  rpcUsed(): number;
  explorerUsed(): number;
  /** Milliseconds left before the audit's own cutoff; never negative-clamped so callers can see how far over. */
  msRemaining(): number;
  /** True once any budget is exhausted — callers must stop starting new work, not abort in-flight work. */
  exceeded(): boolean;
  recordRpcCall(): void;
  recordExplorerCall(): void;
}

/**
 * One budget instance per audit run (created once by `runContractAuthorityAudit`
 * in M8 and threaded through every resolver/probe call). Fails safe: exceeding
 * any limit is a signal to stop starting new work and report `partial`/
 * `unresolved`, never a reason to throw or to silently keep going over budget.
 */
export function createAuditBudget(scan?: AuditScanClock | null): AuditBudget {
  const maxRpc = auditMaxExtraRpcCalls();
  const maxExplorer = auditMaxExplorerCalls();
  const startedAt = scan?.startedAt ?? Date.now();
  let rpcUsed = 0;
  let explorerUsed = 0;

  const msRemaining = () => {
    const ownBudget = auditWallClockCutoffMs() - (Date.now() - startedAt);
    // The shared scan deadline (M13) always wins when tighter — it's the
    // route's real terminal cutoff, not just the audit's own guess at one.
    return scan ? Math.min(ownBudget, scan.remainingMs()) : ownBudget;
  };

  return {
    rpcRemaining: () => maxRpc - rpcUsed,
    explorerRemaining: () => maxExplorer - explorerUsed,
    rpcUsed: () => rpcUsed,
    explorerUsed: () => explorerUsed,
    msRemaining,
    exceeded: () => rpcUsed >= maxRpc || explorerUsed >= maxExplorer || msRemaining() <= 0,
    recordRpcCall: () => {
      rpcUsed += 1;
    },
    recordExplorerCall: () => {
      explorerUsed += 1;
    },
  };
}
