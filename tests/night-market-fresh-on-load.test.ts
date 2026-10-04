import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Source-level pins for NightMarketTabs: the component needs a DOM and a live
// /api/launches, so these read the code. Comments are stripped first so a comment
// describing the old behaviour cannot satisfy an assertion (§8 #22).
const raw = readFileSync(join(__dirname, "..", "app/components/site/NightMarketTabs.tsx"), "utf8");
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function pollEffectBody(): string {
  const start = src.indexOf("const interval = setInterval(tick, POLL_MS);");
  assert.ok(start > 0, "poll effect not found: the extraction below would assert over nothing");
  return src.slice(start, src.indexOf("return () =>", start));
}

test("ISR rows are refreshed on arrival, not after the first 30s tick", () => {
  assert.match(src, /lastFetchRef = useRef<Record<Tab, number>>\(\{ bonding: 0, dex: 0 \}\)/);
  assert.match(pollEffectBody(), /if \(Date\.now\(\) - lastFetchRef\.current\[tab\] >= POLL_MS\) tick\(\);/);
});

test("a successful fetch stamps the tab, so a fresh replace is not polled again at once", () => {
  assert.match(src, /setLoadedByTab\(\(prev\) => \(\{ \.\.\.prev, \[t\]: true \}\)\);\s*lastFetchRef\.current\[t\] = Date\.now\(\);/);
});

test("the selected tab is written to the URL and restored on load", () => {
  assert.match(src, /url\.searchParams\.set\("tab", t\)/);
  assert.match(src, /window\.history\.replaceState\(/);
  assert.match(src, /new URLSearchParams\(window\.location\.search\)\.get\("tab"\)/);
  assert.doesNotMatch(src, /router\.(push|replace)\(/, "a router navigation would refetch the ISR page");
});

test("the Night Market page stays ISR and never reads searchParams on the server", () => {
  const page = readFileSync(join(__dirname, "..", "app/night-market/page.tsx"), "utf8");
  assert.match(page, /export const revalidate = \d+;/);
  assert.doesNotMatch(page, /searchParams/);
});
