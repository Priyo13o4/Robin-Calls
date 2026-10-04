import test from "node:test";
import assert from "node:assert/strict";
import { ResponseBodyTooLargeError } from "viem";
import { walkLogRange } from "../lib/rpc/range-walk";
import {
  OversizedLogRangeError,
  logStrideSpan,
  type ProviderEndpoint,
} from "../lib/rpc/provider-pool";

/** The endpoint shape the live pool runs, minus urls/secrets. */
const LIVE_POOL: ProviderEndpoint[] = [
  { id: "alchemy-primary", url: "https://a.invalid", capabilities: { maxLogSpan: 10 } },
  {
    id: "robinhood-public",
    url: "https://b.invalid",
    preferMethods: ["eth_getLogs"],
    capabilities: { maxLogSpan: 10_000 },
  },
  { id: "goldsky-edge", url: "https://c.invalid", capabilities: { maxLogSpan: 19_999 } },
];

// A refusal the classifier recognizes as "narrow it and retry".
const SPLITTABLE = new Error("block range is too large");

test("a range that fits is fetched in one call", async () => {
  const calls: Array<[bigint, bigint]> = [];
  const rows = await walkLogRange(0n, 100n, async (from, to) => {
    calls.push([from, to]);
    return [{ from, to }];
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(rows, [{ from: 0n, to: 100n }]);
});

test("a splittable refusal bisects and preserves block order (left before right)", async () => {
  const rows = await walkLogRange(
    0n,
    100n,
    async (from, to) => {
      if (to - from >= 50n) throw SPLITTABLE; // anything ≥50 wide is refused
      return [{ from, to }];
    },
    10n,
  );
  // 0-100 -> [0-50, 51-100]; 0-50 -> [0-25, 26-50]; 51-100 fits.
  assert.deepEqual(rows, [
    { from: 0n, to: 25n },
    { from: 26n, to: 50n },
    { from: 51n, to: 100n },
  ]);
});

test("the capability router's OversizedLogRangeError drives the same bisection", async () => {
  let firstCall = true;
  const rows = await walkLogRange(
    0n,
    100n,
    async (from, to) => {
      if (firstCall) {
        firstCall = false;
        throw new OversizedLogRangeError(Number(to - from));
      }
      return [{ from, to }];
    },
    10n,
  );
  assert.equal(rows.length, 2); // one bisection into two halves
});

test("an oversized response body bisects instead of freezing the window", async () => {
  const calls: Array<[bigint, bigint]> = [];
  const rows = await walkLogRange(
    0n,
    2_000n,
    async (from, to) => {
      calls.push([from, to]);
      if (to - from > 200n) throw new ResponseBodyTooLargeError({ maxSize: 10_485_760, size: 12_156_454 });
      return [{ from, to }];
    },
    16n,
    2_000,
  );
  assert.ok(calls.length > 1);
  assert.equal(rows[0].from, 0n);
  assert.equal(rows[rows.length - 1].to, 2_000n);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].from, rows[i - 1].to + 1n);
});

test("a non-splittable error rethrows immediately without narrowing", async () => {
  let count = 0;
  await assert.rejects(
    walkLogRange(0n, 100n, async () => {
      count += 1;
      throw new Error("provider down");
    }),
    /provider down/,
  );
  assert.equal(count, 1, "narrowed a non-splittable fault instead of failing fast");
});

test("a splittable refusal on a range already below the floor is terminal", async () => {
  let count = 0;
  await assert.rejects(
    walkLogRange(
      0n,
      5n,
      async () => {
        count += 1;
        throw SPLITTABLE;
      },
      10n, // floor above the range width
    ),
    /too large/,
  );
  assert.equal(count, 1, "recursed below the bisect floor");
});

test("an empty range (from > to) fetches nothing", async () => {
  let count = 0;
  const rows = await walkLogRange(50n, 10n, async () => {
    count += 1;
    return [1];
  });
  assert.deepEqual(rows, []);
  assert.equal(count, 0);
});

// ── stride selection (logStrideSpan) ─────────────────────────

test("the live pool's stride keeps the public RPC eligible instead of funnelling one provider", () => {
  // The production regression: halving a multi-million-block gap landed on
  // ~10,174-block windows — 174 over robinhood-public's declared cap — so every
  // window went to goldsky alone and tripped its breaker. The stride must pick
  // 10,000 (2 providers × 10,000) over 19,999 (1 × 19,999).
  assert.equal(logStrideSpan(LIVE_POOL), 10_000);
});

test("stride never degenerates to the narrowest cap just because more providers serve it", () => {
  // 3 × 10 = 30 is the most providers but an absurd window count; the objective
  // is aggregate width, not endpoint count.
  assert.notEqual(logStrideSpan(LIVE_POOL), 10);
});

test("an uncapped capable provider means no stride — one full-range attempt is right", () => {
  assert.equal(
    logStrideSpan([
      { id: "capped", url: "https://a.invalid", capabilities: { maxLogSpan: 500 } },
      { id: "uncapped", url: "https://b.invalid" },
    ]),
    null,
  );
});

test("a provider that cannot serve eth_getLogs at all is ignored by stride selection", () => {
  assert.equal(
    logStrideSpan([
      { id: "nologs", url: "https://a.invalid", capabilities: { denyMethods: ["eth_getLogs"] } },
      { id: "logs", url: "https://b.invalid", capabilities: { maxLogSpan: 2_000 } },
    ]),
    2_000,
  );
});

// ── striding behavior in the walk ────────────────────────────

test("a wide range is chunked at the stride, not discovered by being refused", async () => {
  const calls: Array<[bigint, bigint]> = [];
  await walkLogRange(
    0n,
    999n,
    async (from, to) => {
      calls.push([from, to]);
      return [];
    },
    10n,
    100, // stride: windows of span 100
  );
  assert.equal(calls.length, 10, "1000 blocks at span-100 windows");
  // Every window must be exactly the stride wide, and they must tile the range
  // with no gap and no overlap — a skipped block is a silently missing event.
  assert.deepEqual(calls[0], [0n, 100n]);
  assert.deepEqual(calls[1], [101n, 201n]);
  for (const [from, to] of calls) {
    assert.ok(to - from <= 100n, `window ${from}-${to} exceeds the stride`);
  }
  assert.equal(calls[calls.length - 1][1], 999n, "the last window must reach toBlock");
});

test("striding covers every block exactly once", async () => {
  const seen = new Set<bigint>();
  await walkLogRange(
    7n,
    45n,
    async (from, to) => {
      for (let b = from; b <= to; b++) {
        assert.ok(!seen.has(b), `block ${b} read twice`);
        seen.add(b);
      }
      return [];
    },
    5n,
    9,
  );
  assert.equal(seen.size, 39, "blocks 7..45 inclusive");
});

test("a stride wider than the range still makes exactly one call", async () => {
  let count = 0;
  await walkLogRange(
    0n,
    50n,
    async () => {
      count += 1;
      return [];
    },
    10n,
    10_000,
  );
  assert.equal(count, 1);
});

test("bisection still applies BELOW the stride when a provider refuses anyway", async () => {
  // A declared cap is a hint, not a promise: if the endpoint refuses a window
  // the stride said was fine, the walker must still narrow it.
  const widths: bigint[] = [];
  await walkLogRange(
    0n,
    199n,
    async (from, to) => {
      widths.push(to - from);
      if (to - from > 50n) throw new Error("block range is too large");
      return [];
    },
    10n,
    100,
  );
  assert.ok(
    widths.some((w) => w <= 50n),
    "never narrowed past the stride after a real refusal",
  );
});
