import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

/* ── /token-sale with no configured address ──────────────────────────────── */

/**
 * The bug: two tiles rendered `<ShimmerBlock/>` behind `status === "loading"`,
 * and with no sale address no read is ever started, so `status` never leaves
 * "loading" and the skeleton animated forever.
 */
test("no contract-derived figure can shimmer when there is no contract", () => {
  const lines = read("app/token-sale/SalePageClient.tsx").split("\n");
  const shimmerLines = lines
    .map((line, i) => ({ line, i }))
    .filter(({ line }) => line.includes("<ShimmerBlock"));
  // §8 #22: prove the scan found its subject before asserting about it.
  assert.ok(shimmerLines.length > 0, "no ShimmerBlock left in this file — retarget this test");

  for (const { line, i } of shimmerLines) {
    // Either the `unset` branch runs first, or the shimmer belongs to a
    // surface that resolves on its own (the leaderboard reads the database,
    // which answers with or without a sale address).
    // 24 lines is the enclosing JSX block, not a guess: the leaderboard's
    // `boardStatus === "loading"` opens 16 lines above its shimmer.
    const preceding = lines.slice(Math.max(0, i - 24), i).join("\n");
    assert.match(
      preceding,
      /unset|boardStatus/,
      `a ShimmerBlock with no unset guard and no self-resolving source, line ${i + 1}: ${line.trim()}`,
    );
  }
});

test("the unset placeholder is static and carries no digits", () => {
  const src = read("app/components/site/Skeleton.tsx");
  const body = src.slice(src.indexOf("export function UnsetBar"));
  assert.match(body, /blur-\[3px\]/, "the ask was a blur, not another skeleton");
  assert.doesNotMatch(body, /animate-shimmer/, "a skeleton promises data is arriving; none is");
  // §8 #3: a blurred number is still a number we never read.
  assert.doesNotMatch(body, /\d\.\d|0\.000|ETH/, "UnsetBar must not render a figure");
});

test("unset covers unavailable as well as unconfigured", () => {
  const src = read("app/token-sale/SalePageClient.tsx");
  assert.match(
    src,
    /const unset = addressState !== "address";/,
    "a DB we could not read is not a sale with figures to show",
  );
});

test("the chip says the sale is unscheduled, not that data is missing", () => {
  const src = read("app/token-sale/SalePageClient.tsx");
  // Before the contract speaks, chips read the admin schedule, the same source as the clock.
  assert.match(src, /const dateChip = scheduleChip\(schedule, renderedAt\)/);
  assert.match(src, /const chip = st === SALE_STATE\.PENDING \|\| !state \? dateChip : state\.chip/);
  assert.doesNotMatch(src, /\?\? "NO DATA"/);
  // "AWAITING FIRST READ" claims something is in flight.
  assert.match(src, /unset\s*\n?\s*\?\s*dateChip/);
});

test("every vault cell and projection readout is told when it is unsourced", () => {
  const sale = read("app/token-sale/SalePageClient.tsx");
  const cells = sale.match(/<Cell\b[\s\S]*?\/>/g) ?? [];
  assert.equal(cells.length, 6, `expected the six vault cells, found ${cells.length}`);
  const ethPriceCell = cells.find((c) => c.includes('label="ETH PRICE"'));
  assert.ok(ethPriceCell, "missing ETH PRICE cell");
  assert.doesNotMatch(ethPriceCell, /\bunset[=\s]/, "ETH PRICE cell must not carry unset prop");
  const contractCells = cells.filter((c) => !c.includes('label="ETH PRICE"'));
  assert.equal(contractCells.length, 5, `expected five contract cells, found ${contractCells.length}`);
  for (const cell of contractCells) assert.match(cell, /unset=\{unset\}/, `a vault cell without unset: ${cell}`);

  const proj = read("app/token-sale/RaiseProjection.tsx");
  const stats = proj.match(/<Stat\b[\s\S]*?\/>/g) ?? [];
  assert.ok(stats.length > 0, "found no <Stat> in RaiseProjection — retarget this test");
  for (const s of stats) assert.match(s, /unset=\{unset\}/, `a projection stat without unset: ${s}`);
});

/* ── per-page latency (migration 0097) ───────────────────────────────────── */

test("the page bucket records latency outside the bot gate", () => {
  const src = read("lib/data/analytics-ingest.ts");
  const pages = src.slice(src.indexOf("// ── Pages ──"), src.indexOf("// ── Referrers ──"));
  assert.match(pages, /latencies: \[\]/, "the page bucket must start with a latency array");
  // Inside `if (!isBot)` it would only time human traffic, which is not what
  // "how long did the box take to serve this path" means.
  const gate = pages.indexOf("if (!isBot)");
  assert.ok(
    pages.indexOf("pageBucket.latencies.push") > pages.indexOf("}", gate),
    "latency must be recorded for every served request, bots included",
  );
});

test("the running average is weighted by samples, never by pageviews", () => {
  // pageviews EXCLUDE bots and latencySamples do not, so weighting by
  // pageviews drifts with the bot share and divides by zero on an all-bot
  // batch. §8 #11: the denominator has to be the thing actually counted.
  const src = read("lib/data/analytics.ts");
  const fn = src.slice(src.indexOf("export async function upsertPageDaily"), src.indexOf("/** Upsert daily referrer stats. */"));
  assert.match(fn, /avgLatencyMs: sql`round\(\(\$\{analyticsPagesDaily\.avgLatencyMs\}/);
  assert.match(fn, /analyticsPagesDaily\.latencySamples\}::numeric \+ \$\{samples\}/);
  assert.doesNotMatch(
    fn,
    /avgLatencyMs: sql`round\(\([\s\S]{0,200}?analyticsPagesDaily\.pageviews\}::numeric \* /,
    "the average must not be weighted by a bot-excluding count",
  );
});

test("a path with no timed request reports no latency rather than zero", () => {
  const src = read("app/admin/(dashboard)/analytics/AnalyticsClient.tsx");
  assert.match(
    src,
    /item\.latencySamples\s*\n?\s*\?\s*`\$\{Math\.round\(item\.avgLatencyMs\)\}/,
    "0ms reads as a measurement; an unmeasured path must fall through to the placeholder",
  );
});

test("migration 0097 is additive and defaults every new column", () => {
  const sql = read("supabase/migrations/0097_analytics_pages_latency.sql");
  assert.match(sql, /alter table public\.analytics_pages_daily/);
  for (const col of ["avg_latency_ms", "p95_latency_ms", "latency_samples"]) {
    assert.match(sql, new RegExp(`add column if not exists ${col} [^;]*?not null default 0`));
  }
  assert.doesNotMatch(sql, /drop |alter column/i, "migrations here are additive only");
});
