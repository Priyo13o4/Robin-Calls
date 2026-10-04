/**
 * Stable application error codes (PRD §20.2).
 *
 * Every reportable failure carries one machine code from this registry so
 * dashboards, tests, and alerts match on identity instead of message strings.
 * Codes are append-only: renaming or deleting one breaks historical
 * fingerprints, so deprecate in the comment and add a new code instead.
 */

export type ErrorCategory =
  | "rpc"
  | "market"
  | "explorer"
  | "db"
  | "ledger"
  | "scan"
  | "config"
  | "auth"
  | "admin"
  | "job"
  | "client"
  | "agent";

export type ErrorSeverity = "WARN" | "ERROR" | "FATAL";

export interface ErrorCodeSpec {
  category: ErrorCategory;
  /** Default severity; reportError may override per occurrence. */
  severity: ErrorSeverity;
  /** Whether the failed operation is generally safe to retry. */
  retryable: boolean;
}

export const ERROR_CODES = {
  // ── RPC providers ──
  RC_RPC_TIMEOUT: { category: "rpc", severity: "ERROR", retryable: true },
  RC_RPC_RATE_LIMITED: { category: "rpc", severity: "WARN", retryable: true },
  RC_RPC_TRANSPORT: { category: "rpc", severity: "ERROR", retryable: true },
  RC_RPC_INVALID_RESPONSE: { category: "rpc", severity: "ERROR", retryable: false },
  RC_RPC_NO_HEALTHY_PROVIDER: { category: "rpc", severity: "FATAL", retryable: false },
  RC_RPC_SATURATED: { category: "rpc", severity: "WARN", retryable: true },
  RC_RPC_WRONG_CHAIN: { category: "config", severity: "FATAL", retryable: false },
  /** The scan's RPC-dependent facts (pool-set discovery, liquidity-pull
   *  history) could not be resolved — the no-verdict gate for RPC faults,
   *  mirroring RC_EXPLORER_UNAVAILABLE (see docs/KNOWN-PROBLEMS.md A1). */
  RC_RPC_UNAVAILABLE: { category: "rpc", severity: "WARN", retryable: true },

  // ── Market data providers (DexScreener / GeckoTerminal) ──
  RC_MARKET_TIMEOUT: { category: "market", severity: "WARN", retryable: true },
  RC_MARKET_RATE_LIMITED: { category: "market", severity: "WARN", retryable: true },
  RC_MARKET_UNAVAILABLE: { category: "market", severity: "ERROR", retryable: true },
  RC_MARKET_INVALID_RESPONSE: { category: "market", severity: "ERROR", retryable: false },

  // ── Explorer (Blockscout) ──
  RC_EXPLORER_UNAVAILABLE: { category: "explorer", severity: "WARN", retryable: true },

  // ── Database / persistence ──
  RC_DB_UNCONFIGURED: { category: "db", severity: "WARN", retryable: false },
  RC_DB_READ_FAILED: { category: "db", severity: "ERROR", retryable: true },
  RC_DB_WRITE_FAILED: { category: "db", severity: "ERROR", retryable: true },

  // ── Ledger hash chain ──
  RC_LEDGER_APPEND_FAILED: { category: "ledger", severity: "ERROR", retryable: true },
  RC_LEDGER_FORK_RETRY_EXHAUSTED: { category: "ledger", severity: "FATAL", retryable: false },
  RC_LEDGER_MARK_PERSIST_FAILED: { category: "ledger", severity: "ERROR", retryable: true },
  RC_LEDGER_FOLLOWUP_FAILED: { category: "ledger", severity: "ERROR", retryable: true },

  // ── Scan pipeline (domain rejections carry codes too — they are not
  //    application errors, but the route maps them to responses by code) ──
  RC_SCAN_INVALID_ADDRESS: { category: "scan", severity: "WARN", retryable: false },
  RC_SCAN_NOT_CONTRACT: { category: "scan", severity: "WARN", retryable: false },
  RC_SCAN_POOL_INPUT: { category: "scan", severity: "WARN", retryable: false },
  RC_SCAN_NOT_TOKEN: { category: "scan", severity: "WARN", retryable: false },
  RC_SCAN_PIPELINE_FAILED: { category: "scan", severity: "ERROR", retryable: true },
  RC_SCAN_SNAPSHOT_WRITE_FAILED: { category: "scan", severity: "WARN", retryable: true },
  RC_SCAN_DISABLED: { category: "scan", severity: "WARN", retryable: false },
  RC_SCAN_FRESH_PAUSED: { category: "scan", severity: "WARN", retryable: true },
  RC_SCAN_CAPACITY_EXCEEDED: { category: "scan", severity: "WARN", retryable: true },
  RC_SCAN_COORDINATION_UNAVAILABLE: { category: "scan", severity: "ERROR", retryable: true },
  /** Route-level terminal deadline hit before a verdict resolved — a
   *  route/runtime budget fact, never mapped to "the chain did not answer". */
  RC_SCAN_DEADLINE_EXCEEDED: { category: "scan", severity: "WARN", retryable: true },

  // ── Configuration ──
  RC_CONFIG_INVALID: { category: "config", severity: "FATAL", retryable: false },
  /** Share-card artwork missing from the bundle — a build/tracing fault, not a
   *  render fault: the card still ships, just without its plate. */
  RC_OG_BACKGROUND_UNAVAILABLE: { category: "config", severity: "WARN", retryable: true },
  /** The sale address holds no contract on the resolved chain: a config
   *  error, almost always a missing token_sale_chain_id row. */
  RC_SALE_NO_CONTRACT: { category: "config", severity: "ERROR", retryable: false },

  // ── Jobs / admin ──
  RC_JOB_FAILED: { category: "job", severity: "ERROR", retryable: true },
  /** The pool depth sweep read no pools: the route graph catalogue is missing or the DB is unset. */
  RC_POOL_DEPTH_EMPTY: { category: "job", severity: "ERROR", retryable: true },
  /** Post-deploy ISR warm-up could not invalidate a prerendered route, so it
   *  keeps serving the empty snapshot baked at image-build time. */
  RC_ISR_REVALIDATE_FAILED: { category: "job", severity: "ERROR", retryable: true },
  RC_TRACKER_DISCOVERY_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** One launchpad's curve sync failed; the poll continues with other pads. */
  RC_CURVE_SYNC_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** The hourly recount found a launch event the registry never recorded (ARCHITECTURE.md §6.3). */
  RC_LAUNCH_RECOUNT_MISMATCH: { category: "job", severity: "ERROR", retryable: false },
  /** Pool-appearance graduation check faulted for one token (retried next poll). */
  RC_CURVE_POOL_CHECK_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** The rug confirmation sweep's UPDATE threw. Suspicions stay pending and
   *  retry; reported rather than returning [] so a dead sweep is not read as
   *  "nothing was rugged" (§4). */
  RC_CURVE_RUG_CONFIRM_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** One of the curve poll's four end-of-tick sweeps threw. The others in the
   *  same tick still ran — they used to be four bare awaits, so the first
   *  failure cancelled the rest. */
  RC_CURVE_SWEEP_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** L106 — the launcher-vs-relayer count faulted, so attribution stood down. */
  RC_CURVE_LAUNCH_COUNT_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** The pool sweep could not advance `curve_tokens.last_pool_check_at`. Its
   *  own rotation key: while this keeps failing the sweep re-selects the same
   *  rows every tick and every other eligible token starves. Distinct from
   *  RC_CURVE_POOL_CHECK_FAILED, which is one token's discovery faulting. */
  RC_CURVE_SWEEP_CLOCK_STUCK: { category: "job", severity: "WARN", retryable: true },
  /** Same token address claimed by two different registered launchpads — the
   *  merge rejects rather than picking one; needs an admin to resolve. */
  RC_LAUNCH_PROVENANCE_CONFLICT: { category: "job", severity: "WARN", retryable: false },
  /** recordStalledCurves' UPDATE threw — the stall sweep skipped this tick
   *  rather than silently reporting zero stalls (curve/lifecycle rebuild §5.1d). */
  RC_CURVE_STALL_SWEEP_FAILED: { category: "job", severity: "WARN", retryable: true },
  /** A launch_candidates row was pulled off the feed (RUGGED / STALLED /
   *  BELOW_THRESHOLD) via the dedicated demotion path — visibility only,
   *  never a value the scan verdict reads. */
  RC_LAUNCH_CANDIDATE_DEMOTED: { category: "job", severity: "WARN", retryable: false },
  /** The unified curve walker's cursor was older than the retention floor and
   *  got jumped forward — never silent, per curve/lifecycle rebuild §5.5. */
  RC_CURVE_CURSOR_FLOORED: { category: "job", severity: "WARN", retryable: false },
  /** The funding-web trace chained off a fresh indictment failed. The rug row
   *  itself still stands — a stain is an enrichment, never a precondition — so
   *  this is a WARN, and the next wanted-ingest tick retries it. */
  RC_LINEAGE_TRACE_FAILED: { category: "job", severity: "WARN", retryable: true },
  RC_ADMIN_ACTION_FAILED: { category: "admin", severity: "ERROR", retryable: false },

  /** A browser-submitted contribution claim verified against the chain, but
   *  the mirror write that follows it threw. The claim stays pending and the
   *  reconciler retries the whole write, so ERROR + retryable: nothing is
   *  lost, but the user's code is late until it lands. */
  RC_CONTRIBUTION_CLAIM_WRITE_FAILED: { category: "job", severity: "ERROR", retryable: true },

  // ── Internal contract for the FastAPI agent plane ──
  /** A `lib/internal/reads.ts` read threw inside the dispatcher. Reported (not
   *  swallowed into an empty 200) because the agent must be able to tell "no
   *  record" from "we could not look" — CLAUDE.md §4. Carries the caller's
   *  `x-rc-trace-id` in `details`, which is the join key between an agent
   *  conversation and this sink.
   *
   *  `agent`, not `db`: this dispatcher fronts database reads, RPC reads AND
   *  `get_methodology`, which is pure config and touches neither. Filed under
   *  `db` it put an RPC outage — or a config parse error — in the database
   *  fault bucket, which is how a dashboard sends you to look at Postgres
   *  during an Alchemy incident. The layer is what this code identifies; what
   *  failed underneath is in the message. */
  RC_INTERNAL_READ_FAILED: { category: "agent", severity: "ERROR", retryable: true },
  /** Prod -> local-smoke sync (/api/sync/v1, lib/sync/): a page read on prod or an upsert locally failed. */
  RC_SYNC_FAILED: { category: "db", severity: "WARN", retryable: true },

  // ── Agent plane (services/agent, Python) ──
  //
  // These are emitted BY the Python process and travel on the wire in tool
  // payloads; nothing in this TypeScript process calls `reportError` with
  // them. They live here anyway because this registry is the vocabulary —
  // §20.2 says every reportable failure carries one code *from this file*, and
  // an operator reading `RC_AGENT_UPSTREAM_TIMEOUT` out of a container log
  // needs somewhere to look it up. `tests/agent-internal-contract.test.ts`
  // and `services/agent/tests/test_registry.py` pin the two lists together in
  // both directions, because a code that exists on only one side is exactly
  // the silent drift this registry exists to prevent.
  //
  // `retryable` here is the same judgement the payload's `transient` flag
  // carries, and the two must agree: a retryable code describes our
  // infrastructure, never the token.

  /** FastAPI→Next timed out. Transient by construction — the scan pipeline can
   *  legitimately run for minutes, so this must never be read as a verdict. */
  RC_AGENT_UPSTREAM_TIMEOUT: { category: "agent", severity: "WARN", retryable: true },
  /** FastAPI could not reach Next at all (DNS, connection refused, reset). */
  RC_AGENT_UPSTREAM_UNREACHABLE: { category: "agent", severity: "ERROR", retryable: true },
  /** Next answered with a body that is not JSON — typically a proxy error page.
   *  Not parsed and not passed to the model: an HTML error page handed over as
   *  data is a failure wearing the shape of an answer. */
  RC_AGENT_UPSTREAM_INVALID: { category: "agent", severity: "ERROR", retryable: true },
  /** A browser-computed tool result failed provenance verification (wrong
   *  chain, missing block number, stale head, off-allowlist endpoint).
   *  NOT retryable: the result was well-formed enough to arrive and wrong
   *  enough to refuse, so the same endpoint reproduces it. */
  RC_AGENT_PROVENANCE_REJECTED: { category: "agent", severity: "WARN", retryable: false },
  /** The browser's own RPC call failed before it could produce a result.
   *  Retryable and, from the model's point of view, an outage — not a finding. */
  RC_AGENT_CLIENT_TOOL_FAILED: { category: "agent", severity: "WARN", retryable: true },
  /** The per-turn tool-call ceiling was reached. A budget, not a fault: the
   *  model is told to answer with what it has and say what it could not check. */
  RC_AGENT_TOOL_BUDGET: { category: "agent", severity: "WARN", retryable: false },
  /** A persona asked for a tool outside its allowlist. This firing means the
   *  §9 enforcement worked — it is the boundary that stops a chat turn burning
   *  fresh-scan quota — so it is WARN, not ERROR. */
  RC_AGENT_TOOL_DENIED: { category: "agent", severity: "WARN", retryable: false },
  /** The model named a tool that does not exist. */
  RC_AGENT_UNKNOWN_TOOL: { category: "agent", severity: "WARN", retryable: false },
  /** Our-models chat is not configured (no ANTHROPIC_API_KEY). BYOK is
   *  unaffected — that path never reaches our process. */
  RC_AGENT_MODEL_UNAVAILABLE: { category: "agent", severity: "WARN", retryable: false },
  /** The provider call itself failed. The turn is not billed. */
  RC_AGENT_MODEL_FAILED: { category: "agent", severity: "ERROR", retryable: true },
  /** A live check has no explainer in the agent's knowledge corpus. FATAL: the
   *  agent refuses to start rather than answer "I have no information on that
   *  check" in production, which is a quality regression with no error, no
   *  alert, and nobody to file the bug. */
  RC_AGENT_KNOWLEDGE_GAP: { category: "agent", severity: "FATAL", retryable: false },
  /** The transcript was trimmed to fit the model's context window. Visibility
   *  only — the turn still answers, but it answers with less history than the
   *  user can see on screen, and that divergence must not be silent. */
  RC_AGENT_HISTORY_TRIMMED: { category: "agent", severity: "WARN", retryable: false },

  // ── Log ingestion self-protection ──
  RC_LOG_INGEST_REJECTED: { category: "client", severity: "WARN", retryable: false },
  /** A Report-Only CSP directive would have blocked a resource. WARN, not
   *  ERROR: in Report-Only nothing broke — this is survey data for the policy
   *  that will be enforced later. */
  RC_CSP_VIOLATION: { category: "client", severity: "WARN", retryable: false },
  /** RETIRED (migration 0044) — no longer emitted. Kept so historical
   *  app_error_events rows still resolve to a spec. It meant "too large to
   *  cache, so this pool cold-fills every scan"; the durable store never
   *  refuses a write, so that outcome no longer exists. */
  RC_LOG_INDEX_CACHE_OVERSIZE: { category: "job", severity: "WARN", retryable: false },
  /** A single stored log index passed the size where a whole-blob
   *  read-modify-write stops being cheap — the signal to normalize to one row
   *  per event (lib/data/log-index). The value IS still stored: this is
   *  visibility, never a refusal. */
  RC_LOG_INDEX_OVERSIZE: { category: "job", severity: "WARN", retryable: false },
  /** A pool_log_index row exists but cannot be used (unparseable last_block, or
   *  rows is not an array). Distinguished from a cold start ON PURPOSE: absence
   *  is normal and free, but a corrupt row means this pool re-fills from the
   *  explorer on every scan forever, and that must not be silent. */
  RC_LOG_INDEX_UNREADABLE: { category: "job", severity: "ERROR", retryable: false },
  /** L41 — the balanceOf/oracle coverage measurement itself faulted. The scan
   *  keeps the adapter-reported completeness rather than manufacturing either
   *  polarity from a transport fault, so this is visibility on a blind spot,
   *  not a verdict input. */
  RC_V4_COVERAGE_FAULT: { category: "scan", severity: "WARN", retryable: true },
  /** D3 — the PoolManager holds a large share of a token outside every V4 pool we
   *  know: usually a hole in v4_pools. Visibility only, never a verdict input. */
  RC_V4_POOL_TABLE_GAP: { category: "scan", severity: "WARN", retryable: false },
  /** D1 — the V4 pool backfill could not advance (window floor or undecodable rows). */
  RC_V4_BACKFILL_WINDOW_FLOOR: { category: "job", severity: "ERROR", retryable: false },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function errorCodeSpec(code: ErrorCode): ErrorCodeSpec {
  return ERROR_CODES[code];
}
