/**
 * Night Market filter bar — rendering and end-to-end wiring.
 *
 * Bug being pinned: the FilterBar was gated on `rows.length > 0`, so an empty
 * feed deleted the controls — the one moment a user most needs them (to widen
 * the search) was the moment they vanished. The bar must render whenever the
 * tab has LOADED, empty or not.
 *
 * Source pins, not DOM tests: this repo's suite is node:test without a DOM,
 * and the wiring claims here are about which code paths exist and connect.
 */
import { readFileSync } from "node:fs";
import { deepEqual } from "node:assert/strict";
import test from "node:test";

const TABS = readFileSync("app/components/site/NightMarketTabs.tsx", "utf8");
const ROUTE = readFileSync("app/api/launches/route.ts", "utf8");

test("the filter bar renders whenever the tab is loaded, even with zero rows", () => {
  const guard = TABS.match(/(\{loadedByTab\[tab\][\s\S]{0,80}?)\(\s*<FilterBar/);
  if (guard === null) {
    // Guard shape changed entirely; fail loudly rather than pass vacuously.
    throw new Error("FilterBar render guard not found - re-pin this test");
  }
  const condition = guard[1];
  deepEqual(
    condition.includes("rows.length"),
    false,
    `FilterBar is gated on row count ("${condition.trim()}") - an empty feed deletes the controls`,
  );
});

test("picker selections travel to /api/launches and are applied in SQL", () => {
  // Client side: selections become query params on every poll.
  if (!TABS.includes("launchFiltersToQuery(toQueryFilters(filtersRef.current))")) {
    throw new Error("poll no longer carries picker selections");
  }
  // Route side: params parsed server-side, unknown keys dropped.
  if (!ROUTE.includes("parseLaunchFilters(searchParams)")) {
    throw new Error("route no longer parses picker selections");
  }
  // A FILTERED page 1 must bypass the shared unfiltered cache (keyed tab+limit only).
  if (!/cursor \|\| filtered/.test(ROUTE)) {
    throw new Error("filtered page 1 no longer bypasses the shared page-1 cache");
  }
});
