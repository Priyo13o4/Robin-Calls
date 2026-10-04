import { redisClient } from "../redis/client";

/**
 * Per-IP rate limiting for the public API surface. Sliding-window-log counters
 * in self-hosted Valkey (ioredis, RESP — proxy.ts runs the Node.js runtime so
 * a TCP client works here too; see next.config.ts).
 *
 * GRACEFUL NO-OP: when REDIS_URL isn't set, every check returns null and the
 * caller lets the request through. So a fresh deploy runs fine with zero
 * rate-limit infra; you turn it on by adding the one env var.
 */

// Per-class budgets. Kept intentionally generous for humans, tight enough to
// blunt scripted abuse.
const WINDOWS = {
  /** The scan pipeline is the expensive one (RPC + honeypot sim). */
  scan: { limit: 8, windowMs: 60_000 },
  /** Public "list your platform" form. */
  submit: { limit: 3, windowMs: 3_600_000 },
  /** Cheap read endpoints (stats, OG cards). */
  read: { limit: 60, windowMs: 60_000 },
  /** Whitelist onboarding — mutations require a wallet signature, but the
   *  route still gets hit with junk without a per-IP cap. Also covers the X
   *  OAuth sub-routes (start/callback/session). */
  whitelist: { limit: 10, windowMs: 60_000 },
  /** X onboarding task attestations (/api/whitelist/x/task). No X API quota
   *  at stake anymore (tasks are intent links), but keep the tight cap: a user
   *  legitimately fires 3 (follow/like/post) plus the odd retry; anything past
   *  that is scripted junk. */
  xtask: { limit: 6, windowMs: 60_000 },
  /** Browser-sent CSP violation reports. Unauthenticated and uncredentialed by
   *  spec, so it is an open POST sink; one page load can legitimately fire
   *  several, and a broken policy fires many, hence the loose cap. */
  report: { limit: 30, windowMs: 60_000 },
  /** Swap router Phase 1 quotes (docs/cross-dex-router/WAYS-OF-WORK.md) —
   *  discovery + N pool reads per call, comparable RPC cost to `scan` (no
   *  DB write, no scan-coordination lock, hence a slightly looser cap). */
  quote: { limit: 12, windowMs: 60_000 },
  /** Swap plan: multiple RPC reads, eth_simulateV1, and an outbound Sushi
   *  call. Unauthenticated and third-party bound, requiring its own budget
   *  to prevent amplification attacks (CLAUDE.md §6). */
  swapPlan: { limit: 10, windowMs: 60_000 },
  /** Swap route candidates: an in-memory graph lookup, no RPC. Looser than swapPlan because the
   *  browser asks once per quote and once more when every first-page route fails. */
  swapRoutes: { limit: 30, windowMs: 60_000 },
  /** Stock/ETF logos (/api/rwa/icon). /rwa renders ~200 items in one view, each
   *  loading an icon, so it needs burst room the general `read` budget cannot
   *  give without starving stats and OG cards. Cheap per call — a lookup against
   *  a static logo host, cached downstream (Cache-Control max-age=86400). */
  icon: { limit: 300, windowMs: 60_000 },
  /** Referral MUTATIONS (bind a code, set a nickname). Signature-gated, so
   *  junk still costs us an ECDSA recover before it is rejected — the reason
   *  they are not on the `read` budget with the referral GETs. A real user
   *  binds once and renames themselves once or twice; anything past that is
   *  scripted. The reads (`/api/referrals`, `/code`, `/leaderboard`) are plain
   *  DB lookups of the same shape as /api/stats and share `read`. */
  referral: { limit: 8, windowMs: 60_000 },
  /** Contribution claims (/api/referrals/contribute). Ungated by signature on
   *  purpose (the receipt is the proof), so every request costs a receipt
   *  read plus a block read against the sale's chain before the idempotency
   *  check can even answer. A real user submits once per contribution and
   *  resubmits only on a page reload; the limit covers a handful of retries
   *  plus the reconciler's overlap without leaving the `read` budget for a
   *  stranger to drain with bogus hashes. */
  referralClaim: { limit: 20, windowMs: 60_000 },
  /** Trade ticker wallets from the sequencer relay (/api/trades/<t>/senders). Valkey only; one call per 3 s tick per tab. */
  tradeSenders: { limit: 60, windowMs: 60_000 },
  /** Trade pane wallet tags (/api/trades/<t>/wallets). RPC-backed: one multicall plus up to 20
   *  nonce reads per call. The pane asks at most every 5 s per tab. */
  tradeWallets: { limit: 20, windowMs: 60_000 },
  /** Recorded pool liquidity (/api/trades/<t>/liquidity). Valkey only; about one call per page load. */
  tradeLiquidity: { limit: 30, windowMs: 60_000 },
  /** Live LP custody. The card, banner and LP rows each poll while a pool hydrates; completes are cached 60s per pool. */
  tradeLpCustody: { limit: 30, windowMs: 60_000 },
  /** Prod -> local-smoke sync (/api/sync/v1/<table>). Signed; one puller pages ~20/min idle, faster while catching up. */
  sync: { limit: 120, windowMs: 60_000 },
} as const;

export type LimitClass = keyof typeof WINDOWS;

/** True only when Valkey is configured; otherwise every check is a no-op. */
export const rateLimitEnabled = Boolean(process.env.REDIS_URL);

export interface RateResult {
  ok: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds when the window resets. */
  reset: number;
}

/**
 * Sliding-window log: a sorted set per (class, id) scored by request
 * timestamp. Trims anything older than the window, then admits iff the
 * remaining count is under limit. One round trip, atomic.
 *
 * KEYS[1] = zset key. ARGV: now(ms), windowMs, limit.
 * Returns {ok(1/0), remaining, resetMs}.
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, now .. '-' .. tostring(math.random(1, 1000000000)))
  redis.call('PEXPIRE', key, window)
  return {1, limit - count - 1, now + window}
end
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset = now + window
if oldest[2] then reset = tonumber(oldest[2]) + window end
return {0, 0, reset}
`;

/**
 * Returns a rate result, or `null` when limiting is disabled (let it through).
 * `id` should be a stable per-caller key — we use the client IP.
 */
export async function checkRateLimit(
  cls: LimitClass,
  id: string
): Promise<RateResult | null> {
  const redis = redisClient();
  if (!redis) return null;
  const { limit, windowMs } = WINDOWS[cls];
  const key = `rc:rl:${cls}:${id}`;
  try {
    const [ok, remaining, reset] = (await redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      Date.now(),
      windowMs,
      limit
    )) as [number, number, number];
    return { ok: ok === 1, limit, remaining, reset };
  } catch {
    // Fail open: a Valkey blip must not take down the public API surface.
    return null;
  }
}

// Gives back the newest slot, at most `maxRefunds` per window, so aborting every request
// cannot buy unlimited work: the worst case is limit + maxRefunds per window.
const REFUND_SCRIPT = `
local used = tonumber(redis.call('GET', KEYS[2]) or '0')
if used >= tonumber(ARGV[2]) then return 0 end
if redis.call('ZCARD', KEYS[1]) == 0 then return 0 end
redis.call('ZPOPMAX', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[1])
return 1
`;

/**
 * Return one request to the caller's budget: a swap quote the browser replaced before it
 * finished (the user was still typing). Best effort; a Valkey blip keeps the slot spent.
 */
export async function refundRateLimit(cls: LimitClass, id: string, maxRefunds: number): Promise<boolean> {
  const redis = redisClient();
  if (!redis) return false;
  const { windowMs } = WINDOWS[cls];
  try {
    return (await redis.eval(REFUND_SCRIPT, 2, `rc:rl:${cls}:${id}`, `rc:rl:${cls}:refund:${id}`, windowMs, maxRefunds)) === 1;
  } catch {
    // Keeping the slot spent is the safe failure: it only makes the budget tighter.
    return false;
  }
}

/** Map a request path to its rate-limit class, or null if it isn't limited. */
export function classifyPath(pathname: string): LimitClass | null {
  if (pathname === "/api/scan") return "scan";
  // Top-traders enrichment: unauthenticated, and every cache miss costs a DB
  // read plus a GeckoTerminal call, so it needs a per-IP cap. Deliberately
  // the cheap `read` budget and not `scan` — it mints no verdict, and it must
  // not be able to exhaust a caller's scan allowance.
  if (pathname.startsWith("/api/scan/") && pathname.endsWith("/traders")) return "read";
  if (pathname.startsWith("/api/scan/") && pathname.endsWith("/holders")) return "read";
  if (pathname === "/api/ecosystem/submit") return "submit";
  if (pathname === "/api/ecosystem/platforms") return "read";
  // CSP reports. Its own class, not `read`: it is a POST sink a hostile page
  // can point at us, and it must never consume a real reader's budget.
  if (pathname === "/api/csp-report") return "report";
  // `/api/mcp` and its `mcp` class were retired with the TypeScript MCP server
  // (2026-08-02). MCP now lives at `/mcp` on the FastAPI agent plane, which
  // nginx routes to a different upstream entirely — so this proxy never sees
  // it and a class here would have been dead code, which is the exact defect
  // the coverage test below exists to catch.
  if (pathname === "/api/stats") return "read";
  if (pathname.startsWith("/api/og/")) return "read";
  if (pathname === "/api/og-proxy") return "read";
  // Static logo lookup. Bursts (one request per rendered card), but cheap and cached.
  if (pathname === "/api/rwa/icon") return "icon";
  if (pathname === "/api/rwa/price") return "read";
  // X onboarding: the API-quota-spending action route gets its own tight
  // budget; the other OAuth sub-routes (start/callback/session) share the
  // general whitelist cap. Checked before the exact match below since these
  // are longer, more specific paths.
  if (pathname === "/api/whitelist/x/task") return "xtask";
  if (pathname.startsWith("/api/whitelist/x/")) return "whitelist";
  // Telegram onboarding: recheck hits the (free) Bot API, so give it the same
  // tight budget as x/task; the rest share the general whitelist cap.
  if (pathname === "/api/whitelist/telegram/recheck") return "xtask";
  if (pathname.startsWith("/api/whitelist/telegram/")) return "whitelist";
  if (pathname === "/api/whitelist") return "whitelist";
  if (pathname === "/api/quote") return "quote";
  if (pathname === "/api/swap/plan") return "swapPlan";
  if (pathname === "/api/swap/routes") return "swapRoutes";
  if (pathname.startsWith("/api/swap/security/")) return "read";
  // The sign-time Wanted-board cross-check. One indexed DB read, no third party, so the cheap
  // `read` budget: it must not be able to exhaust a caller's scan allowance.
  if (pathname.startsWith("/api/wanted/token/")) return "read";
  // Referrals. The writes first — they are longer, more specific paths than
  // the prefix rule below, which would otherwise swallow them into `read`.
  if (pathname === "/api/referrals/bind" || pathname === "/api/referrals/profile") return "referral";
  // Claims read the chain before idempotency can answer, so they get their own
  // cost-sized budget rather than sharing the plain-DB `read` class.
  if (pathname === "/api/referrals/contribute") return "referralClaim";
  if (pathname === "/api/referrals" || pathname.startsWith("/api/referrals/")) return "read";
  // L89 — three public DB routes that were metered by nothing. All are
  // `force-dynamic`, so every request is an origin hit and a pgbouncer round
  // trip; none discloses anything, so this is amplification/availability, not
  // a leak. `read` is the right class: cheap, and it must not eat a scan
  // allowance.
  if (pathname === "/api/site-config") return "read";
  if (pathname === "/api/launches") return "read";
  if (pathname === "/api/ledger") return "read";
  if (pathname === "/api/tokens") return "read";
  if (pathname === "/api/rwa/feed") return "read";
  if (pathname === "/api/rwa/official-assets") return "read";
  if (pathname === "/api/dexscreener/feed") return "read";
  if (pathname === "/api/hooks") return "read";
  if (/^\/api\/trades\/[^/]+\/senders$/.test(pathname)) return "tradeSenders";
  if (/^\/api\/trades\/[^/]+\/wallets$/.test(pathname)) return "tradeWallets";
  if (/^\/api\/trades\/[^/]+\/liquidity$/.test(pathname)) return "tradeLiquidity";
  if (/^\/api\/trades\/[^/]+\/lp-custody$/.test(pathname)) return "tradeLpCustody";
  if (/^\/api\/sync\/v1\/[^/]+$/.test(pathname)) return "sync";
  return null;
}
