import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

const store = new Map<string, { lastBlock: bigint; rows: unknown[] }>();

mock.module("../lib/data/log-index", {
  namedExports: {
    readLogIndex: async (cacheKey: string) => store.get(cacheKey) ?? null,
    writeLogIndex: async (cacheKey: string, lastBlock: bigint, rows: unknown[]) => {
      store.set(cacheKey, { lastBlock, rows });
    },
  },
});

type IndexLogs = typeof import("../lib/rpc/log-index").indexLogs;
async function loadIndexLogs(): Promise<IndexLogs> {
  return (await import("../lib/rpc/log-index")).indexLogs;
}

interface Row {
  id: number;
  block?: number;
}

test("explorer null + fetchColdRpc rows: stored and complete:true (assert writeLogIndex called with safeHead)", async () => {
  store.clear();
  const coldRpcRows: Row[] = [{ id: 1, block: 100 }, { id: 2, block: 200 }];
  const indexLogs = await loadIndexLogs();

  const index = await indexLogs<Row>({
    cacheKey: "v3mint:0xcold1",
    head: 1000n, // safeHead = 995
    fetchExplorer: async () => null,
    fetchColdRpc: async (from, to) => {
      assert.equal(from, 0n);
      assert.equal(to, 995n);
      return coldRpcRows;
    },
    fetchRange: async () => {
      throw new Error("cold fill must not touch incremental range path");
    },
  });

  assert.equal(index.readAny, true);
  assert.equal(index.complete, true);
  assert.deepEqual(index.rows, coldRpcRows);

  const entry = store.get("v3mint:0xcold1");
  assert.equal(entry?.lastBlock, 995n);
  assert.deepEqual(entry?.rows, coldRpcRows);
});

test("explorer null + fetchColdRpc null: readAny:false and complete:false", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();

  const index = await indexLogs<Row>({
    cacheKey: "v3mint:0xcold2",
    head: 1000n,
    fetchExplorer: async () => null,
    fetchColdRpc: async () => null,
    fetchRange: async () => {
      throw new Error("cold path");
    },
  });

  assert.equal(index.readAny, false);
  assert.equal(index.complete, false);
  assert.equal(index.rows.length, 0);
  assert.equal(store.has("v3mint:0xcold2"), false);

  // Positive control: when fetchColdRpc returns rows, readAny and complete become true.
  const control = await indexLogs<Row>({
    cacheKey: "v3mint:0xcold2_ctrl",
    head: 1000n,
    fetchExplorer: async () => null,
    fetchColdRpc: async () => [{ id: 1 }],
    fetchRange: async () => [],
  });
  assert.equal(control.readAny, true);
  assert.equal(control.complete, true);
});

test("explorer OK: fetchColdRpc NOT called (positive control: called when explorer null)", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();
  let coldRpcCalled = false;
  const explorerRows: Row[] = [{ id: 5, block: 50 }];

  const index = await indexLogs<Row>({
    cacheKey: "v3mint:0xcold3",
    head: 1000n,
    fetchExplorer: async () => explorerRows,
    fetchColdRpc: async () => {
      coldRpcCalled = true;
      return [{ id: 99 }];
    },
    fetchRange: async () => [],
  });

  assert.equal(coldRpcCalled, false, "fetchColdRpc must not be called when explorer returns rows");
  assert.deepEqual(index.rows, explorerRows);

  // Positive control: called when explorer returns null.
  let controlCalled = false;
  await indexLogs<Row>({
    cacheKey: "v3mint:0xcold3_ctrl",
    head: 1000n,
    fetchExplorer: async () => null,
    fetchColdRpc: async () => {
      controlCalled = true;
      return [{ id: 42 }];
    },
    fetchRange: async () => [],
  });
  assert.equal(controlCalled, true, "fetchColdRpc must be called when explorer returns null");
});

test("warm branch never calls fetchColdRpc", async () => {
  store.clear();
  const indexLogs = await loadIndexLogs();

  // Seed stored entry ending at safeHead 995.
  await indexLogs<Row>({
    cacheKey: "v3mint:0xwarm",
    head: 1000n,
    fetchExplorer: async () => [{ id: 1, block: 10 }],
    fetchRange: async () => [],
  });

  let warmColdRpcCalled = false;
  const warm = await indexLogs<Row>({
    cacheKey: "v3mint:0xwarm",
    head: 1050n, // safeHead 1045, narrow gap (50 blocks)
    fetchExplorer: async () => {
      throw new Error("incremental RPC expected on narrow warm top-up");
    },
    fetchRange: async (from) => [{ id: 2, block: Number(from) }],
    fetchColdRpc: async () => {
      warmColdRpcCalled = true;
      return [{ id: 999 }];
    },
  });

  assert.equal(warmColdRpcCalled, false, "warm top-up branch must never call fetchColdRpc");
  assert.equal(warm.complete, true);
  assert.equal(warm.rows.length, 2);

  // Positive control: cold path on fresh key calls fetchColdRpc when explorer is null.
  let freshColdRpcCalled = false;
  await indexLogs<Row>({
    cacheKey: "v3mint:0xfresh",
    head: 1050n,
    fetchExplorer: async () => null,
    fetchRange: async () => [],
    fetchColdRpc: async () => {
      freshColdRpcCalled = true;
      return [{ id: 9 }];
    },
  });
  assert.equal(freshColdRpcCalled, true, "cold path must call fetchColdRpc when explorer is null");
});
