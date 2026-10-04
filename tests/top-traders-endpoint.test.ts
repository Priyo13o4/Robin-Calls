import test from "node:test";
import assert from "node:assert/strict";
import { resolveTopTraders } from "../app/api/scan/[address]/traders/route";
import * as ledger from "../lib/data/ledger";
import { mock } from "node:test";
/**
 * M18 — GET /api/scan/[address]/traders. The route handler itself is a thin
 * Next.js wrapper (params-await + database() + JSON response) with no
 * precedent test harness in this repo, so this exercises the extracted
 * `resolveTopTraders(rawAddress)` directly: address normalization →
 * latest-verdict lookup → primary_pool_address → fetchTopTraders. Never a
 * scan, never a receipt, always best-effort.
 */

type Row = { primary_pool_address: string | null } | null;

function fakeDb(row: Row, onEq?: (column: string, value: string) => void) {
  return async (address: string) => {
    onEq?.("token_address", address);
    return row as any;
  };
}


function mockFetch(handler: (url: string) => { status: number; body: unknown }) {
  const original = globalThis.fetch;
  let calledWith: string | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calledWith = String(input);
    const { status, body } = handler(calledWith);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    calledWith: () => calledWith,
  };
}

function untouchableFetch() {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("fetchTopTraders should not have been called");
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const TOKEN = "0x00000000C0ffeE00000000000000000000DeAD01";
const POOL = "0x000000001111111111111111111111111111AaaA";

test("invalid address never touches the DB — returns null", async () => {
  const result = await resolveTopTraders("not-an-address", async () => {
    throw new Error("db should not have been queried");
  });
  assert.equal(result, null);
});

test("returns null if no verdict is on record", async () => {
  const result = await resolveTopTraders(TOKEN);
  assert.equal(result, null);
});

test("no verdict on record for this token — returns null", async () => {
  const restoreFetch = untouchableFetch();
  try {
    const mockDb = fakeDb(null);
    const result = await resolveTopTraders(TOKEN, mockDb);
    assert.equal(result, null);
  } finally {
    restoreFetch();
  }
});

test("verdict on record but no primary_pool_address — returns null, never calls GeckoTerminal", async () => {
  const restoreFetch = untouchableFetch();
  try {
    const mockDb = fakeDb({ primary_pool_address: null });
    const result = await resolveTopTraders(TOKEN, mockDb);
    assert.equal(result, null);
  } finally {
    restoreFetch();
  }
});

test("verdict on record with a pool — looks up by the normalized/lowercased address, fetches trades for that pool with a null poolCreatedAt", async () => {
  let queriedAddress: string | null = null;
  const mockDb = fakeDb({ primary_pool_address: POOL.toLowerCase() }, (col, val) => {
    assert.equal(col, "token_address");
    queriedAddress = val;
  });

  const gt = mockFetch((url) => {
    assert.ok(
      url.includes(`/pools/${POOL.toLowerCase()}/trades`),
      `expected the pool address in the trades URL, got ${url}`
    );
    return {
      status: 200,
      body: {
        data: [
          {
            attributes: {
              tx_from_address: "0xWallet00000000000000000000000000000001",
              kind: "buy",
              volume_in_usd: "1234.5",
              block_timestamp: "2026-07-20T00:00:00Z",
            },
          },
        ],
      },
    };
  });

  try {
    const result = await resolveTopTraders(TOKEN, mockDb);
    assert.equal(queriedAddress, TOKEN);
    assert.ok(result !== null);
    assert.equal(result!.length, 1);
    assert.equal(result![0].address, "0xwallet00000000000000000000000000000001");
    assert.equal(result![0].buys, 1);
    assert.equal(result![0].volumeUsd, 1234.5);
    // A single buy earns no behavioral tag — one trade is neither a cadence
    // nor a ping-pong.
    assert.deepEqual(result![0].tags, []);
  } finally {
    gt.restore();
  }
});

test("GeckoTerminal failure degrades to null, not a thrown error", async () => {
  const mockDb = fakeDb({ primary_pool_address: POOL.toLowerCase() });
  const gt = mockFetch(() => ({ status: 500, body: { error: "boom" } }));
  try {
    const result = await resolveTopTraders(TOKEN, mockDb);
    assert.equal(result, null);
  } finally {
    gt.restore();
  }
});
