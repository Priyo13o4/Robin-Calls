import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── KNOWN-PROBLEMS L80 ──
//
// `loadTrustedAddresses` fires one live RPC probe per registry candidate. The
// list was 25 addresses when the code was written and became 194 the day the
// canonical stock-token registry was synced (L78); the unbounded `Promise.all`
// then rate-limited itself, 15 of 194 probes came back transient, and each one
// replayed stored trust without re-confirming the beacon the badge promises.
//
// WIRING, not logic (§8 #10): the defect is the ABSENCE of a bound at one call
// site, and any test that supplies its own probe function bounds nothing.

const src = readFileSync("lib/config/trusted-addresses.ts", "utf8");
const loader = src.slice(src.indexOf("async function loadTrustedAddresses"));
const body = loader.slice(0, loader.indexOf("\nexport "));

test("the RWA probe fan-out is bounded, not a Promise.all over the whole registry", () => {
  assert.match(body, /mapBounded\(candidates, PROBE_CONCURRENCY,/);
  // The specific shape that regressed. `Promise.all` over `candidates` in any
  // spelling is the bug returning.
  assert.doesNotMatch(body, /Promise\.all\(\s*candidates/);
});

test("the bound is a real number and stays modest", () => {
  const m = src.match(/const PROBE_CONCURRENCY = (\d+);/);
  assert.ok(m, "PROBE_CONCURRENCY must be a literal so it is reviewable");
  const n = Number(m![1]);
  assert.ok(n >= 1 && n <= 16, `expected a modest cap, got ${n}`);
});

test("a degraded refill is counted and stated once, not only warned per address", () => {
  // 194 individual console.warns are invisible; the fraction is the signal, and
  // a silent degradation is the one that grows with the registry.
  assert.match(body, /RC_RWA_PROBE_DEGRADED/);
  assert.match(body, /lastProbeTransientCount = transient/);
  assert.match(src, /export function rwaProbeTransientCount\(\)/);
});

// §8 #10 — this counter's docstring claimed "/api/health" reads it; that route
// has never existed, so the count was dead for its whole life. Assert the CALL
// SITE, not the function: a logic test could never have failed on this.
test("the RWA probe degradation counter has a real consumer", () => {
  const page = readFileSync(
    new URL("../app/admin/(dashboard)/trusted/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /rwaProbeTransientCount\(\)/);
  // The prime must be awaited BEFORE the read, or 0 means "never probed".
  const primeAt = page.indexOf("await primeTrustedAddresses()");
  const readAt = page.indexOf("rwaProbeTransientCount()");
  assert.ok(primeAt > -1 && primeAt < readAt, "prime must precede the counter read");
});
