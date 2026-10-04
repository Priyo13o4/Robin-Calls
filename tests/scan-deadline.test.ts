import test from "node:test";
import assert from "node:assert/strict";
import { createScanContext,
  SCAN_DELIVERY_WINDOW_MS,
  SCAN_DEADLINE_MARGIN_MS,
} from "../lib/observability/context";

test("a fresh scan context's deadline is not expired and has near-full remaining time", () => {
  const ctx = createScanContext();
  assert.equal(ctx.deadline.expired(), false);
  assert.ok(ctx.deadline.remainingMs() > 0);
  assert.ok(ctx.deadline.deadlineAtMs >= ctx.startedAt);
});

test("SCAN_TERMINAL_DEADLINE_MS overrides the default cutoff", () => {
  const prev = process.env.SCAN_TERMINAL_DEADLINE_MS;
  process.env.SCAN_TERMINAL_DEADLINE_MS = "10";
  try {
    const ctx = createScanContext();
    const start = Date.now();
    while (Date.now() - start < 20) {
      /* spin past the 10ms cutoff */
    }
    assert.equal(ctx.deadline.expired(), true);
    assert.ok(ctx.deadline.remainingMs() <= 0);
  } finally {
    if (prev === undefined) delete process.env.SCAN_TERMINAL_DEADLINE_MS;
    else process.env.SCAN_TERMINAL_DEADLINE_MS = prev;
  }
});

test("the deadline is anchored to startedAt, not to when .deadline is first read", () => {
  const prev = process.env.SCAN_TERMINAL_DEADLINE_MS;
  process.env.SCAN_TERMINAL_DEADLINE_MS = "100000";
  try {
    const ctx = createScanContext();
    assert.equal(ctx.deadline.deadlineAtMs, ctx.startedAt + 100_000);
  } finally {
    if (prev === undefined) delete process.env.SCAN_TERMINAL_DEADLINE_MS;
    else process.env.SCAN_TERMINAL_DEADLINE_MS = prev;
  }
});

test("an invalid or zero SCAN_TERMINAL_DEADLINE_MS falls back to the default", () => {
  const prev = process.env.SCAN_TERMINAL_DEADLINE_MS;
  process.env.SCAN_TERMINAL_DEADLINE_MS = "not-a-number";
  try {
    const ctx = createScanContext();
    // L110: derived, never a literal. This line pinned 180_000 — the value that
    // WAS the bug — so it stayed green while the guard fired 18s after the edge
    // had closed the socket. Assert the rule, not the number.
    assert.equal(
      ctx.deadline.deadlineAtMs,
      ctx.startedAt + (SCAN_DELIVERY_WINDOW_MS - SCAN_DEADLINE_MARGIN_MS),
    );
  } finally {
    if (prev === undefined) delete process.env.SCAN_TERMINAL_DEADLINE_MS;
    else process.env.SCAN_TERMINAL_DEADLINE_MS = prev;
  }
});
