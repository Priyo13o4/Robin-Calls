import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { classifyPath } from "../lib/security/ratelimit";
import { config } from "../proxy";

/**
 * A `classifyPath` rule only takes effect if the proxy actually runs on that
 * path. Both of these drifted apart: `/api/whitelist` matched only the exact
 * path, leaving all nine X/Telegram OAuth sub-routes unlimited, and the
 * top-traders route was in neither. Rate limits that never execute look like
 * rate limits in code review, so pin the coupling here.
 */

/** Minimal Next.js matcher semantics: `:param` = one segment, `:param*` = zero or more. */
function matcherMatches(pattern: string, pathname: string): boolean {
  const source = pattern
    .replace(/\/:[A-Za-z_]+\*/g, "(?:/.*)?")
    .replace(/\/:[A-Za-z_]+/g, "/[^/]+");
  return new RegExp(`^${source}$`).test(pathname);
}

function proxyRunsOn(pathname: string): boolean {
  return (config.matcher as string[]).some((p) => matcherMatches(p, pathname));
}

const RATE_LIMITED_PATHS = [
  "/api/scan",
  "/api/scan/0x1111111111111111111111111111111111111111/traders",
  "/api/scan/0x1111111111111111111111111111111111111111/holders",
  "/api/ecosystem/submit",
  "/api/ecosystem/platforms",
  "/api/csp-report",
  "/api/stats",
  "/api/og/123",
  "/api/og-proxy",
  "/api/rwa/icon",
  "/api/rwa/feed",
  "/api/whitelist",
  "/api/whitelist/x/start",
  "/api/whitelist/x/callback",
  "/api/whitelist/x/session",
  "/api/whitelist/x/task",
  "/api/whitelist/x/disconnect",
  "/api/whitelist/telegram/verify",
  "/api/whitelist/telegram/session",
  "/api/whitelist/telegram/recheck",
  "/api/whitelist/telegram/disconnect",
  "/api/quote",
  "/api/swap/plan",
  "/api/swap/routes",
  "/api/referrals",
  "/api/referrals/code",
  "/api/referrals/bind",
  "/api/referrals/profile",
  "/api/referrals/leaderboard",
  "/api/referrals/contribute",
  "/api/site-config",
  "/api/launches",
  "/api/trades/0x1111111111111111111111111111111111111111/senders",
  "/api/trades/0x1111111111111111111111111111111111111111/wallets",
  "/api/trades/0x1111111111111111111111111111111111111111/liquidity",
  "/api/trades/0x1111111111111111111111111111111111111111/lp-custody",
  "/api/sync/v1/launches",
  "/api/hooks",
  "/api/ledger",
  "/api/tokens",
];

// ── L89 ──
//
// The list below used to be the WHOLE test, hand-maintained, and three public
// DB routes were simply never added to it. A coverage test seeded with the
// thing whose absence is the bug can never fail on it (§8 #10). So the list
// stays — it pins the CLASS each known path gets — but it no longer decides
// what gets checked. `routesOnDisk()` does.

/** Every `app/api/**` route, as the pathname the proxy would see. */
function routesOnDisk(root = "app/api"): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "route.ts" || e.name === "route.tsx") {
        const segs = relative(root, dir).split(sep).filter((x) => x && x !== ".");
        out.push(
          "/api/" +
            segs
              // A dynamic segment stands for one real value; a catch-all for at
              // least one. Substituting a literal keeps matcher semantics honest.
              .map((x) => (x.startsWith("[...") ? "catchall" : x.startsWith("[") ? "x" : x))
              .join("/"),
        );
      }
    }
  };
  walk(root);
  return [...new Set(out)].sort();
}

/**
 * Prefixes the proxy deliberately does not meter, each with the reason. Adding
 * to this list is the ONLY way to exempt a route, and it is reviewable because
 * it is here rather than implied by an omission.
 */
const EXEMPT: { prefix: string; why: string }[] = [
  { prefix: "/api/jobs/", why: "secret-gated by requireJobAuth; pg_cron is the only caller" },
  { prefix: "/api/internal/", why: "INTERNAL_JOB_SECRET + denied at the nginx edge" },
  {
    prefix: "/api/auth/",
    why: "Better Auth owns its own limiter (enabled: isProduction, window 10, max 100). NOTE: storage falls back to 'memory' with no secondaryStorage, so the budget is per-process and multiplies by replica count; and it is OFF in development.",
  },
];

test("L89: every public API route on disk is metered — enumerated, not listed", () => {
  const unmetered: string[] = [];
  for (const pathname of routesOnDisk()) {
    if (EXEMPT.some((e) => pathname.startsWith(e.prefix))) continue;
    if (!classifyPath(pathname) || !proxyRunsOn(pathname)) unmetered.push(pathname);
  }
  assert.deepEqual(
    unmetered,
    [],
    `unmetered public route(s): ${unmetered.join(", ")}. Give each a class in classifyPath AND a matcher entry in proxy.ts — one without the other is dead code. If it is deliberately exempt, add it to EXEMPT with the reason.`,
  );
});

test("L89: the enumerator actually finds routes — a walk returning [] would pass vacuously", () => {
  // The trap in the test above: if `routesOnDisk` silently returned nothing
  // (wrong cwd, renamed dir), it would report full coverage forever.
  const found = routesOnDisk();
  assert.ok(found.length >= 15, `expected the api tree, found ${found.length}`);
  assert.ok(found.includes("/api/scan"), "sanity: the scan route must be found");
  assert.ok(found.includes("/api/ledger"), "sanity: the route L89 was filed for must be found");
});

test("L89: every exemption is load-bearing — a stale one silently unmeters a route", () => {
  for (const e of EXEMPT) {
    assert.ok(
      routesOnDisk().some((p) => p.startsWith(e.prefix)),
      `EXEMPT carries ${e.prefix} but no route on disk matches it — remove it before it excuses a future route`,
    );
    assert.ok(e.why.length > 20, `${e.prefix} needs a real reason, not a placeholder`);
  }
});

test("every classified path is actually reachable by the proxy matcher", () => {
  for (const pathname of RATE_LIMITED_PATHS) {
    assert.ok(
      classifyPath(pathname),
      `${pathname} has no rate-limit class`
    );
    assert.ok(
      proxyRunsOn(pathname),
      `${pathname} is classified but the proxy matcher excludes it — the limit would never run`
    );
  }
});

test("the top-traders route uses the cheap read budget, not the scan budget", () => {
  // It mints no verdict, and must not be able to exhaust a caller's scans.
  assert.equal(
    classifyPath("/api/scan/0x1111111111111111111111111111111111111111/traders"),
    "read"
  );
  assert.equal(classifyPath("/api/scan"), "scan");
});

test("the quota-spending onboarding actions keep their own tight budget", () => {
  assert.equal(classifyPath("/api/whitelist/x/task"), "xtask");
  assert.equal(classifyPath("/api/whitelist/telegram/recheck"), "xtask");
  assert.equal(classifyPath("/api/whitelist/x/start"), "whitelist");
});

test("swap-router quotes get their own class, not the scan budget", () => {
  assert.equal(classifyPath("/api/quote"), "quote");
});

test("live LP custody reads get a dedicated chain-read budget", () => {
  assert.equal(
    classifyPath("/api/trades/0x1111111111111111111111111111111111111111/lp-custody"),
    "tradeLpCustody"
  );
});

test("swap-router plan gets its own class, not the quote or scan budget", () => {
  assert.equal(classifyPath("/api/swap/plan"), "swapPlan");
});

test("swap route candidates get their own class: no RPC, but not the shared read budget", () => {
  assert.equal(classifyPath("/api/swap/routes"), "swapRoutes");
});

test("the rwa icon route is budgeted with its own burst class and token-icon is unclassified", () => {
  // rwa/icon bursts (one request per rendered card) but is a cheap static logo
  // lookup. The launch token icon server route was removed; client resolves directly.
  assert.equal(classifyPath("/api/rwa/icon"), "icon");
  assert.equal(classifyPath("/api/token-icon"), null);
});

test("referral writes are metered apart from referral reads", () => {
  // The writes verify a signature before they can reject anything, so junk
  // costs an ECDSA recover; the reads are plain lookups. Pinned apart so a
  // later tidy-up that folds bind/profile into `read` has to argue here first.
  assert.equal(classifyPath("/api/referrals/bind"), "referral");
  assert.equal(classifyPath("/api/referrals/profile"), "referral");
  // The claim route reads a receipt off the chain before the idempotency
  // check can answer, so it gets its own cost-sized budget — the plain-DB
  // `read` class would let a stranger drain a chain-reading route with the
  // referral reads' own allowance.
  assert.equal(classifyPath("/api/referrals/contribute"), "referralClaim");
  assert.equal(classifyPath("/api/referrals"), "read");
  assert.equal(classifyPath("/api/referrals/code"), "read");
  assert.equal(classifyPath("/api/referrals/leaderboard"), "read");
});

test("the referral matcher covers the sub-routes, not just the bare path", () => {
  // A Next matcher entry "/api/referrals" matches ONLY that path. Without the
  // ":path*" companion every referral class above is dead code.
  for (const p of ["/api/referrals", "/api/referrals/bind", "/api/referrals/leaderboard"]) {
    assert.ok(proxyRunsOn(p), `${p} is classified but the proxy matcher excludes it`);
  }
});
