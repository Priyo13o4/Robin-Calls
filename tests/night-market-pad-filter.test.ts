import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync("app/night-market/NightMarketClient.tsx", "utf8");

test("launchpad selection enters a row-loading state until the filtered request settles", () => {
  assert.match(client, /const togglePad = \(slug: string\) => \{\s*setIsLoading\(true\);/);
  assert.match(client, /\[aggregatedSubTab, fetchLaunches, launchpads, primaryTab, selectedPads\]/);
  assert.match(client, /url\.searchParams\.set\("pads", padsRef\.current\.join\(","\)\)/);
  assert.match(client, /showLaunchSkeleton && Array\.from\(\{ length: 6 \}/);
  assert.match(client, /!showLaunchSkeleton && paginatedTokens\.map/);
});

test("a failed filtered request cannot show unfiltered search results", () => {
  assert.match(client, /if \(padsRef\.current\.length\) \{\s*setTokens\(\[\]\);\s*setCursor\(null\);\s*setErrorNotice/);
  assert.match(client, /isSearching && selectedPads\.length === 0 && externalSearchedTokens\.length > 0/);
});

test("the unsupported audit verification claim is absent", () => {
  assert.doesNotMatch(client, /Audit Verified|100%/);
});
