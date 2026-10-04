import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../lib/rpc/fanout";

/**
 * `mapWithConcurrency` — bounded parallel RPC map.
 *
 * The dangerous property is not the speed-up, it is the ORDER. `resolveNpmPositions`
 * turns its results into a `batchRead` whose pairs are matched by index (2i, 2i+1),
 * so results arriving in completion order rather than input order would silently
 * attribute one position's liquidity to another position's owner — a wrong
 * custody verdict with no error anywhere (CLAUDE.md §8: silent at every layer).
 */

const tick = () => new Promise((r) => setTimeout(r, 0));

test("results are in INPUT order even when they finish out of order", async () => {
  // Reverse the durations so completion order is the exact opposite of input.
  const delays = [50, 40, 30, 20, 10, 0];
  const out = await mapWithConcurrency(delays, 6, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3, 4, 5]);
});

test("never exceeds the concurrency bound", async () => {
  let active = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    active -= 1;
    return null;
  });
  assert.equal(peak, 4, `fan-out peaked at ${peak}, above the 4 the provider pool was told to expect`);
});

test("every item is visited exactly once", async () => {
  const seen: number[] = [];
  const items = Array.from({ length: 25 }, (_, i) => i);
  const out = await mapWithConcurrency(items, 7, async (n) => {
    await tick();
    seen.push(n);
    return n * 2;
  });
  assert.deepEqual([...seen].sort((a, b) => a - b), items);
  assert.deepEqual(out, items.map((n) => n * 2));
});

test("an empty list starts no workers and returns empty", async () => {
  let calls = 0;
  const out = await mapWithConcurrency([], 8, async () => {
    calls += 1;
    return 1;
  });
  assert.deepEqual(out, []);
  assert.equal(calls, 0);
});

test("concurrency above the item count does not over-spawn", async () => {
  let peak = 0;
  let active = 0;
  await mapWithConcurrency([1, 2], 16, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await tick();
    active -= 1;
    return n;
  });
  assert.equal(peak, 2);
});

test("a concurrency of 0 or less still makes progress, serially", async () => {
  // Guards the degenerate config (`LP_CUSTODY_RECEIPT_FANOUT=0`): the floor must
  // be 1, never 0 workers — which would return an array of holes, silently.
  const out = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 10);
  assert.deepEqual(out, [10, 20, 30]);
});

test("a rejection propagates rather than leaving a hole in the results", async () => {
  // The receipt call site catches per-item and returns null, so it never hits
  // this — but a future caller that forgets must fail loudly, not get `undefined`
  // typed as its result.
  await assert.rejects(
    () =>
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    /boom/,
  );
});
