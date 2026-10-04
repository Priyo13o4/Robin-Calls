import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCAN_DELIVERY_WINDOW_MS,
  SCAN_DEADLINE_MARGIN_MS,
  createScanContext,
} from "../lib/observability/context";

// KNOWN-PROBLEMS L110. The terminal deadline was 180_000 and the route's
// `maxDuration` was 180 — the same number — while the comment above the guard
// said it sat "well inside" it and answered "by ~50s". Nothing enforced the
// distance the comment described, so the two constants drifted together and the
// guard started writing its error into a socket the edge had already closed.
//
// Measured on prod 2026-09-05, twice on 0x8490acd2…: the client's stream ended
// at ~162s, and `scan_runs` recorded RC_SCAN_DEADLINE_EXCEEDED at 180000ms.
// The server knew, the caller got HTTP 200 and no terminal line.
//
// These assert the RELATIONSHIP between the budgets, not any one value, because
// the defect was never a wrong number — it was an unenforced margin.

const routeSrc = readFileSync(
  new URL("../app/api/scan/route.ts", import.meta.url),
  "utf8",
);

function routeMaxDurationMs(): number {
  const m = routeSrc.match(/export const maxDuration = (\d+)/);
  assert.ok(m, "route must declare maxDuration");
  return Number(m![1]) * 1000;
}

function defaultDeadlineMs(): number {
  // Read through the real context so an env override in a dev shell cannot make
  // this pass while production ships the default (§8 #20).
  const saved = process.env.SCAN_TERMINAL_DEADLINE_MS;
  delete process.env.SCAN_TERMINAL_DEADLINE_MS;
  try {
    const ctx = createScanContext();
    return ctx.deadline.deadlineAtMs - Date.now();
  } finally {
    if (saved !== undefined) process.env.SCAN_TERMINAL_DEADLINE_MS = saved;
  }
}

test("the deadline is not merely equal to the route budget", () => {
  const deadline = defaultDeadlineMs();
  assert.notEqual(
    deadline,
    routeMaxDurationMs(),
    "a guard set to the same instant as the thing it pre-empts cannot pre-empt it",
  );
});

test("the deadline fires before the client's connection can be cut", () => {
  const deadline = defaultDeadlineMs();
  assert.ok(
    deadline <= SCAN_DELIVERY_WINDOW_MS - SCAN_DEADLINE_MARGIN_MS + 1000,
    `deadline ${deadline}ms must leave ${SCAN_DEADLINE_MARGIN_MS}ms inside the ` +
      `${SCAN_DELIVERY_WINDOW_MS}ms delivery window — a terminal event nobody ` +
      `can receive is not a terminal event`,
  );
});

test("the deadline also stays inside the route's own budget", () => {
  assert.ok(defaultDeadlineMs() < routeMaxDurationMs());
});

test("the delivery window is the shorter budget, and is what binds", () => {
  // If the edge ever gets a longer timeout than the route, the route becomes the
  // binding constraint and this test should be the thing that notices.
  assert.ok(
    SCAN_DELIVERY_WINDOW_MS < routeMaxDurationMs(),
    "delivery window is no longer the tighter bound — re-derive the deadline",
  );
});

test("the margin is real, not decorative", () => {
  assert.ok(SCAN_DEADLINE_MARGIN_MS >= 10_000);
});
