import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

/**
 * `indexLogs` routing behavior, over an in-memory stand-in for the durable
 * store. What each path costs is the whole point of this module, so these
 * assert WHICH SOURCE was consulted (and which was not), not just the rows.
 *
 * The store's own persistence contract — that the write payload's keys are real
 * columns, and that the schema matches the migration — is
 * `tests/log-index-store.test.ts`. Mocking the data module here would hide
 * exactly that class of bug, so it is tested separately rather than not at all.
 */

// Stands in for lib/data/log-index (Postgres). Records what was stored so the
// tests can assert the extended lastBlock was written back, not just the rows.
const store = new Map<string, { lastBlock: bigint; rows: unknown[] }>();

mock.module("../lib/data/log-index", {
  namedExports: {
    readLogIndex: async (cacheKey: string) => store.get(cacheKey) ?? null,
    writeLogIndex: async (cacheKey: string, lastBlock: bigint, rows: unknown[]) => {
      store.set(cacheKey, { lastBlock, rows });
    },
  },
});

// Imported inside each test (not top-level) because esbuild's cjs transform
// rejects top-level await; the mock above is registered before any import runs.
type IndexLogs = typeof import("../lib/rpc/log-index").indexLogs;
async function loadIndexLogs(): Promise<IndexLogs> {
  return (await import("../lib/rpc/log-index")).indexLogs;
}

interface Row {
  owner: string;
  block: number;
}

function rows(from: number, to: number): Row[] {
  const out: Row[] = [];
  for (let b = from; b <= to; b++) out.push({ owner: `0x${(b % 16).toString(16).repeat(40)}`, block: b });
  return out;
}

test("cold fill stores the rows under the call site's own key, at the safe head", async () => {
  store.clear();
  const cold = rows(1, 500);
  const indexLogs = await loadIndexLogs();
  const index = await indexLogs<Row>({
    cacheKey: "v3mint:0xpool",
    head: 1000n, // safeHead = 995
    fetchExplorer: async () => cold,
    fetchRange: async () => {
      throw new Error("cold fill must not touch the incremental RPC path");
    },
  });

  assert.equal(index.readAny, true);
  assert.equal(index.complete, true);
  assert.deepEqual(index.rows, cold);

  // The key is the caller's, unprefixed — it is a primary key now, not a
  // namespaced cache key, and nothing may quietly rewrite it.
  assert.deepEqual([...store.keys()], ["v3mint:0xpool"]);
  const entry = store.get("v3mint:0xpool");
  // Coverage is recorded as the CONFIRMED head, not the raw head: storing 1000
  // here would bake an unconfirmed block into a prefix nothing ever re-reads.
  assert.equal(entry?.lastBlock, 995n);
  assert.deepEqual(entry?.rows, cold);
});

test("warm rescan reads the stored prefix and only tops up the new range", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();
  await indexLogs<Row>({
    cacheKey: "v3mint:0xpool",
    head: 1000n, // safeHead 995
    fetchExplorer: async () => rows(1, 995),
    fetchRange: async () => {
      throw new Error("cold path");
    },
  });

  let topUpFrom: bigint | null = null;
  const warm = await indexLogs<Row>({
    cacheKey: "v3mint:0xpool",
    head: 1100n, // safeHead 1095 -> incremental 996..1095
    fetchExplorer: async () => {
      throw new Error("warm rescan must not cold-fill from the explorer");
    },
    fetchRange: async (from) => {
      topUpFrom = from;
      return rows(Number(from), 1095);
    },
  });

  assert.equal(topUpFrom, 996n, "incremental read did not start at lastBlock+1");
  assert.equal(warm.rows.length, 1095);
  assert.equal(warm.rows[0].block, 1);
  assert.equal(warm.rows.at(-1)?.block, 1095);
});

// ── wide top-up routes to the explorer (plan §7 step 1) ──────
//
// A stored entry that has gone stale does not need "an increment" — at ~700k
// blocks/day against a 10k-block max getLogs window, a days-old entry needs
// hundreds of sequential RPC windows. Live 2026-08-01 that was a 5.2M gap =
// 512 windows, and the scan died on its 90s deadline. Past the threshold the
// explorer answers the same question in one call.

/** Seed a stored entry ending at `head - 5`, then rescan at a much later head. */
async function seedThenRescan(
  key: string,
  seedHead: bigint,
  rescanHead: bigint,
  opts: {
    explorer: (from: bigint, to: bigint) => Promise<Row[] | null>;
    range: (from: bigint, to: bigint) => Promise<Row[]>;
  },
) {
  const indexLogs = await loadIndexLogs();
  await indexLogs<Row>({
    cacheKey: key,
    head: seedHead,
    fetchExplorer: async () => rows(1, 10),
    fetchRange: async () => {
      throw new Error("seed must cold-fill");
    },
  });
  return indexLogs<Row>({
    cacheKey: key,
    head: rescanHead,
    fetchExplorer: opts.explorer,
    fetchRange: opts.range,
  });
}

test("a top-up wider than the threshold goes to the explorer, not a long RPC walk", async () => {
  store.clear();
  let rpcCalls = 0;
  let explorerFrom: bigint | null = null;
  // Seed ends at 995; rescan head 1,000,000 (safeHead 999,995) is a ~999k gap —
  // ~100 RPC windows, well over the 100k-block threshold.
  const index = await seedThenRescan("v3mint:0xstale", 1000n, 1_000_000n, {
    explorer: async (from) => {
      explorerFrom = from;
      return rows(996, 1000);
    },
    range: async () => {
      rpcCalls += 1;
      return [];
    },
  });

  assert.equal(rpcCalls, 0, "a wide gap must not be walked over RPC");
  assert.equal(explorerFrom, 996n, "the explorer top-up must start at lastBlock+1");
  assert.equal(index.complete, true);
  assert.equal(index.readAny, true);
  assert.equal(index.rows.length, 15, "prefix (10) + explorer tail (5)");
});

test("a top-up below the threshold still uses the cheap incremental RPC read", async () => {
  store.clear();
  let explorerCalls = 0;
  let rangeFrom: bigint | null = null;
  // Seed ends at 995; rescan safeHead 50,995 is a 50k gap — under the threshold.
  const index = await seedThenRescan("v3mint:0xfresh", 1000n, 51_000n, {
    explorer: async () => {
      explorerCalls += 1;
      return [];
    },
    range: async (from) => {
      rangeFrom = from;
      return rows(996, 1000);
    },
  });

  assert.equal(explorerCalls, 0, "a narrow gap must not pay a Blockscout round trip");
  assert.equal(rangeFrom, 996n);
  assert.equal(index.rows.length, 15);
  assert.equal(index.complete, true);
});

test("explorer unavailable on the wide path serves the prefix as INCOMPLETE, never an RPC walk", async () => {
  store.clear();
  let rpcCalls = 0;
  const index = await seedThenRescan("v3mint:0xdown", 1000n, 1_000_000n, {
    explorer: async () => null, // the UNKNOWN signal
    range: async () => {
      rpcCalls += 1;
      return [];
    },
  });

  // The walk this branch avoids is the failure, not the remedy: falling back to
  // RPC here is what turned a stale entry into a 90s deadline death.
  assert.equal(rpcCalls, 0, "fell back to the RPC walk the wide path exists to avoid");
  assert.equal(index.readAny, true, "the stored prefix is real, verified data");
  assert.equal(index.complete, false, "the tail is UNKNOWN and must be flagged");
  assert.equal(index.rows.length, 10, "the prefix is served, not an empty set");
});

test("a wide top-up re-stores the extended index, so the next rescan is narrow", async () => {
  store.clear();
  await seedThenRescan("v3mint:0xrestore", 1000n, 1_000_000n, {
    explorer: async () => rows(996, 1000),
    range: async () => {
      throw new Error("wide path");
    },
  });

  // If the wide path had not written back safeHead, this rescan would see the
  // original 995 lastBlock and take the wide path forever.
  const indexLogs = await loadIndexLogs();
  let rangeFrom: bigint | null = null;
  const third = await indexLogs<Row>({
    cacheKey: "v3mint:0xrestore",
    head: 1_000_100n, // safeHead 1,000,095 — 100 blocks past the stored 999,995
    fetchExplorer: async () => {
      throw new Error("the extended index was not stored — cold-filled again");
    },
    fetchRange: async (from) => {
      rangeFrom = from;
      return [];
    },
  });
  assert.equal(rangeFrom, 999_996n, "did not resume from the extended lastBlock");
  assert.equal(third.rows.length, 15);
});

// ── single-flight (plan §7 step 3) ───────────────────────────
//
// Concurrent scans of the same token each ran their own cold fill of the same
// key — the cold-cache stampede CLAUDE.md §5 requires a guard against, missing
// here. It becomes load-bearing the moment MCP lets an agent fan out over a
// token list. lib/explorer/gate.ts caps explorer CONCURRENCY but does not
// dedupe identical queries, so it is not a substitute.

/** A promise plus its resolver, so a test can hold a fill open deterministically. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("concurrent fills of the same key collapse to ONE cold fill", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();
  const gate = deferred<Row[]>();
  let coldFills = 0;

  const call = () =>
    indexLogs<Row>({
      cacheKey: "v3mint:0xherd",
      head: 1000n,
      fetchExplorer: async () => {
        coldFills += 1;
        return gate.promise;
      },
      fetchRange: async () => [],
    });

  const leader = call();
  await new Promise((r) => setImmediate(r)); // let the leader register its flight
  const followers = [call(), call(), call()];

  gate.resolve(rows(1, 5));
  const all = await Promise.all([leader, ...followers]);

  assert.equal(coldFills, 1, "each concurrent scan paid its own Blockscout cold fill");
  for (const index of all) {
    assert.equal(index.rows.length, 5, "a follower got a different answer than the leader");
    assert.equal(index.complete, true);
  }
});

test("a follower re-runs rather than adopting the leader's older coverage", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();
  const gate = deferred<Row[]>();

  // The leader fills to safeHead 995. The follower arrives at a later head, so
  // its own safeHead is 1,095 — adopting the leader's answer would report
  // coverage to 1,095 while actually holding only 995, which is precisely the
  // "unknown laundered into a fact" this codebase keeps getting bitten by.
  const leader = indexLogs<Row>({
    cacheKey: "v3mint:0xrace",
    head: 1000n,
    fetchExplorer: async () => gate.promise,
    fetchRange: async () => [],
  });
  await new Promise((r) => setImmediate(r));

  let topUp: [bigint, bigint] | null = null;
  const follower = indexLogs<Row>({
    cacheKey: "v3mint:0xrace",
    head: 1100n,
    fetchExplorer: async () => {
      throw new Error("the follower must reuse the leader's stored prefix, not cold-fill");
    },
    fetchRange: async (from, to) => {
      topUp = [from, to];
      return rows(996, 1000);
    },
  });

  gate.resolve(rows(1, 10));
  await leader;
  const index = await follower;

  assert.deepEqual(topUp, [996n, 1095n], "follower did not top up its own tail");
  assert.equal(index.rows.length, 15, "leader prefix (10) + the follower's own tail (5)");
  assert.equal(store.get("v3mint:0xrace")?.lastBlock, 1095n);
});

test("a failed leader does not poison the followers, and the slot is released", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();
  const gate = deferred<Row[]>();

  const leader = indexLogs<Row>({
    cacheKey: "v3mint:0xboom",
    head: 1000n,
    fetchExplorer: async () => gate.promise,
    fetchRange: async () => [],
  });
  await new Promise((r) => setImmediate(r));

  const follower = indexLogs<Row>({
    cacheKey: "v3mint:0xboom",
    head: 1000n,
    fetchExplorer: async () => rows(1, 3),
    fetchRange: async () => [],
  });

  gate.reject(new Error("explorer exploded"));
  await assert.rejects(leader, /explorer exploded/);

  // The follower pays the full path itself rather than inheriting a failure —
  // a transient fault must never be cached as an answer (CLAUDE.md §4).
  const index = await follower;
  assert.equal(index.rows.length, 3);
  assert.equal(index.readAny, true);

  // And the flight slot was released: a later call still works.
  const third = await indexLogs<Row>({
    cacheKey: "v3mint:0xboom",
    head: 1000n,
    fetchExplorer: async () => {
      throw new Error("should be served from the store");
    },
    fetchRange: async () => [],
  });
  assert.equal(third.rows.length, 3);
});

test("different keys are never serialized behind one another", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();
  const gate = deferred<Row[]>();

  const blocked = indexLogs<Row>({
    cacheKey: "v3mint:0xslow",
    head: 1000n,
    fetchExplorer: async () => gate.promise,
    fetchRange: async () => [],
  });
  await new Promise((r) => setImmediate(r));

  // A different pool must not wait on it — the guard is per subject, not global.
  const other = await indexLogs<Row>({
    cacheKey: "v3mint:0xfast",
    head: 1000n,
    fetchExplorer: async () => rows(1, 2),
    fetchRange: async () => [],
  });
  assert.equal(other.rows.length, 2);

  gate.resolve(rows(1, 9));
  assert.equal((await blocked).rows.length, 9);
});

test("a large index is stored, not silently dropped for being big", async () => {
  store.clear();
  // ~20k rows, well over the retired 400KB ceiling. That ceiling silently
  // refused the write, so the busiest pools — the hottest, most-rescanned ones
  // — cold-filled Blockscout on every single scan, forever (the SWOGE V3
  // custody failure). Size is now a report, never a refusal.
  const big = rows(1, 20_000);
  const rawBytes = Buffer.byteLength(JSON.stringify(big));
  assert.ok(rawBytes > 400_000, `fixture too small (${rawBytes}B) to exercise the old ceiling`);

  const indexLogs = await loadIndexLogs();
  const index = await indexLogs<Row>({
    cacheKey: "v3mint:0xbig",
    head: 30_000n,
    fetchExplorer: async () => big,
    fetchRange: async () => {
      throw new Error("cold path");
    },
  });
  assert.equal(index.readAny, true);
  assert.equal(index.rows.length, 20_000);
  // Proof it was actually cached (not silently dropped like the old bug): a
  // second scan is served warm without cold-filling.
  const second = await indexLogs<Row>({
    cacheKey: "v3mint:0xbig",
    head: 30_000n,
    fetchExplorer: async () => {
      throw new Error("large index was not cached — cold-filled again");
    },
    fetchRange: async () => [],
  });
  assert.equal(second.rows.length, 20_000);
});
