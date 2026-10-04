import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DIRECT_DEX_KEY,
  LIQUIDITY_BUCKETS,
  PROGRESS_BUCKETS,
  hasAnyFilter,
  launchFiltersToQuery,
  parseLaunchFilters,
  rangesFor,
} from "../lib/config/launch-filters";
import { BONDING_SURFACE_BPS } from "../lib/launches/labels";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * The 2026-08-26 Night Market sweep. Every test here pins a claim the UI makes
 * about a token — the class §9 cares about, where nothing throws and the only
 * symptom is a sentence that is not true.
 */

// ── the fill floor ──────────────────────────────────────────────────────────

test("the bonding floor is a constant, not an env read", () => {
  const src = read("lib/launches/labels.ts");
  // CURVE_BONDING_SURFACE_BPS=500 sat in prod env and ran the tab at 5% while
  // the comment above it said 50%. A dial that exists to be hard to move must
  // not be movable by an untracked file.
  assert.ok(!src.includes("process.env"));
  assert.equal(BONDING_SURFACE_BPS, 3_300);
});

test("the floor is applied at READ time on the live reading, never a past promotion", () => {
  const src = read("lib/data/launches.ts");
  // A promotion-only gate is a high-water mark: 818 of 956 surfaced rows sat
  // below the bar they had once cleared. The registry stores no promotion at all.
  assert.ok(src.includes("gte(launchState.fillBps, BONDING_SURFACE_BPS)"));
  assert.ok(!src.includes("lifecycleState"), "no stored lifecycle label may gate the feed");
});

// ── the landing counter ─────────────────────────────────────────────────────

test("the graduation tile counts graduations out of a curve, not a venue flag", () => {
  const src = read("lib/data/launches.ts");
  const fn = src.slice(src.indexOf("export async function countCurveGraduations"));
  // Pool launches are born in a pool; only a GRADUATED event on a curve counts.
  assert.ok(fn.includes('eq(launchEvents.kind, "GRADUATED")'));
  assert.ok(fn.includes('inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"])'));
  assert.ok(read("lib/data/observability.ts").includes("countCurveGraduations()"));
});

test("a direct-listing card does not claim it graduated", () => {
  const src = read("app/components/site/NightMarketTabs.tsx");
  // Assert the RETURN, not the file: the comment above it quotes the old string
  // to explain why it went, so a file-wide grep can never go green.
  assert.ok(
    src.includes('row.lifecycle_state === "GRADUATED" ? "DEX LISTED" : "DEX LISTED · RESTRICTED"'),
    "a DEX_RESTRICTED row must not claim a graduation it never had"
  );
});

// ── filters, now server-side ────────────────────────────────────────────────

test("unknown bucket keys are dropped, never forwarded to SQL", () => {
  const f = parseLaunchFilters(new URLSearchParams("liq=100k%2B,DROP TABLE,lt5k&vol=nope"));
  assert.deepEqual(f.liquidity, ["100k+", "lt5k"]);
  assert.deepEqual(f.volume, []);
});

test("a bucket key ending in + survives the query string", () => {
  // URLSearchParams decodes a raw `+` as a SPACE, so `liq=100k+` arrives as
  // `100k` and the validator drops it. Four keys are affected; unencoded, the
  // filter looks wired and matches nothing.
  const q = launchFiltersToQuery({
    time: ["3d+"],
    liquidity: ["100k+"],
    volume: ["250k+"],
    progress: ["75+"],
    launchpads: [],
  });
  assert.ok(!/[a-z0-9]\+/.test(q), `raw + left in query: ${q}`);
  const back = parseLaunchFilters(new URLSearchParams(q));
  assert.deepEqual(back.liquidity, ["100k+"]);
  assert.deepEqual(back.progress, ["75+"]);
  assert.deepEqual(back.time, ["3d+"]);
  assert.deepEqual(back.volume, ["250k+"]);
});

test("launchpad slugs are shape-checked, and the direct-DEX key survives", () => {
  const f = parseLaunchFilters(new URLSearchParams(`pads=cashcat,${DIRECT_DEX_KEY},not a slug,../etc`));
  assert.deepEqual(f.launchpads, ["cashcat", DIRECT_DEX_KEY]);
});

test("an empty query is not a filter", () => {
  assert.equal(hasAnyFilter(parseLaunchFilters(new URLSearchParams(""))), false);
});

test("filters round-trip through the query string", () => {
  const original = new URLSearchParams("time=1h&liq=lt5k&vol=250k+&prog=75+&pads=flapsh");
  const parsed = parseLaunchFilters(original);
  const reparsed = parseLaunchFilters(new URLSearchParams(launchFiltersToQuery(parsed)));
  assert.deepEqual(reparsed, parsed);
});

test("an open-ended top bucket carries Infinity, so SQL omits the upper bound", () => {
  const [top] = rangesFor(["100k+"], LIQUIDITY_BUCKETS);
  assert.equal(top.min, 100_000);
  assert.equal(Number.isFinite(top.max), false);
});

test("progress buckets are percent and must be scaled to basis points", () => {
  const [mid] = rangesFor(["25-50"], PROGRESS_BUCKETS);
  assert.deepEqual(mid, { min: 25, max: 50 });
  const src = read("lib/data/launches.ts");
  assert.ok(src.includes("min: b.min * 100"), "a percent compared against bps is off by 100x");
});

test("a NULL column matches no active filter, and no ?? 0 sneaks in", () => {
  const src = read("lib/data/launches.ts");
  const fn = src.slice(src.indexOf("function bucketPredicate"), src.indexOf("const tractionClears"));
  assert.ok(fn.length > 0, "bucketPredicate must be findable");
  // "< $5K" must not sweep in every token whose liquidity was never measured.
  assert.ok(!fn.includes("?? 0") && !fn.includes("coalesce"));
  assert.ok(fn.includes("${column} >= ${r.min}"));
});

test("the client no longer re-filters what the server already filtered", () => {
  const src = read("app/components/site/NightMarketTabs.tsx");
  // The old pass narrowed page 1 and presented it as the whole answer.
  assert.ok(!src.includes("rows.filter((r) => matchesFilters"));
  assert.ok(src.includes("launchFiltersToQuery"), "selections must reach the server");
});

test("a filtered page 1 bypasses the unfiltered page-1 cache", () => {
  const src = read("app/api/launches/route.ts");
  // The cache key is tab+limit only; serving a filtered request from it would
  // hand back somebody else's unfiltered page.
  assert.ok(src.includes("cursor || filtered"));
});

// ── the verdict stamp ───────────────────────────────────────────────────────

test("an unscanned token gets no rosette, because absence is not a clearance", () => {
  const src = read("app/components/site/NightMarketTabs.tsx");
  assert.ok(src.includes("{row.verdict && <VerdictRosette"));
});

test("the stamp read is one query for the page, not one per card", () => {
  const src = read("lib/data/launches.ts");
  assert.ok(src.includes("latestVerdictStampsForTokens(rows.map"));
  const ledger = read("lib/data/ledger.ts");
  assert.ok(ledger.includes("selectDistinctOn([verdicts.tokenAddress]"));
});

test("a missing database yields no stamps rather than a thrown page", () => {
  const src = read("lib/data/ledger.ts");
  const fn = src.slice(src.indexOf("export async function latestVerdictStampsForTokens"));
  assert.ok(fn.slice(0, 900).includes("if (!conn) return out;"));
});

// ── the ledger deep link ────────────────────────────────────────────────────

test("a ?v= deep link opens the ledger IN CONTEXT, not on one isolated row", () => {
  const src = read("app/ledger/page.tsx");
  // A receipt's neighbours are what make it a chain; showing one row alone
  // broke the only thing the page exists to demonstrate.
  assert.ok(src.includes("cursor: verdictId + 1"));
  assert.ok(!src.includes("entries = data ? [data] : [];"));
  // and it still renders something if that row is not on the cursor page
  assert.ok(src.includes("verdictRowById(verdictId)"));
});

test("the deep-linked row is highlighted, not merely present", () => {
  const page = read("app/ledger/page.tsx");
  const feed = read("app/components/site/LedgerFeed.tsx");
  assert.ok(page.includes("highlightId={verdictId}"));
  // The markup carried id="v{id}" and a `target:` variant all along, but the
  // link uses a QUERY param, so :target could never match.
  assert.ok(feed.includes("const isPinned = highlightId != null"));
});
