import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type { ExplorerAddressInfo } from "../lib/explorer/types";

/**
 * The `/addresses/:id` read-through cache.
 *
 * The speed-up is not the risky part. This payload carries `is_scam` and
 * `public_tags`, which feed `checkExplorerScamFlag` — a CRITICAL check — so the
 * failure to prevent is a FAULT being stored, or a stale entry being served to
 * cover an outage. Either turns "we could not look" into "we looked and it was
 * clean", the §4 bug class this codebase keeps re-fixing.
 */

const ADDR = "0xAbCdEf0123456789012345678901234567890123";
const CLEAN: ExplorerAddressInfo = { is_contract: true, is_scam: false };

let liveCalls = 0;
let liveResult: ExplorerAddressInfo | null = CLEAN;
let stored: { payload: unknown; fetchedAt: Date } | null = null;
let writes: { address: string; payload: unknown }[] = [];

mock.module("../lib/explorer/blockscout", {
  namedExports: {
    explorer: {
      addressInfo: async () => {
        liveCalls += 1;
        return liveResult;
      },
      // L39 — addressInfoCached reads through the DETAILED form so a receipt can
      // name the adapter that answered. The mock must cover it too, or the real
      // router (and with it the live internet) answers instead — which is
      // exactly how this file's six failures happened.
      addressInfoDetailed: async () => {
        const info = await (async () => {
          liveCalls += 1;
          return liveResult;
        })();
        return { info, adapterId: info === null ? null : "blockscout" };
      },
    },
  },
});

mock.module("../lib/data/explorer-address-cache", {
  namedExports: {
    readAddressInfoCache: async () => stored,
    writeAddressInfoCache: async (address: string, payload: unknown) => {
      writes.push({ address, payload });
    },
  },
});

type Fn = typeof import("../lib/explorer/address-info").addressInfoCached;
async function load(): Promise<Fn> {
  return (await import("../lib/explorer/address-info")).addressInfoCached;
}

function reset(ttl?: string) {
  liveCalls = 0;
  liveResult = CLEAN;
  stored = null;
  writes = [];
  if (ttl === undefined) delete process.env.EXPLORER_ADDRESS_INFO_TTL_MINUTES;
  else process.env.EXPLORER_ADDRESS_INFO_TTL_MINUTES = ttl;
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

test("a fresh entry is served without touching the network", async () => {
  reset("60");
  stored = { payload: { is_contract: true, is_scam: true }, fetchedAt: minutesAgo(5) };
  const addressInfoCached = await load();

  const out = await addressInfoCached(ADDR);
  assert.equal(out?.is_scam, true);
  assert.equal(liveCalls, 0, "went to the network despite a fresh entry");
});

test("an expired entry is refetched, not served", async () => {
  reset("60");
  // The stale copy says clean; the live source says scam. Serving the stale one
  // is precisely the failure this TTL exists to bound.
  stored = { payload: { is_contract: true, is_scam: false }, fetchedAt: minutesAgo(61) };
  liveResult = { is_contract: true, is_scam: true };
  const addressInfoCached = await load();

  const out = await addressInfoCached(ADDR);
  assert.equal(liveCalls, 1);
  assert.equal(out?.is_scam, true, "served an expired entry");
});

test("a FAULT is never stored", async () => {
  reset("60");
  liveResult = null; // fault or 404 — both arrive as null
  const addressInfoCached = await load();

  assert.equal(await addressInfoCached(ADDR), null);
  assert.deepEqual(writes, [], "cached a null as if it were a fact");
});

test("a failed refresh returns null rather than falling back to a stale entry", async () => {
  // Deliberate: serving the last known answer during an outage would report
  // "we looked and it was clean" for a check that must say "we could not look".
  // The pipeline's explorer gate already handles null.
  reset("60");
  stored = { payload: { is_contract: true, is_scam: false }, fetchedAt: minutesAgo(120) };
  liveResult = null;
  const addressInfoCached = await load();

  assert.equal(await addressInfoCached(ADDR), null, "served a stale entry over a fault");
});

test("a successful read is written back", async () => {
  reset("60");
  const addressInfoCached = await load();

  await addressInfoCached(ADDR);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].payload, CLEAN);
});

test("TTL 0 disables the cache entirely — no read, no write", async () => {
  // The escape hatch: it must be possible to turn this off without a deploy.
  // `|| 60` instead of an explicit finite check would silently ignore 0.
  reset("0");
  stored = { payload: { is_contract: true, is_scam: false }, fetchedAt: minutesAgo(1) };
  const addressInfoCached = await load();

  await addressInfoCached(ADDR);
  assert.equal(liveCalls, 1, "used the cache when it was switched off");
  assert.deepEqual(writes, [], "wrote to a disabled cache");
});

test("an unset or junk TTL falls back to the 60-minute default", async () => {
  reset();
  stored = { payload: CLEAN, fetchedAt: minutesAgo(30) };
  let addressInfoCached = await load();
  await addressInfoCached(ADDR);
  assert.equal(liveCalls, 0, "default TTL did not cover a 30-minute-old entry");

  reset("not-a-number");
  stored = { payload: CLEAN, fetchedAt: minutesAgo(90) };
  addressInfoCached = await load();
  await addressInfoCached(ADDR);
  assert.equal(liveCalls, 1, "junk TTL should fall back to 60, not to infinity");
});

test("a future-dated row (clock skew) is treated as fresh, never as infinitely stale", async () => {
  reset("60");
  stored = { payload: CLEAN, fetchedAt: new Date(Date.now() + 10 * 60_000) };
  const addressInfoCached = await load();

  await addressInfoCached(ADDR);
  assert.equal(liveCalls, 0);
});
