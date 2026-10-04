import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const tabsSrc = readFileSync(join(root, "app/components/site/NightMarketTabs.tsx"), "utf8");
const landingSrc = readFileSync(join(root, "app/components/site/landing/NightMarketSection.tsx"), "utf8");

test("UI wiring: NightMarketTabs renders 'Liquidity pulled' gated on liquidity_pulled", () => {
  // Count occurrences of "Liquidity pulled" in NightMarketTabs.tsx
  const matches = [...tabsSrc.matchAll(/Liquidity pulled/g)];
  assert.equal(matches.length, 1, "NightMarketTabs must contain exactly one 'Liquidity pulled' tag");

  const idx = tabsSrc.indexOf("Liquidity pulled");
  assert.ok(idx !== -1, "must find 'Liquidity pulled' in NightMarketTabs.tsx");

  // Extract a window around the tag
  const windowStart = tabsSrc.lastIndexOf("<div", idx);
  const windowEnd = tabsSrc.indexOf("</div>", idx);
  assert.ok(windowStart !== -1 && windowEnd !== -1, "must find surrounding element bounds");
  const block = tabsSrc.slice(windowStart, windowEnd + 6);

  // CLAUDE.md §8 #22: assert non-empty slice
  assert.ok(block.length > 50, "extracted block must be non-empty");

  assert.ok(
    block.includes("row.liquidity_pulled"),
    "NightMarketTabs tag must be gated on row.liquidity_pulled"
  );
  assert.ok(
    block.includes('title="This pool\'s liquidity dropped from at least $20K to $0 on two readings in a row."'),
    "NightMarketTabs tag must have pinned explanatory title without em dashes"
  );
});

test("UI wiring: NightMarketSection renders 'Liquidity pulled' in LaunchRow only", () => {
  // Count occurrences of "Liquidity pulled" in NightMarketSection.tsx
  const matches = [...landingSrc.matchAll(/Liquidity pulled/g)];
  assert.equal(matches.length, 1, "NightMarketSection must contain exactly one 'Liquidity pulled' tag");

  // Extract LaunchRow function
  const launchRowStart = landingSrc.indexOf("function LaunchRow(");
  assert.ok(launchRowStart !== -1, "must find function LaunchRow");
  const launchRowEnd = landingSrc.indexOf("function ActivityBars(", launchRowStart);
  assert.ok(launchRowEnd !== -1, "must find end of LaunchRow");
  const launchRowSrc = landingSrc.slice(launchRowStart, launchRowEnd);

  assert.ok(launchRowSrc.length > 200, "extracted LaunchRow slice must be non-empty");

  assert.ok(
    launchRowSrc.includes("Liquidity pulled"),
    "LaunchRow must contain 'Liquidity pulled'"
  );
  assert.ok(
    launchRowSrc.includes("row.liquidity_pulled"),
    "LaunchRow tag must be gated on row.liquidity_pulled"
  );
  assert.ok(
    launchRowSrc.includes('title="This pool\'s liquidity dropped from at least $20K to $0 on two readings in a row."'),
    "LaunchRow tag must have pinned explanatory title without em dashes"
  );

  // Verify ActivityLineChart, tiles, or measured are not touched
  const outsideLaunchRow = landingSrc.slice(0, launchRowStart) + landingSrc.slice(launchRowEnd);
  assert.equal(
    outsideLaunchRow.includes("liquidity_pulled"),
    false,
    "liquidity_pulled must not be used outside LaunchRow in NightMarketSection"
  );
});
