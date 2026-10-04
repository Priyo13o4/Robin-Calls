import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Next's scroll reset does not run on a `force-dynamic` route that also ships a
 * `loading.tsx`, so those pages open at the previous page's scroll position.
 * `ScrollResetOnNavigate` is the backstop; these are the wiring assertions
 * (§8 #10) and the guard assertions — a reset that fires on back/forward or on
 * a hash target is worse than the bug it fixes.
 */
const read = (p: string) => readFileSync(p, "utf8");

const COMPONENT = "app/components/site/ScrollResetOnNavigate.tsx";

test("the root layout mounts the scroll reset", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /import \{ ScrollResetOnNavigate \}/);
  assert.match(layout, /<ScrollResetOnNavigate \/>/);
});

test("the reset lives in the root layout, the only tree kept across navigations", () => {
  // Anywhere else it remounts per route, so its "was this the first render"
  // check is always true and it can never distinguish a load from a nav.
  const src = read(COMPONENT);
  assert.match(src, /usePathname/);
  assert.match(src, /window\.scrollTo\(0, 0\)/);
});

test("every bail-out is present: initial load, popstate, and a hash target", () => {
  const src = read(COMPONENT);
  assert.match(src, /if \(from === null\) return;/, "an initial document load must not be reset");
  assert.match(src, /if \(wasPop\) return;/, "back and forward already restore their own position");
  assert.match(src, /if \(window\.location\.hash\) return;/, "a hash is an explicit destination");
});

test("the popstate listener is registered, not just declared", () => {
  const src = read(COMPONENT);
  assert.match(src, /addEventListener\("popstate"/);
  assert.match(src, /removeEventListener\("popstate"/);
  // The flag has to be consumed, or every navigation after the first back
  // stays suppressed forever.
  assert.match(src, /popped\.current = false;/);
});

/**
 * The population the bug applies to, recomputed rather than listed. A new
 * `force-dynamic` page with a skeleton inherits the same defect, so this fails
 * loudly if the backstop is ever removed while one of them still exists.
 */
function routesWithForceDynamicAndLoading(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      routesWithForceDynamicAndLoading(path, found);
      continue;
    }
    if (entry !== "page.tsx") continue;
    if (!read(path).includes('dynamic = "force-dynamic"')) continue;
    try {
      statSync(join(dir, "loading.tsx"));
      found.push(dir);
    } catch {
      // No skeleton on this route, so Next's own handler reaches an Element.
    }
  }
  return found;
}

test("the routes this backstop exists for are still there", () => {
  const affected = routesWithForceDynamicAndLoading("app");
  // §8 #22: prove the walk found something before asserting about it.
  assert.ok(affected.length > 0, "found no force-dynamic route with a loading.tsx — retarget this test");
  assert.ok(affected.includes("app/rwa"), `expected app/rwa among ${affected.join(", ")}`);
});
