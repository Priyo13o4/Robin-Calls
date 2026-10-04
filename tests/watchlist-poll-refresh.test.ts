import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * L35 — the Night Market poll refreshed page 1, and page 1 spans ~2 minutes.
 *
 * Measured on prod 2026-08-23: ~370 new candidates an hour, so the newest 30
 * rows cover 2.1 minutes of wall clock. Every card older than that had aged out
 * of the only page the poll ever fetched, and its raise / fill / liquidity
 * froze on screen for as long as the tab stayed open.
 *
 * Nothing about that failure throws, logs, or looks wrong in a screenshot — the
 * numbers are simply old — so these tests pin the contract rather than trusting
 * a future reader to notice.
 */

interface Row { token_address: string; progress_bps: number }

/** The component's merge, restated. Pinned against the source below. */
function mergeFreshPage(
  existing: Row[],
  fresh: Row[],
  refreshed: Row[] = [],
  askedFor: string[] = []
): Row[] {
  const freshAddresses = new Set(fresh.map((r) => r.token_address));
  const byAddress = new Map(refreshed.map((r) => [r.token_address, r]));
  const asked = new Set(askedFor);
  const rest = existing
    .filter((r) => !freshAddresses.has(r.token_address))
    .filter((r) => !asked.has(r.token_address) || byAddress.has(r.token_address))
    .map((r) => byAddress.get(r.token_address) ?? r);
  return [...fresh, ...rest];
}

const row = (a: string, bps = 0): Row => ({ token_address: a, progress_bps: bps });

test("L35: a card that aged out of page 1 still gets its numbers updated", () => {
  const existing = [row("0xa", 100), row("0xb", 200)];
  // Page 1 has moved on entirely — neither card is in it any more.
  const out = mergeFreshPage(
    existing,
    [row("0xnew", 5)],
    [row("0xa", 4200), row("0xb", 900)],
    ["0xa", "0xb"]
  );
  assert.equal(out.find((r) => r.token_address === "0xa")?.progress_bps, 4200);
  assert.equal(out.find((r) => r.token_address === "0xb")?.progress_bps, 900);
});

test("L35: a refreshed card keeps its POSITION — the grid must not reorder under the reader", () => {
  const existing = [row("0xa"), row("0xb"), row("0xc")];
  // All three still in the feed; only 0xb's numbers moved.
  const out = mergeFreshPage(
    existing,
    [],
    [row("0xc"), row("0xb", 77), row("0xa")],
    ["0xa", "0xb", "0xc"]
  );
  assert.deepEqual(out.map((r) => r.token_address), ["0xa", "0xb", "0xc"]);
  assert.equal(out[1].progress_bps, 77);
});

test("L35: new arrivals still go to the top", () => {
  const out = mergeFreshPage([row("0xa")], [row("0xnew")], [row("0xa")], ["0xa"]);
  assert.equal(out[0].token_address, "0xnew");
});

test("L35: a row that left the feed is dropped, not frozen", () => {
  // Asked about 0xa and 0xb; the server returned only 0xa, so 0xb graduated or
  // expired out of this tab.
  const out = mergeFreshPage([row("0xa"), row("0xb")], [], [row("0xa")], ["0xa", "0xb"]);
  assert.deepEqual(out.map((r) => r.token_address), ["0xa"]);
});

test("L35: a row we never ASKED about is kept — absence is not a verdict", () => {
  // Past the 150-address cap, so it was not in the request at all. Dropping it
  // would delete cards off the bottom of a long page on every poll.
  const out = mergeFreshPage([row("0xa"), row("0xcapped")], [], [row("0xa")], ["0xa"]);
  assert.deepEqual(out.map((r) => r.token_address), ["0xa", "0xcapped"]);
});

test("L35: an empty poll response changes nothing (the pre-L35 no-op case)", () => {
  const existing = [row("0xa", 5), row("0xb", 6)];
  assert.deepEqual(mergeFreshPage(existing, [], [], []), existing);
});

test("L35: the component's merge still matches the one asserted here", () => {
  const src = read("app/components/site/NightMarketTabs.tsx");
  assert.ok(src.includes("refreshed: LaunchFeedRow[] = []"));
  assert.ok(src.includes("askedFor: string[] = []"));
  assert.ok(src.includes("!asked.has(r.token_address) || byAddress.has(r.token_address)"));
  assert.ok(src.includes("byAddress.get(r.token_address) ?? r"));
});

test("L35: the poll sends the displayed addresses, from a REF not from state", () => {
  const src = read("app/components/site/NightMarketTabs.tsx");
  assert.ok(src.includes("&tokens=${displayed.join(\",\")}"));
  assert.ok(src.includes("rowsRef.current[t].map((r) => r.token_address)"));
  // Depending on rowsByTab would give fetchTab a new identity per row update,
  // restarting the interval so the poll could never fire on a fast feed.
  const fetchTab = src.slice(src.indexOf("const fetchTab ="), src.indexOf("const selectTab ="));
  assert.ok(!fetchTab.includes("rowsByTab["), "fetchTab must not close over rowsByTab");
  assert.ok(/}, \[\]\);\s*$/.test(fetchTab.trimEnd()), "fetchTab's dep array must stay empty");
});

test("L35: the address list is validated and capped — it is a public endpoint", () => {
  const src = read("app/api/launches/route.ts");
  assert.ok(src.includes("MAX_POLL_ADDRESSES"));
  assert.ok(src.includes("/^0x[0-9a-f]{40}$/.test(t)"), "unvalidated input must not reach IN (...)");
  assert.ok(src.includes(".slice(0, MAX_POLL_ADDRESSES)"), "an unbounded IN (...) is amplification");
});

test("L35: a per-viewer response is never shared by the CDN", () => {
  const src = read("app/api/launches/route.ts");
  // One viewer's card set served to another would be a correctness bug, not
  // just a caching one.
  assert.ok(src.includes('"private, no-store"'));
  assert.ok(src.includes("tokens.length\n          ? \"private, no-store\""));
});

test("L35: the by-address read keeps every other filter", () => {
  const src = read("lib/data/launches.ts");
  // It routes through readLaunchFeed rather than running its own query, so tab,
  // visibility and expiry cannot drift apart from page 1's.
  assert.ok(src.includes("readLaunchFeed(tab, addresses.length, null, addresses, filters)"));
  assert.ok(src.includes("inArray(launches.tokenAddress, lower(addresses))"));
  // The picker's selections travel with it too. Without this the poll would
  // re-admit a card the active filter had just excluded, because the poll asks
  // for its rows BY NAME and would otherwise bypass the predicate entirely.
  assert.ok(src.includes("filters?: LaunchFilters"));
});
