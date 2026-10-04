import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptiveLogWalk,
  isTooManyLogsError,
  isRateLimitError,
} from "../lib/rpc/adaptive-walk";

test("halving + retry same from with no onWindow call in between (control: the retry onWindow fires)", async () => {
  const calls: { from: number; to: number }[] = [];
  const windowEvents: { rows: number[]; from: number; to: number }[] = [];
  let attempt = 0;

  const result = await adaptiveLogWalk<number>({
    from: 0,
    to: 50_000,
    fetch: async (from, to) => {
      calls.push({ from, to });
      attempt++;
      if (attempt === 1) {
        throw new Error("logs matched by query exceeds limit of 10000");
      }
      return [1, 2];
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 50_000,
    initialWindow: 20_000,
    onWindow: async (rows, from, to) => {
      windowEvents.push({ rows, from, to });
    },
  });

  assert.equal(calls.length >= 2, true);
  // First call failed at initialWindow 20,000.
  assert.deepEqual(calls[0], { from: 0, to: 19_999 });
  // Retried same from=0 with halved window 10,000.
  assert.deepEqual(calls[1], { from: 0, to: 9_999 });
  // onWindow was not called for the failed window; it fired on the retried window.
  assert.equal(windowEvents.length >= 1, true);
  assert.deepEqual(windowEvents[0], { rows: [1, 2], from: 0, to: 9_999 });

  // Positive control: when first attempt succeeds, no halving happens.
  const controlCalls: { from: number; to: number }[] = [];
  await adaptiveLogWalk<number>({
    from: 0,
    to: 19_999,
    fetch: async (from, to) => {
      controlCalls.push({ from, to });
      return [10];
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 50_000,
    initialWindow: 20_000,
  });
  assert.equal(controlCalls.length, 1);
  assert.deepEqual(controlCalls[0], { from: 0, to: 19_999 });
});

test("floor: too-many logs at minWindow stops with window-floor", async () => {
  const result = await adaptiveLogWalk<number>({
    from: 0,
    to: 10_000,
    fetch: async () => {
      throw new Error("ResponseBodyTooLarge");
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 10_000,
    initialWindow: 1_000,
  });

  assert.equal(result.stopped, "window-floor");
  assert.equal(result.rows.length, 0);

  // Positive control: when fetch succeeds, stopped is null.
  const control = await adaptiveLogWalk<number>({
    from: 0,
    to: 999,
    fetch: async () => [42],
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 10_000,
    initialWindow: 1_000,
  });
  assert.equal(control.stopped, null);
  assert.deepEqual(control.rows, [42]);
});

test("rate limit: 429 stops with rate-limited", async () => {
  const result = await adaptiveLogWalk<number>({
    from: 0,
    to: 10_000,
    fetch: async () => {
      const err = new Error("Too Many Requests");
      (err as any).status = 429;
      throw err;
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 10_000,
    initialWindow: 2_000,
  });

  assert.equal(result.stopped, "rate-limited");
  assert.equal(result.rows.length, 0);

  // Positive control: success before 429 preserves accumulated rows.
  let callCount = 0;
  const control = await adaptiveLogWalk<number>({
    from: 0,
    to: 10_000,
    fetch: async () => {
      callCount++;
      if (callCount === 1) return [1, 2];
      const err = new Error("rate limit hit");
      (err as any).statusCode = 429;
      throw err;
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 10_000,
    initialWindow: 2_000,
  });
  assert.equal(control.stopped, "rate-limited");
  assert.deepEqual(control.rows, [1, 2]);
});

test("unknown error rethrows", async () => {
  await assert.rejects(
    async () => {
      await adaptiveLogWalk<number>({
        from: 0,
        to: 10_000,
        fetch: async () => {
          throw new Error("unexpected connection drop");
        },
        targetLogs: 5_000,
        minWindow: 1_000,
        maxWindow: 10_000,
        initialWindow: 2_000,
      });
    },
    /unexpected connection drop/,
  );

  // Positive control: normal fetch does not reject.
  const control = await adaptiveLogWalk<number>({
    from: 0,
    to: 1_000,
    fetch: async () => [],
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 10_000,
    initialWindow: 2_000,
  });
  assert.equal(control.stopped, null);
});

test("4x growth cap: sparse window grows by at most 4x", async () => {
  const spans: number[] = [];
  await adaptiveLogWalk<number>({
    from: 0,
    to: 200_000,
    fetch: async (from, to) => {
      spans.push(to - from + 1);
      // 50 logs on 10,000 window: target 5,000 logs -> 100x desired growth.
      return Array.from({ length: 50 }, (_, i) => i);
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 100_000,
    initialWindow: 10_000,
  });

  assert.equal(spans[0], 10_000);
  // Capped at 10,000 * 4 = 40,000.
  assert.equal(spans[1], 40_000);

  // Positive control: moderate density grows under 4x cap without hitting it.
  const moderateSpans: number[] = [];
  await adaptiveLogWalk<number>({
    from: 0,
    to: 100_000,
    fetch: async (from, to) => {
      moderateSpans.push(to - from + 1);
      // 2,500 logs on 10,000 window: target 5,000 logs -> 2x growth.
      return Array.from({ length: 2_500 }, (_, i) => i);
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 100_000,
    initialWindow: 10_000,
  });
  assert.equal(moderateSpans[0], 10_000);
  assert.equal(moderateSpans[1], 20_000);
});

test("never beyond to: window clamped to requested upper bound", async () => {
  const spans: number[] = [];
  const result = await adaptiveLogWalk<number>({
    from: 0,
    to: 15_000,
    fetch: async (from, to) => {
      spans.push(to);
      return [];
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 50_000,
    initialWindow: 20_000,
  });

  assert.equal(spans.length, 1);
  assert.equal(spans[0], 15_000);
  assert.equal(result.next, 15_001);

  // Positive control: when to is larger, initialWindow determines endpoint.
  const controlSpans: number[] = [];
  await adaptiveLogWalk<number>({
    from: 0,
    to: 50_000,
    fetch: async (from, to) => {
      controlSpans.push(to);
      return [];
    },
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 50_000,
    initialWindow: 20_000,
  });
  assert.equal(controlSpans[0], 19_999);
});

test("deadline: walk stops with budget when deadline expires", async () => {
  let time = 0;
  const result = await adaptiveLogWalk<number>({
    from: 0,
    to: 100_000,
    fetch: async () => [],
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 50_000,
    initialWindow: 10_000,
    deadlineMs: 50,
    now: () => {
      const cur = time;
      time += 60;
      return cur;
    },
  });

  assert.equal(result.stopped, "budget");

  // Positive control: zero elapsed time finishes without stopping on budget.
  const control = await adaptiveLogWalk<number>({
    from: 0,
    to: 10_000,
    fetch: async () => [],
    targetLogs: 5_000,
    minWindow: 1_000,
    maxWindow: 50_000,
    initialWindow: 20_000,
    deadlineMs: 50,
    now: () => 0,
  });
  assert.equal(control.stopped, null);
});

test("rows accumulate in order across windows", async () => {
  const result = await adaptiveLogWalk<number>({
    from: 0,
    to: 29,
    fetch: async (from) => {
      if (from === 0) return [0, 1, 2];
      if (from === 10) return [3, 4];
      return [5, 6, 7];
    },
    targetLogs: 3,
    minWindow: 10,
    maxWindow: 10,
    initialWindow: 10,
  });

  assert.deepEqual(result.rows, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.calls, 3);
  assert.equal(result.next, 30);
  assert.equal(result.stopped, null);
});
