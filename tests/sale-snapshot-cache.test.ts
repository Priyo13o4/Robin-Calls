import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/* ── the first-paint cache ─────────────────────────────────────────────────
   /token-sale and /leaderboard are force-dynamic, so an uncached
   readSaleSnapshot is 3 RPC requests per page view on the keyed pool, scaling
   straight with traffic over numbers every visitor shares. The cache is only
   safe under three rules, and each one has already been broken elsewhere in
   this repo.                                                                */

test("both page renders go through the cached reader, the snapshot job does not", () => {
  for (const f of ["app/token-sale/page.tsx", "app/leaderboard/page.tsx"]) {
    const src = read(f);
    assert.match(src, /readSaleSnapshotCached\(/, `${f} reads the chain uncached on every request`);
  }
  // The airdrop snapshot's whole purpose is a completeness proof against the
  // contract's live totalRaised. A proof drawn over a 5s-old value is not one.
  const job = read("lib/referrals/snapshot.ts");
  assert.doesNotMatch(job, /readSaleSnapshotCached/, "the completeness proof must read live");
  assert.match(job, /readSaleSnapshot\(/);
});

test("the cache is bounded, single-flighted, and keyed by chain AND address", () => {
  const src = read("lib/sale/server.ts");
  const fn = src.slice(src.indexOf("export async function readSaleSnapshotCached"));

  assert.match(src, /SNAPSHOT_TTL_MS = [\d_]+/, "§5: every cache entry has a bounded TTL");
  assert.match(fn, /inFlight\.get\(key\)/, "§5: a cold cache is hit by every concurrent request at once");
  assert.match(
    src,
    /keyFor = \(chainId: number, contract: string\)/,
    "a snapshot does not say which sale it is about on its own (§8 #21)",
  );
});

test("a faulted read is never stored", () => {
  const src = read("lib/sale/server.ts");
  const fn = src.slice(src.indexOf("export async function readSaleSnapshotCached"));
  assert.match(
    fn,
    /snapshot\.view\.faults\.length === 0/,
    "caching a faulted read republishes one bad answer to everyone for the whole TTL (§4)",
  );
});
