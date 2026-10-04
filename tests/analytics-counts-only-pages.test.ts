import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { normalizeRoute, processLogBatch } from "../lib/data/analytics-ingest";

/**
 * The analytics dashboard must count PAGES A HUMAN OPENED, and nothing else.
 *
 * Measured against the real nginx log before this was fixed, the top two
 * "pages" on the site were `/api/og-proxy` (38 hits) and `/api/rwa/icon` (32),
 * against 19 actual page loads. Both are XHRs the ecosystem and RWA grids fire
 * once per card. `/backgrounds/*.webp`, `/scene/*.webp`, `/apple-touch-icon.png`,
 * `/site.webmanifest` and `/agent/config` were counted as pageviews too.
 *
 * These tests are derived from the FILESYSTEM rather than from a hand-written
 * list, so a route added next month is covered the day it lands. That is the
 * whole point: the old filter was a hand-written deny-list, and every surface
 * nobody remembered to add to it was silently counted.
 */

function walk(dir: string, hit: (p: string) => void) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, hit);
    else hit(full);
  }
}

/** app/**\/page.tsx -> the URL path it serves, with dynamic segments filled in. */
function realPageRoutes(): string[] {
  const routes: string[] = [];
  walk("app", (f) => {
    if (!f.endsWith("/page.tsx")) return;
    const route = f.slice("app".length, -"/page.tsx".length) || "/";
    if (route.startsWith("/admin") || route.startsWith("/dev")) return; // not audience surfaces
    // A dynamic segment is an address everywhere in this app.
    routes.push(route.replace(/\[[^\]]+\]/g, "0x117cc2133c37b721f49de2a7a74833232b3b4c0c"));
  });
  return routes;
}

function apiRoutes(): string[] {
  const routes: string[] = [];
  walk("app/api", (f) => {
    if (!/\/route\.tsx?$/.test(f)) return;
    routes.push(f.slice("app".length).replace(/\/route\.tsx?$/, "").replace(/\[[^\]]+\]/g, "1"));
  });
  return routes;
}

/** Top-level directories under public/ — every one of them serves assets. */
function publicAssetDirs(): string[] {
  return readdirSync("public").filter((n) => {
    try {
      return statSync(join("public", n)).isDirectory();
    } catch {
      return false;
    }
  });
}

test("every real page route is still counted", () => {
  const routes = realPageRoutes();
  // §8 #22: a derivation-based test must first prove it derived something.
  assert.ok(routes.length >= 15, `only found ${routes.length} page routes — the walk is broken`);
  assert.ok(routes.includes("/"), "the landing page was not among the derived routes");
  for (const r of routes) {
    assert.notEqual(normalizeRoute(r), null, `${r} is a real page but is not being counted`);
  }
});

test("no /api route is ever counted as a pageview", () => {
  const routes = apiRoutes();
  assert.ok(routes.length >= 10, `only found ${routes.length} api routes — the walk is broken`);
  // The two that actually polluted the dashboard, named so a regression is legible.
  assert.ok(routes.some((r) => r.startsWith("/api/og-proxy")), "og-proxy route not found");
  assert.ok(routes.some((r) => r.startsWith("/api/rwa/icon")), "rwa/icon route not found");
  for (const r of routes) {
    assert.equal(normalizeRoute(r), null, `${r} is an API endpoint but is counted as a pageview`);
  }
});

test("no file under any public/ asset directory is counted", () => {
  const dirs = publicAssetDirs();
  assert.ok(dirs.length >= 4, `only found ${dirs.length} public dirs — the walk is broken`);
  for (const d of dirs) {
    for (const ext of ["webp", "png", "jpg", "glb", "pdf", "svg"]) {
      assert.equal(
        normalizeRoute(`/${d}/thing.${ext}`),
        null,
        `/${d}/*.${ext} is an asset but is counted as a pageview`,
      );
    }
  }
});

test("the root-level asset files browsers request unprompted are not pageviews", () => {
  for (const p of [
    "/favicon.ico",
    "/favicon-16x16.png",
    "/favicon-32x32.png",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/site.webmanifest", // 11-char extension; a tighter length bound let this through
    "/robots.txt",
    "/sitemap.xml",
  ]) {
    assert.equal(normalizeRoute(p), null, `${p} is counted as a pageview`);
  }
});

test("the AI plane is an API, not a set of pages", () => {
  for (const p of ["/agent/config", "/agent/persona/interrogator", "/agent/chat", "/mcp"]) {
    assert.equal(normalizeRoute(p), null, `${p} is counted as a pageview`);
  }
});

test("an RSC query string never changes the verdict", () => {
  // nginx logs `$uri` (query already stripped), but a caller passing
  // `$request_uri` must not accidentally turn a page into a miss, or an asset
  // into a page.
  const addr = "0x117cc2133c37b721f49de2a7a74833232b3b4c0c";
  assert.equal(normalizeRoute(`/rwa/${addr}?_rsc=abc123`), "/rwa/[address]");
  assert.equal(normalizeRoute("/api/og-proxy?url=https://x.com"), null);
  assert.equal(normalizeRoute("/backgrounds/rwa-bg.webp?v=2"), null);
});

test("the filter fails toward NOT counting, which is the visible direction", () => {
  // A surface nobody anticipated must be excluded rather than counted. An
  // inflated number looks like success and nobody reports it; a page reading
  // zero is visible on the dashboard the same day.
  for (const invented of [
    "/api/some-endpoint-added-next-month",
    "/agent/a-new-tool",
    "/a-new-asset-directory/art.avif",
    "/_next/static/whatever",
  ]) {
    assert.equal(normalizeRoute(invented), null, `${invented} should default to excluded`);
  }
  // ...but a plain new PAGE path still counts, or the filter is too greedy.
  assert.equal(normalizeRoute("/a-brand-new-page"), "/a-brand-new-page");
});

test("a crawler is not audience: bots add no pageview, no visitor, no referrer", () => {
  const line = (ua: string, uri: string) =>
    JSON.stringify({
      timestamp: "2026-09-13T10:00:00+00:00",
      remote_addr: "203.0.113.9",
      request_method: "GET",
      request_uri: uri,
      uri,
      status: 200,
      bytes_sent: 1000,
      body_bytes_sent: 900,
      request_time: 0.1,
      upstream_response_time: "0.1",
      http_referer: "https://news.ycombinator.com/",
      http_user_agent: ua,
      country: "US",
      cf_ray: "x",
    });

  const human = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36";
  const batch = [
    line(human, "/wanted"),
    line("Googlebot/2.1 (+http://www.google.com/bot.html)", "/wanted"),
    line("GPTBot/1.0", "/wanted"),
    line("robincalls-isr-warmup", "/wanted"), // the post-deploy warm-up
  ];

  const r = processLogBatch(batch, "test-salt");
  const page = r.pages.get("2026-09-13|/wanted");
  assert.ok(page, "the human hit produced no page bucket at all");
  assert.equal(page.pageviews, 1, "only the human should count as a pageview");
  assert.equal(page.uniqueVisitorHashes.size, 1, "only the human should count as a visitor");

  const hour = [...r.hourly.values()][0];
  assert.equal(hour.pageviews, 1, "hourly pageviews must exclude the three machines");
  // Operational metrics deliberately still see all four: the box really served them.
  assert.equal(hour.status2xx, 4, "status buckets are operational and must count every request");

  const ref = r.referrers.get("2026-09-13|news.ycombinator.com");
  assert.equal(ref?.hits, 1, "a crawler's Referer is not a referral");
});
