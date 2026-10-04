import test from "node:test";
import assert from "node:assert/strict";
import { createScanContext, runWithScanContext } from "../lib/observability/context";
import { blockscoutAdapter } from "../lib/explorer/blockscout";

/**
 * `addressTxWindowAsc`'s fault-vs-emptiness contract, tested at the MAPPING
 * layer rather than above it.
 *
 * This gap is why the bug existed. tests/lineage-funder-fetch.test.ts mocks
 * `explorer.addressTxWindowAsc` wholesale to pin `findFunder`'s use of
 * `sawWholeHistory` — so the one place that DECIDES `sawWholeHistory` had no
 * coverage at all, and shipped the §4 inversion the module's own comment warned
 * about: a throttled gateway returning
 *   {"status":"0","message":"NOTOK","result":"Max rate limit reached"}
 * was mapped to `{ items: [], sawWholeHistory: true }` — "we saw this wallet's
 * entire history and it never received anything". `findFunder` then skips its
 * descending fallback and `checkFundingLineage` publishes
 * "Funding lineage is clean. No stained wallets upstream."
 *
 * The response shapes below are the real ones, verified live against
 * api.blockscout.com/4663 on 2026-08-02.
 */

const ADDR = "0x000000000000000000000000000000000000dEaD";

function mockJson(body: unknown, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function windowAsc(limit = 100) {
  const ctx = createScanContext();
  return runWithScanContext(ctx, () => blockscoutAdapter.addressTxWindowAsc(ADDR, limit));
}

test("a rate-limit body is a FAULT (null), never an empty history", async () => {
  // THE regression. status "0" + a STRING result is the Etherscan-compatible
  // convention for an error, and it must not become "this wallet has no
  // transactions" — that publishes a clean funding-lineage PASS.
  const restore = mockJson({ status: "0", message: "NOTOK", result: "Max rate limit reached" });
  try {
    assert.equal(await windowAsc(), null, "a throttled gateway was read as 'no history'");
  } finally {
    restore();
  }
});

test("a null result is a FAULT (null), never an empty history", async () => {
  // Blockscout's invalid-parameter shape.
  const restore = mockJson({ status: "0", message: "Invalid parameter(s)", result: null });
  try {
    assert.equal(await windowAsc(), null);
  } finally {
    restore();
  }
});

test("a genuine 'No transactions found' IS an empty history, complete", async () => {
  // Verified live: the real no-records answer carries status "0" but result [],
  // an ARRAY — which is exactly why the removed status-based special case was
  // never needed for it. This wallet provably never received anything, so
  // `findFunder` is right to stop rather than pay the descending fallback.
  const restore = mockJson({ status: "0", message: "No transactions found", result: [] });
  try {
    const out = await windowAsc();
    assert.deepEqual(out, { items: [], sawWholeHistory: true });
  } finally {
    restore();
  }
});

test("a SHORT page proves the whole history was seen", async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({
    hash: `0x${i}`,
    from: "0xaaaa",
    to: ADDR,
    value: "1",
    blockNumber: String(100 + i),
    transactionIndex: "0",
    timeStamp: "1700000000",
  }));
  const restore = mockJson({ status: "1", message: "OK", result: rows });
  try {
    const out = await windowAsc(100);
    assert.equal(out?.items.length, 3);
    assert.equal(out?.sawWholeHistory, true);
  } finally {
    restore();
  }
});

test("a FULL page does NOT claim the whole history was seen", async () => {
  // Live-verified 2026-08-02 that the gateway honours `offset` exactly (10/50/
  // 100/200 requested -> 10/50/100/200 returned), which is the sole reason
  // `rows.length < limit` is sound proof. If it ever starts clamping, a
  // truncated window reads as complete and the false PASS returns.
  const rows = Array.from({ length: 5 }, (_, i) => ({
    hash: `0x${i}`,
    from: "0xaaaa",
    to: ADDR,
    value: "1",
    blockNumber: String(100 + i),
    transactionIndex: "0",
    timeStamp: "1700000000",
  }));
  const restore = mockJson({ status: "1", message: "OK", result: rows });
  try {
    const out = await windowAsc(5);
    assert.equal(out?.sawWholeHistory, false, "a full window was reported as a complete history");
  } finally {
    restore();
  }
});

test("an HTTP fault THROWS rather than resolving to an empty history", async () => {
  // At the adapter layer a 5xx raises ExplorerFault; the router catches it and
  // falls through to the next adapter, ending at null. Either way the one
  // outcome that must be impossible is a resolved `{ items: [] }`, which would
  // read as a wallet that never received anything.
  const restore = mockJson({ error: "boom" }, 500);
  try {
    await assert.rejects(() => windowAsc(), (err: Error) => err.name === "ExplorerFault");
  } finally {
    restore();
  }
});

test("transactionIndex is carried into `position` — same-block ordering depends on it", async () => {
  // Without it compareTxOrder falls back to MAX_SAFE_INTEGER and two transfers
  // in the same block silently reorder, which can pick the wrong funder.
  const restore = mockJson({
    status: "1",
    message: "OK",
    result: [
      {
        hash: "0xabc",
        from: "0xaaaa",
        to: ADDR,
        value: "1",
        blockNumber: "500",
        transactionIndex: "7",
        timeStamp: "1700000000",
      },
    ],
  });
  try {
    const out = await windowAsc();
    assert.equal(out?.items[0].position, 7);
    assert.equal(out?.items[0].block, 500);
  } finally {
    restore();
  }
});
