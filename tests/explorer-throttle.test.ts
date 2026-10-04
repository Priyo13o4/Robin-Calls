import test from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfterMs, planExplorerRetry } from "../lib/explorer/retry";
import { withExplorerSlot, resetExplorerGateForTests } from "../lib/explorer/gate";

// A4's concurrency gate reads EXPLORER_MAX_CONCURRENCY per-acquire, so setting
// it here (it runs before any test uses the gate) takes effect. retry.ts
// freezes its knobs at import, so these cases assert the shipped defaults
// (4 rate-limit attempts, 800ms base, 6s cap, 2 transient).
process.env.EXPLORER_MAX_CONCURRENCY = "2";

// ── A3: Retry-After parsing ─────────────────────────────────────────────

test("parseRetryAfterMs reads a seconds delta", () => {
  assert.equal(parseRetryAfterMs("3", 0), 3000);
  assert.equal(parseRetryAfterMs("0", 0), 0);
});

test("parseRetryAfterMs reads an HTTP date relative to nowMs", () => {
  const future = Date.parse("2099-01-01T00:00:00Z");
  assert.equal(parseRetryAfterMs("2099-01-01T00:00:00Z", 0), future);
  // A past date never yields a negative wait.
  assert.equal(parseRetryAfterMs("2000-01-01T00:00:00Z", Date.parse("2050-01-01T00:00:00Z")), 0);
});

test("parseRetryAfterMs returns null for absent/garbage headers", () => {
  assert.equal(parseRetryAfterMs(null, 0), null);
  assert.equal(parseRetryAfterMs("", 0), null);
  assert.equal(parseRetryAfterMs("   ", 0), null);
  assert.equal(parseRetryAfterMs("later", 0), null);
});

// ── A3: retry policy ────────────────────────────────────────────────────

test("429 retries with seconds-scale exponential backoff, then gives up", () => {
  assert.deepEqual(planExplorerRetry({ status: 429, attempt: 1, nowMs: 0 }), { retry: true, delayMs: 800 });
  assert.deepEqual(planExplorerRetry({ status: 429, attempt: 2, nowMs: 0 }), { retry: true, delayMs: 1600 });
  assert.deepEqual(planExplorerRetry({ status: 429, attempt: 3, nowMs: 0 }), { retry: true, delayMs: 3200 });
  // 4th failure exhausts the rate-limit budget: no retry -> the caller records
  // RATE_LIMITED and the explorerFaulted() latch voids the scan (unchanged).
  assert.deepEqual(planExplorerRetry({ status: 429, attempt: 4, nowMs: 0 }), { retry: false, delayMs: 0 });
});

test("429 honors Retry-After when it exceeds our backoff, capped at the ceiling", () => {
  // Server asks 3s, our backoff would be 800ms -> obey the server.
  assert.deepEqual(planExplorerRetry({ status: 429, attempt: 1, retryAfter: "3", nowMs: 0 }), {
    retry: true,
    delayMs: 3000,
  });
  // Server asks 10s, but a throttle that long is a persistent outage -> cap 6s.
  assert.deepEqual(planExplorerRetry({ status: 429, attempt: 1, retryAfter: "10", nowMs: 0 }), {
    retry: true,
    delayMs: 6000,
  });
});

test("5xx and network faults: 3 attempts, 2000ms gap (L59 — sized to a measured 3.6-12s congestion window, not a blip)", () => {
  assert.deepEqual(planExplorerRetry({ status: 500, attempt: 1, nowMs: 0 }), { retry: true, delayMs: 2_000 });
  assert.deepEqual(planExplorerRetry({ status: 503, attempt: 2, nowMs: 0 }), { retry: true, delayMs: 2_000 });
  assert.deepEqual(planExplorerRetry({ status: 503, attempt: 3, nowMs: 0 }), { retry: false, delayMs: 0 });
  // undefined status = threw before a response (timeout / socket).
  assert.deepEqual(planExplorerRetry({ status: undefined, attempt: 1, nowMs: 0 }), { retry: true, delayMs: 2_000 });
  assert.deepEqual(planExplorerRetry({ status: undefined, attempt: 2, nowMs: 0 }), { retry: true, delayMs: 2_000 });
  assert.deepEqual(planExplorerRetry({ status: undefined, attempt: 3, nowMs: 0 }), { retry: false, delayMs: 0 });
});

test("a non-429 4xx is a definitive answer, never retried", () => {
  assert.deepEqual(planExplorerRetry({ status: 404, attempt: 1, nowMs: 0 }), { retry: false, delayMs: 0 });
  assert.deepEqual(planExplorerRetry({ status: 400, attempt: 1, nowMs: 0 }), { retry: false, delayMs: 0 });
});

// ── A4: the explorer concurrency gate ───────────────────────────────────

test("withExplorerSlot never runs more than EXPLORER_MAX_CONCURRENCY at once", async () => {
  resetExplorerGateForTests();
  let active = 0;
  let peak = 0;
  const task = () =>
    withExplorerSlot(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return true;
    });

  const results = await Promise.all(Array.from({ length: 8 }, task));
  assert.equal(results.length, 8);
  assert.ok(results.every(Boolean));
  assert.equal(peak, 2, `gate allowed ${peak} concurrent, expected 2`);
});

test("withExplorerSlot releases its slot even when the body throws", async () => {
  resetExplorerGateForTests();
  await assert.rejects(withExplorerSlot(async () => {
    throw new Error("boom");
  }));
  // If the slot leaked, a full cap's worth of subsequent calls would deadlock.
  const after = await Promise.all([
    withExplorerSlot(async () => 1),
    withExplorerSlot(async () => 2),
    withExplorerSlot(async () => 3),
  ]);
  assert.deepEqual(after, [1, 2, 3]);
});
