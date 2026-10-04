import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { classifyPath, checkRateLimit } from "@/lib/security/ratelimit";
import { clientIpFromHeaders } from "@/lib/security/client-ip";

/**
 * Proxy (Next.js 16 renamed the `middleware` convention to `proxy`). Always
 * runs on the Node.js runtime in this Next version — no Edge/Node split to
 * configure (Next 16.2.10 rejects a `runtime` key in `config` here: "Proxy
 * always runs on Node.js runtime"). That's what makes ioredis's raw TCP
 * socket usable in lib/security/ratelimit.ts with zero extra config.
 *
 * Two jobs:
 *   1. Gate /admin/* — cheap session-cookie presence check (no DB call). The
 *      authoritative role check still happens per-page via requireAdmin().
 *   2. Per-IP rate limiting on the public API surface (no-op until Valkey is
 *      configured — see lib/security/ratelimit.ts).
 */

function clientIp(req: NextRequest): string {
  return clientIpFromHeaders(req.headers) ?? "anon";
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 1. Admin gate ──────────────────────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (pathname === "/admin/login") return NextResponse.next();
    const sessionCookie = getSessionCookie(req);
    if (!sessionCookie) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("from", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── 2. Rate limiting ───────────────────────────────────────────
  const cls = classifyPath(pathname);
  if (cls) {
    const result = await checkRateLimit(cls, clientIp(req));
    if (result && !result.ok) {
      const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
      // The number was already computed for the `Retry-After` header below —
      // it just never reached the body, so every caller that reads `.error`
      // (the whitelist modal included) could only ever show "shortly".
      return NextResponse.json(
        { error: `Rate limit exceeded. Retry in ${retryAfter}s.`, retryAfterSeconds: retryAfter },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(result.limit),
            "X-RateLimit-Remaining": String(result.remaining),
            "X-RateLimit-Reset": String(result.reset),
          },
        }
      );
    }
  }

  return NextResponse.next();
}

/**
 * The matcher decides where this proxy runs at all, so it must stay a
 * superset of every path `classifyPath` knows about — a rule that classifies
 * a path the matcher excludes is dead code, not a rate limit.
 *
 * Two such gaps existed here: `/api/whitelist` matches only that exact path,
 * so the nine X/Telegram OAuth sub-routes (including `x/task` and
 * `telegram/recheck`, which spend external API quota) were never limited
 * despite having dedicated budgets; and `/api/scan/<address>/traders`, which
 * calls GeckoTerminal on every miss, was not listed at all.
 */
export const config = {
  matcher: [
    "/admin/:path*",
    "/api/scan",
    // Covers /api/scan/<address>/traders.
    "/api/scan/:path*",
    "/api/ecosystem/submit",
    "/api/ecosystem/platforms",
    // Browser-sent CSP violation reports — an open POST sink, so the budget
    // only exists if the proxy runs here.
    "/api/csp-report",
    "/api/stats",
    "/api/og/:path*",
    "/api/og-proxy",
    "/api/rwa/icon",
    "/api/rwa/price",
    "/api/rwa/feed",
    "/api/rwa/official-assets",
    "/api/whitelist",
    // Covers the X and Telegram onboarding sub-routes.
    "/api/whitelist/:path*",
    "/api/quote",
    "/api/swap/plan",
    "/api/swap/routes",
    "/api/swap/security/:path*",
    // Covers /api/wanted/token/<address>, the sign-time cross-check.
    "/api/wanted/:path*",
    // BOTH entries: a bare "/api/referrals" matches only that exact path, so
    // the sub-routes — including the two signature-verifying writes — would be
    // unmetered without the second one. Same gap that left nine OAuth
    // sub-routes open.
    "/api/referrals",
    "/api/referrals/:path*",
    // L89 — public, force-dynamic, DB-backed. A class without a matcher entry
    // is dead code, so these three must be added in BOTH places or neither.
    "/api/site-config",
    "/api/launches",
    "/api/ledger",
    "/api/tokens",
    "/api/dexscreener/:path*",
    // Covers senders, wallets, liquidity, and the RPC-backed lp-custody check.
    "/api/trades/:path*",
    "/api/hooks",
    "/api/sync/:path*",
  ],
};
