import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * `/ecosystem` shipped 180 images and `/rwa` 196, none of them deferred, because
 * every call site wrote its own `<img>` and a default cannot live in 40 tags.
 * SmartImage is that default; these are the wiring assertions (§8 #10) — the
 * component existing proves nothing about whether the list components use it.
 *
 * The second half is the one that matters more. `loading="lazy"` defers BYTES
 * and nothing else: both of these components also fire a per-item fetch from a
 * mount effect, so without the viewport gate the page is still N requests to our
 * own box on load, whatever the images do.
 */
const read = (p: string) => readFileSync(p, "utf8");

const LIST_COMPONENTS = [
  "app/components/site/PlatformBanner.tsx",
  "app/components/site/EcosystemCard.tsx",
  "app/components/site/EcosystemTopTenCard.tsx",
  "app/components/site/RwaPageClient.tsx",
  "app/components/site/RwaTerminalClient.tsx",
];

for (const path of LIST_COMPONENTS) {
  test(`${path} renders no bare <img> — every image in a list goes through SmartImage`, () => {
    const src = read(path);
    assert.ok(src.includes("SmartImage"), `${path} does not import or render SmartImage`);
    assert.doesNotMatch(src, /<img[\s>]/, `${path} still has a bare <img>, which defaults to eager`);
  });
}

const PER_ITEM_FETCHERS: [string, string][] = [
  ["app/components/site/PlatformBanner.tsx", "/api/og-proxy"],
  ["app/components/site/RwaIcon.tsx", "/api/rwa/icon"],
];

for (const [path, endpoint] of PER_ITEM_FETCHERS) {
  test(`${path} does not call ${endpoint} until the item is near the viewport`, () => {
    const src = read(path);
    assert.ok(src.includes(endpoint), `${path} no longer calls ${endpoint} — retarget this test`);
    assert.ok(
      src.includes("useNearViewport"),
      `${path} fetches per item on mount with no viewport gate`,
    );
    // The gate is only real if the effect actually returns early on it, and only
    // re-runs once it flips. Either half missing makes the import decorative.
    assert.match(src, /if \(!near\) return;/, `${path} imports the gate but never applies it`);
    assert.match(src, /\}, \[[^\]]*\bnear\b[^\]]*\]\);/, `${path}'s effect does not depend on near`);
  });
}

test("SmartImage defaults to lazy and only opts out for an explicit priority", () => {
  const src = read("app/components/site/SmartImage.tsx");
  assert.match(src, /loading=\{priority \? "eager" : "lazy"\}/);
  assert.match(src, /priority = false/, "the default must be lazy, not eager");
  // Callers must not be able to hand-set these; that is how the default drifts.
  assert.match(src, /"loading" \| "decoding" \| "fetchPriority"/);
});
