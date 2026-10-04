import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── KNOWN-PROBLEMS L7: a lagging indexer's short answer became permanent ──
//
// Chain-verified on PACK (0x0145acbc…): two V4 pools, cold-filled in the same
// scan, each lost events from the SAME ~50-block band — blocks 34,991,037 to
// 34,991,086, with events present on both sides. The explorer had not indexed
// that band yet; it answered the range query successfully with the blocks it
// had, and the store recorded `complete: true`.
//
// The cost was not the four rows. `getLiquidity()` is an exact identity, so
// four missing rows out of 4,490 made the netting miss, the L5 guard fire, and
// the pool holding 65.64% of the token drop out of custody entirely — leaving a
// FAIL published about a 6.28% pool. Every later top-up appends from
// `lastBlock + 1`, so the hole could never be revisited.
//
// These tests are about the REPAIR, and the dangerous direction is the repair
// itself: re-reading is only safe because the caller re-tests the proof.

type Row = { n: number };

// The data module is mocked per-process, so this file owns one shared fake.
const state: {
  rows: Row[] | null;
  lastBlock: bigint;
  writes: { lastBlock: bigint; count: number }[];
  explorer: (from: bigint, to: bigint) => Promise<Row[] | null>;
  rangeCalls: number;
} = {
  rows: null,
  lastBlock: 0n,
  writes: [],
  explorer: async () => [],
  rangeCalls: 0,
};

mock.module("../lib/data/log-index", {
  namedExports: {
    readLogIndex: async () =>
      state.rows === null ? null : { rows: state.rows, lastBlock: state.lastBlock },
    writeLogIndex: async (_k: string, lastBlock: bigint, rows: unknown[]) => {
      state.writes.push({ lastBlock, count: rows.length });
      state.rows = rows as Row[];
      state.lastBlock = lastBlock;
    },
  },
});

// Loaded AFTER mock.module: a static import would bind the real data module
// before the mock is installed, and every assertion here would test nothing.
async function run(refill: boolean, head = 1000n) {
  const { indexLogs } = await import("../lib/rpc/log-index");
  return indexLogs<Row>({
    cacheKey: "test:pool",
    head,
    refill,
    fetchExplorer: (f, t) => state.explorer(f, t),
    fetchRange: async () => {
      state.rangeCalls++;
      return [];
    },
  });
}

test("without refill, a stored index is served and never re-read", async () => {
  state.rows = [{ n: 1 }, { n: 2 }];
  state.lastBlock = 995n; // == safeHead (1000 - 5), so no top-up either
  state.writes = [];
  let explorerCalls = 0;
  state.explorer = async () => {
    explorerCalls++;
    return [{ n: 1 }, { n: 2 }, { n: 3 }];
  };

  const out = await run(false);
  assert.deepEqual(out.rows, [{ n: 1 }, { n: 2 }]);
  assert.equal(explorerCalls, 0, "the whole point of the store is not paying for this");
  assert.equal(out.complete, true);
});

test("refill discards the stored prefix and re-reads the whole history", async () => {
  // The repair itself: the stored copy is short, the source now has the band.
  state.rows = [{ n: 1 }, { n: 2 }];
  state.lastBlock = 995n;
  state.writes = [];
  state.explorer = async () => [{ n: 1 }, { n: 2 }, { n: 3 }];

  const out = await run(true);
  assert.deepEqual(out.rows, [{ n: 1 }, { n: 2 }, { n: 3 }]);
  assert.equal(out.complete, true);
  assert.equal(state.writes.length, 1, "the repaired history must be persisted");
  assert.equal(state.writes[0].count, 3);
});

test("a refill that comes back SHORTER keeps the stored copy", async () => {
  // Append-only history over a range that ends later cannot legitimately shrink.
  // Fewer rows means the source is lagging harder than when we stored — trading
  // one hole for a bigger one is not a repair.
  state.rows = [{ n: 1 }, { n: 2 }, { n: 3 }];
  state.lastBlock = 900n;
  state.writes = [];
  state.explorer = async () => [{ n: 1 }];

  const out = await run(true);
  assert.deepEqual(out.rows, [{ n: 1 }, { n: 2 }, { n: 3 }], "the better copy survives");
  assert.equal(state.writes.length, 0, "and the worse one is never written");
  assert.equal(out.complete, false, "the repair did not land, and says so");
});

test("a refill the source cannot answer does not erase the prefix", async () => {
  // An explorer outage during a repair must not cost us the history we had.
  state.rows = [{ n: 1 }, { n: 2 }];
  state.lastBlock = 900n;
  state.writes = [];
  state.explorer = async () => null;

  const out = await run(true);
  assert.deepEqual(out.rows, [{ n: 1 }, { n: 2 }]);
  assert.equal(out.readAny, true, "we did read something — the stored prefix is real data");
  assert.equal(out.complete, false);
  assert.equal(state.writes.length, 0);
});

test("a cold fill with nothing stored is unchanged by any of this", async () => {
  state.rows = null;
  state.lastBlock = 0n;
  state.writes = [];
  state.explorer = async () => [{ n: 7 }];

  const out = await run(false);
  assert.deepEqual(out.rows, [{ n: 7 }]);
  assert.equal(out.complete, true);
});
