/**
 * Shared retry policy for explorer HTTP reads — used by both
 * `lib/explorer/blockscout.ts` (Blockscout REST v2) and
 * `lib/explorer/logs.ts` (the Etherscan-compatible logs API).
 *
 * WHY 429 NEEDS ITS OWN POLICY (audit A3). Blockscout throttles at roughly
 * ~37 req/min sustained. A scan bursts parallel reads (holders + address
 * history + one log index per pool per DEX), so several land in the same
 * second and a subset come back 429. The old policy — 2 attempts, a flat 400ms
 * gap, 429 treated identically to a 5xx — exhausts both attempts in under a
 * second while the throttle window is still open, records RATE_LIMITED, and
 * that trips `explorerFaulted()`, which voids the WHOLE scan (pipeline.ts's
 * hard gate). A transient throttle thereby became a 503.
 *
 * That is the §4/§8 hazard inverted: not a false "clean", but a false "outage".
 * The cure is to actually wait a throttle out — respect the server's
 * `Retry-After` when present, otherwise seconds-scale exponential backoff, more
 * attempts — all bounded by a hard ceiling. The ceiling is deliberate: a 429
 * that survives real backoff is a genuinely-unreadable explorer, and that MUST
 * still degrade and trip the latch (better a 503 than an optimistic verdict —
 * the latch semantics are unchanged by this module; only the road to it is).
 *
 * 5xx and network faults keep the old fast retry: they are not throttles, so
 * waiting seconds buys nothing and only burns the route's time budget.
 */

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 429 gets more, slower attempts — enough to outlast a throttle window. */
const RATE_LIMIT_ATTEMPTS = intEnv("EXPLORER_RATE_LIMIT_ATTEMPTS", 4);
const RATE_LIMIT_BASE_MS = intEnv("EXPLORER_RATE_LIMIT_BASE_MS", 800);
/** Hard ceiling on any single wait. A throttle that wants longer than this is
 *  treated as a persistent outage: we stop retrying and let the read degrade. */
const RATE_LIMIT_CAP_MS = intEnv("EXPLORER_RATE_LIMIT_CAP_MS", 6_000);
/**
 * 5xx / network (KNOWN-PROBLEMS L59). The 400ms/2-attempt policy this replaced
 * was sized for a quick blip; measured 2026-08-28 with 3 independent concurrent
 * bursts (10/20/15-way, 45 calls total) against the real PRO gateway with a real
 * key, the fault this bucket actually absorbs is saturation, not a blip: 30/45
 * calls got a fast 429 (already handled below), but the other 15 either
 * succeeded slowly — 3.6s to 12.0s, not milliseconds — or hit a bare timeout
 * with no response at all. A 400ms gap cannot land after a congestion window
 * that takes the sibling calls several seconds to clear; it just retries into
 * the same saturation. Sized to plausibly outlast it without one route eating
 * multiple 15s hard-timeouts (`fetchOnce`'s `AbortSignal.timeout`) back to back.
 */
const TRANSIENT_ATTEMPTS = intEnv("EXPLORER_TRANSIENT_ATTEMPTS", 3);
const TRANSIENT_BACKOFF_MS = intEnv("EXPLORER_TRANSIENT_BACKOFF_MS", 2_000);

export type ExplorerFailureKind = "rate-limited" | "server-error" | "network" | "fatal";

/**
 * Classify a failed explorer response. `undefined` status means the request
 * threw before a response (timeout / socket) — a network fault. A non-429 4xx
 * (including 404) is a definitive answer, never retried here.
 */
export function classifyExplorerFailure(status: number | undefined): ExplorerFailureKind {
  if (status === undefined) return "network";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server-error";
  return "fatal";
}

/**
 * Parse an HTTP `Retry-After` header to milliseconds. Accepts both forms the
 * spec allows: a delta in seconds (`"3"`) or an HTTP date. `nowMs` is passed in
 * (never read from the clock here) so the decision is deterministic and
 * unit-testable. Returns null when absent or unparseable.
 */
export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number,
): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  // A bare integer is a seconds delta. Guard against the date form also parsing
  // as a number on some engines by requiring digits-only.
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed) * 1000);
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

export interface RetryPlan {
  /** Whether to attempt the call once more. */
  retry: boolean;
  /** How long to wait before that next attempt (0 when not retrying). */
  delayMs: number;
}

/**
 * Decide whether to retry a failed explorer call and how long to wait first.
 *
 * `attempt` is 1-based and names the attempt that JUST failed (so the first
 * failure is `attempt: 1`). Pure and deterministic given `nowMs`.
 */
export function planExplorerRetry(opts: {
  status?: number;
  attempt: number;
  retryAfter?: string | null;
  nowMs: number;
}): RetryPlan {
  const kind = classifyExplorerFailure(opts.status);
  if (kind === "fatal") return { retry: false, delayMs: 0 };

  if (kind === "rate-limited") {
    if (opts.attempt >= RATE_LIMIT_ATTEMPTS) return { retry: false, delayMs: 0 };
    const backoff = Math.min(RATE_LIMIT_CAP_MS, RATE_LIMIT_BASE_MS * 2 ** (opts.attempt - 1));
    const header = parseRetryAfterMs(opts.retryAfter, opts.nowMs);
    // Honor Retry-After when it asks for MORE than our own backoff, but never
    // wait past the cap — a throttle that wants minutes is a persistent outage.
    const delayMs = Math.min(RATE_LIMIT_CAP_MS, Math.max(backoff, header ?? 0));
    return { retry: true, delayMs };
  }

  // server-error | network: the original fast retry.
  if (opts.attempt >= TRANSIENT_ATTEMPTS) return { retry: false, delayMs: 0 };
  return { retry: true, delayMs: TRANSIENT_BACKOFF_MS };
}
