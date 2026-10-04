import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { slugify, listingSlug, SLUG_PATTERN } from "../lib/config/slug";
import { categoryLabel, DIRECTORY_CATEGORY_VALUES } from "../lib/config/ecosystem";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

test("slugify matches the SQL backfill in migration 0066", () => {
  // The migration does: trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
  const cases: Array<[string, string]> = [
    ["Flap.sh", "flap-sh"],
    ["Pons V2", "pons-v2"],
    ["  Stonk   Safe  ", "stonk-safe"],
    ["robin.fun!!", "robin-fun"],
    ["A—B", "a-b"],
    ["ALLCAPS", "allcaps"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(slugify(input), expected, input);
    assert.ok(SLUG_PATTERN.test(expected), `${expected} must be a legal slug`);
  }
});

test("a name that slugifies to nothing still gets an addressable URL", () => {
  assert.equal(slugify("!!!"), "");
  assert.equal(listingSlug("!!!", 42), "listing-42");
  assert.ok(SLUG_PATTERN.test(listingSlug("!!!", 42)));
});

test("every slug the helper can emit satisfies the DB check constraint", () => {
  const schema = read("lib/db/schema.ts");
  const m = schema.match(/directory_platforms_slug_check", sql`slug ~ '([^']+)'`/);
  assert.ok(m, "schema.ts must carry the slug check constraint");
  const dbPattern = new RegExp(m[1]);
  for (const n of ["Flap.sh", "Pons V2", "x", "A B C", "!!!"]) {
    assert.ok(dbPattern.test(listingSlug(n, 7)), `${n} → ${listingSlug(n, 7)} rejected by the DB`);
  }
});

test("migration 0066 makes slug NOT NULL and UNIQUE — a nullable slug is a 500 on the route", () => {
  const sql = read("supabase/migrations/0066_ecosystem_slugs.sql");
  assert.ok(/alter column slug set not null/i.test(sql));
  assert.ok(/unique \(slug\)/i.test(sql));
  // Backfill must run BEFORE the NOT NULL, or the migration fails on any row.
  assert.ok(sql.indexOf("set slug =") < sql.indexOf("set not null"));
});

test("no /directory path survives outside the deliberate legacy redirect", () => {
  const roots = ["app", "lib"];
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(rel);
      } else if (/\.tsx?$/.test(e.name)) {
        if (rel.startsWith("app/directory/")) continue; // the redirect itself
        // The ISR registry must NAME the redirect route — every route that
        // declares `revalidate` is pinned there by isr-warmup-coverage.
        if (rel === "lib/config/isr-paths.ts") continue;
        const src = readFileSync(join(root, rel), "utf8");
        // Comments may reference the old path historically; code may not.
        for (const line of src.split("\n")) {
          const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
          if (/["'`]\/directory(\/|["'`])/.test(code)) offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
  };
  roots.forEach(walk);
  assert.deepEqual(offenders, [], "live /directory references remain");
});

test("every /ecosystem/<param> link interpolates a SLUG, never an id", () => {
  /**
   * The rename shipped `/ecosystem/${p.id}` — the path was rewritten and the
   * parameter was not, so the grid linked at ids under a route that only
   * answers slugs. The earlier "no /directory path survives" test passed
   * throughout, because it asserted the PATH PREFIX and the bug was in the
   * PARAMETER. Assert the whole URL shape, not the half that changed.
   */
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(rel);
      } else if (/\.tsx?$/.test(e.name)) {
        const src = readFileSync(join(root, rel), "utf8");
        for (const m of src.matchAll(/\/ecosystem\/\$\{([^}]+)\}/g)) {
          const expr = m[1];
          if (!/slug/i.test(expr)) offenders.push(`${rel}: \${${expr}}`);
        }
      }
    }
  };
  ["app", "lib"].forEach(walk);
  assert.deepEqual(offenders, [], "an /ecosystem URL is built from something other than a slug");
});

test("a stale numeric /ecosystem/<id> resolves instead of dying", () => {
  const src = read("app/ecosystem/[slug]/page.tsx");
  assert.ok(src.includes("idFallbackSlug"), "the bad URLs were live; crawlers keep those");
  // It must run only AFTER the slug lookup misses, or a platform legitimately
  // named "3" would be redirected away from its own page.
  assert.ok(src.indexOf("const p = await loadPlatform(slug)") < src.indexOf("idFallbackSlug(slug)"));
  assert.ok(/permanentRedirect\(`\/ecosystem\/\$\{canonicalSlug\}`\)/.test(src));
});

test("the legacy id URL redirects permanently rather than soft-404ing to the index", () => {
  const src = read("app/directory/[id]/page.tsx");
  // Next emits 308 for a permanent redirect; Google consolidates it as a 301.
  // Assert the API, not the number — the number is Next's to choose.
  assert.ok(src.includes("permanentRedirect"), "302 would not transfer the ranking signal");
  assert.ok(!src.includes("redirect("), "a temporary redirect keeps the old URL indexed");
  assert.ok(src.includes("notFound()"), "a missing row must 404, not bounce to /ecosystem");
  assert.ok(!/permanentRedirect\(\s*["'`]\/ecosystem["'`]\s*\)/.test(src));
});

test("/directory redirects permanently at the config level", () => {
  const cfg = read("next.config.ts");
  assert.ok(/source: "\/directory"/.test(cfg));
  assert.ok(/destination: "\/ecosystem"/.test(cfg));
  assert.ok(/permanent: true/.test(cfg));
});

test("the sitemap lists every published listing and is not baked at build time", () => {
  const src = read("app/sitemap.ts");
  assert.ok(src.includes("queryPublishedPlatforms"), "listings must be in the sitemap");
  assert.ok(src.includes("/ecosystem/${p.slug}"));
  // The image builds with no DATABASE_URL — a static sitemap would ship empty.
  assert.ok(
    src.includes('export const dynamic = "force-dynamic"'),
    "a build-time sitemap would bake an empty listing set"
  );
  assert.ok(!src.includes('"/directory"'), "the old path must not be advertised to crawlers");
  assert.ok(src.includes('["/ecosystem"'));
});

test("the detail page carries the metadata a search result is built from", () => {
  const src = read("app/ecosystem/[slug]/page.tsx");
  assert.ok(src.includes("alternates: { canonical: `/ecosystem/${p.slug}` }"), "canonical");
  assert.ok(src.includes("openGraph:"));
  assert.ok(src.includes("BreadcrumbList"), "breadcrumbs are what replace the raw URL in a result");
  assert.ok(src.includes("application/ld+json"));
  // The title must lead with the platform's own name — that is the query.
  assert.ok(/const title = `\$\{p\.name\}/.test(src));
});

test("the listing page describes the platform without CLAIMING to be it", () => {
  const src = read("app/ecosystem/[slug]/page.tsx");
  // A bare top-level Organization would assert that our URL is their homepage.
  assert.ok(src.includes('"@type": "WebPage"'));
  assert.ok(src.includes("about:"), "the Organization must hang off `about`, not be the page");
  assert.ok(src.includes("sameAs"), "the real site must be named as the entity's own URL");
});

test("category names read as prose in a title, not as UI chip shouting", () => {
  // ALL CAPS in a search result reads as spam; the chip on the grid keeps it.
  assert.equal(categoryLabel("LAUNCHPAD"), "Launchpad");
  assert.equal(categoryLabel("DEFI"), "DeFi");
  assert.equal(categoryLabel("NFT"), "NFTs");
  assert.equal(categoryLabel("DEVTOOLS"), "Developer Tools");
  for (const v of DIRECTORY_CATEGORY_VALUES) {
    const label = categoryLabel(v);
    assert.ok(label.length > 0);
    assert.notEqual(label, label.toUpperCase().length > 3 ? label.toUpperCase() : "", label);
  }
});

test("the index emits an ItemList pointing at each listing's own page", () => {
  const src = read("app/ecosystem/page.tsx");
  assert.ok(src.includes('"@type": "ItemList"'));
  assert.ok(src.includes("numberOfItems"));
  assert.ok(src.includes("/ecosystem/${p.slug}"));
});

test("a colliding submission gets a suffixed slug, not a 500", () => {
  const src = read("lib/data/registry.ts");
  assert.ok(src.includes("isSlugCollision"), "23505 on the slug index is expected, not a fault");
  assert.ok(src.includes("directory_platforms_slug_key"), "must not swallow other unique violations");
  assert.ok(/attempt === SLUG_ATTEMPTS - 1\) throw err/.test(src), "the retry must be bounded");
});

test("the routes moved on disk, not just in links", () => {
  assert.ok(existsSync(join(root, "app/ecosystem/page.tsx")));
  assert.ok(existsSync(join(root, "app/ecosystem/[slug]/page.tsx")));
  assert.ok(existsSync(join(root, "app/api/ecosystem/submit/route.ts")));
  assert.ok(!existsSync(join(root, "app/ecosystem/[id]")), "the id segment is gone");
  assert.ok(!existsSync(join(root, "app/api/directory")), "the old API path is gone");
});

// ── The SEO batch, 2026-08-30: wiring the fixes above depend on ───────────────
//
// Each of these pins a decision that was reversed once already, or a defect that
// shipped silently because nothing could fail on it. §8 #10 — when a feature has
// a wiring step, assert the WIRING, not just the logic.

test("no redirect may match an /agent/ SUB-path — that is the AI plane's live API", () => {
  // `lib/agent/runner.ts` pins AGENT_BASE = "/agent" and the browser calls
  // /agent/config, /agent/persona/*, /agent/tool against it; nginx proxies them
  // to the FastAPI container. A 308 there survived review because nginx's
  // `location /agent/` matches before Next sees the request — so it was inert in
  // prod and fatal everywhere else, and a 308 is cached by the browser forever.
  // Bare /agent is fine: nginx's prefix needs the trailing slash.
  const src = read("next.config.ts");
  const start = src.indexOf("async redirects()");
  const redirects = src.slice(start, src.indexOf("},", src.indexOf("];", start)));
  assert.ok(
    !/source:\s*["'`]\/agent\/[^"'`]*["'`]/.test(redirects),
    "a redirect on an /agent/ sub-path breaks the chat wherever nginx is not in front",
  );
  assert.ok(
    /source:\s*["'`]\/agent["'`]/.test(redirects),
    "bare /agent has no route and should still land on /robin-knight",
  );
});

test("robots.txt disallows the AI plane, not just /api/", () => {
  const src = read("app/robots.ts");
  assert.match(src, /"\/agent\/"/, "/agent/ is an API surface that spends RPC, not a page");
  assert.match(src, /"\/mcp"/);
});

test("bare /directory, /watchlist and /consigliere still redirect (all three are indexed)", () => {
  const src = read("next.config.ts");
  for (const p of ["/directory", "/watchlist", "/consigliere"]) {
    assert.ok(
      new RegExp(`source:\\s*["'\`]${p}["'\`]`).test(src),
      `${p} is indexed in Google today; dropping it starts 404ing a live URL`,
    );
  }
});

test("the scan slug 308 only fires when a row actually named the symbol", () => {
  // `readLatestVerdict` degrades to null (§1), and a null symbol canonicalises
  // to the BARE address — so redirecting on it would permanently send
  // `pepe-0x…` → `0x…` in every visitor's cache during a DB blip, and the
  // recovered DB would send it back: a 308 loop nobody can clear. A redirect is
  // forever; it may only be computed from a fact we have.
  const src = read("app/scan/[address]/page.tsx");
  assert.match(
    src,
    /if \(symbol !== null && rawSlug !== canonicalSlug\)/,
    "the redirect must be gated on a known symbol, not on a possibly-empty read",
  );
});

test("a stored scan verdict discloses its age and offers a live scan", () => {
  // Landing on /scan/<addr> used to auto-run a live scan. SSR-ing the stored
  // receipt is what makes the page indexable, so the scan became a click — and
  // these two are what keep that honest rather than silent. A token can turn
  // over inside an hour (DOOM: scanned, rugged 23 minutes later), so a receipt
  // shown without its date reads as current.
  const src = read("app/scan/[address]/page.tsx");
  assert.match(src, /SCANNED \{receiptAge\(createdAt\)/, "the receipt must state its age");
  assert.match(src, /RUN A FRESH SCAN/, "the live scan must still be reachable");
  assert.match(src, /\?rescan=1/);
  assert.doesNotMatch(
    src.slice(src.indexOf("} : latest ? (")),
    /subline="Reading the chain\. Simulating the exit/,
    "present tense over a stored row claims work that is not happening",
  );
});

test("?v= and ?rescan= are noindex; a verdict-less scan page is too", () => {
  const src = read("app/scan/[address]/page.tsx");
  assert.match(src, /verdictId !== null \|\| query\.rescan === "1" \|\| !row/);
  assert.match(src, /robots: \{ index: false, follow: true \}/);
});

test("the sitemap advertises scan pages, capped, one row per token", () => {
  const src = read("app/sitemap.ts");
  // Body only — the comments above it discuss `?v=` by name.
  const body = src.slice(src.indexOf("export default async function sitemap"));
  assert.match(body, /recentlyVerdictedTokens\(500\)/, "uncapped would grow without bound");
  assert.match(body, /buildScanSlug/, "must be the canonical ticker slug, not the bare address");
  assert.doesNotMatch(body, /\?v=/, "?v= receipts are noindex and must never be advertised");
});

test("Organization sameAs carries only profiles the site itself links", () => {
  const layout = read("app/layout.tsx");
  const footer = read("app/components/site/SiteFooter.tsx");
  const sameAs = layout.slice(layout.indexOf("sameAs: ["), layout.indexOf("sameAs: [") + 400);
  const urls = [...sameAs.matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(urls.length > 0, "an empty sameAs teaches Google nothing about the entity");
  for (const u of urls) {
    // A dead URL here is worse than an empty array: sameAs is an identity claim,
    // and one the site cannot corroborate weakens the entity instead of building it.
    assert.ok(footer.includes(u), `${u} is claimed as ours but the site never links it`);
  }
});
