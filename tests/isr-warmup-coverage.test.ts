import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ISR_ROUTES, prerenderedIsrPaths, worstCaseStaleSeconds } from "../lib/config/isr-paths";

/**
 * The deploy warm-up only closes the empty-snapshot window for routes it knows
 * about, so a new `export const revalidate` that nobody adds to the registry is
 * a silently stale page — the exact shape of the dead rate-limit budgets in
 * CLAUDE.md §8 #5, where the rule existed and never ran.
 *
 * This is the `tests/ratelimit-coverage.test.ts` pattern: pin the coupling
 * between a declaration in `app/` and the registry that acts on it.
 *
 * NOTE: this test proves every declaring route is CLASSIFIED, not that the
 * classification is right. Only a build knows that. Re-check `prerendered`
 * against `.next/prerender-manifest.json` after any change to how these routes
 * render — the manifest is ground truth and the `revalidate` export is not.
 */

const APP_DIR = join(import.meta.dirname, "..", "app");
const REVALIDATE_RE = /^\s*export\s+const\s+revalidate\s*=\s*(\d+)/m;

interface Declaration {
  source: string;
  seconds: number;
}

function walk(dir: string, out: Declaration[] = []): Declaration[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!/\.(tsx?|jsx?)$/.test(entry)) continue;
    const match = REVALIDATE_RE.exec(readFileSync(full, "utf8"));
    if (!match) continue;
    out.push({
      source: full.slice(full.indexOf("/app/") + 1).replace(/\\/g, "/"),
      seconds: Number(match[1]),
    });
  }
  return out;
}

const declarations = walk(APP_DIR);

test("the app declares at least one ISR route (the walker still works)", () => {
  // A regex that silently stops matching would make every assertion below pass
  // vacuously — which is precisely how a coverage test becomes decoration.
  assert.ok(
    declarations.length >= 4,
    `found only ${declarations.length} revalidate declarations; the walker or the regex has drifted`
  );
});

test("every route that declares `revalidate` is classified in the registry", () => {
  const known = new Map(ISR_ROUTES.map((r) => [r.source, r]));
  for (const decl of declarations) {
    const entry = known.get(decl.source);
    assert.ok(
      entry,
      `${decl.source} exports revalidate but is missing from lib/config/isr-paths.ts — ` +
        `if it prerenders, the deploy warm-up will not clear its build-time empty snapshot`
    );
    assert.equal(
      entry.revalidateSeconds,
      decl.seconds,
      `${decl.source} declares revalidate=${decl.seconds} but the registry says ${entry.revalidateSeconds}`
    );
  }
});

test("the registry names no route that has stopped declaring `revalidate`", () => {
  const declared = new Set(declarations.map((d) => d.source));
  for (const entry of ISR_ROUTES) {
    assert.ok(
      declared.has(entry.source),
      `${entry.source} is in the registry but no longer exports revalidate — ` +
        `the warm-up would be revalidating a path that is not cached`
    );
  }
});

test("a route excluded from the warm-up has to say why", () => {
  // `/ledger` is the live example: it exports revalidate = 60 and is still
  // rendered on demand because it awaits searchParams, so the export does
  // nothing. Without a stated reason, "not prerendered" is indistinguishable
  // from "nobody checked".
  for (const entry of ISR_ROUTES) {
    if (entry.prerendered) continue;
    assert.ok(
      entry.dynamicReason && entry.dynamicReason.length > 20,
      `${entry.source} is marked not-prerendered with no usable dynamicReason`
    );
  }
});

test("the warm-up covers the routes confirmed against the prerender manifest", () => {
  // Pinned from `.next/prerender-manifest.json`, 2026-08-23, plus "/" (added
  // 2026-09-11 with the landing rebuild) and "/tokenomics" (2026-09-14) — same
  // shape as the other four: server components with no cookies/headers/
  // searchParams, so Next prerenders them statically. /tokenomics reads no DB;
  // what it bakes is `flags.tokenSale`, absent from the build environment.
  // A local production build could not confirm
  // this directly (this sandbox's `.env.production` points DATABASE_URL at
  // `pgbouncer`, which does not resolve outside the deploy host) — re-check
  // against a real build's manifest if that becomes possible, per this file's
  // header comment on ground truth.
  assert.deepEqual(prerenderedIsrPaths().sort(), [
    "/",
    "/api/stats",
    "/ecosystem",
    "/night-market",
    "/tokenomics",
    "/wanted",
  ]);
});

test("worstCaseStaleSeconds reports the longest exposed window", () => {
  assert.equal(worstCaseStaleSeconds(), 300);
});
