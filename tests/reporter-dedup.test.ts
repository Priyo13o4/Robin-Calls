// A provider circuit opening once fired the same RC_RPC_NO_HEALTHY_PROVIDER
// on every in-flight request — 426 rows in 25 minutes in production. These
// tests exercise reportError's in-memory dedup seam directly, so the window
// needs to be short and real (the module reads its window length from env
// once at import time — see reporter.ts). ESM hoists static `import`s ahead
// of any top-level code, and this project's tsx/CJS output doesn't allow
// top-level await either, so the module is loaded dynamically in `before`,
// after the env var is set.
import test from "node:test";
import assert from "node:assert/strict";
import type { ReportErrorDeps, reportError as ReportErrorFn } from "../lib/observability/reporter";

let reportError: typeof ReportErrorFn;
let resetErrorDedupForTests: () => void;

test.before(async () => {
  process.env.APP_ERROR_DEDUP_WINDOW_SECONDS = "1";
  const mod = await import("../lib/observability/reporter");
  reportError = mod.reportError;
  resetErrorDedupForTests = mod.resetErrorDedupForTests;
});

/**
 * Minimal fake matching the `.from(table).insert(row)` surface reportError
 * actually calls — same convention as tests/artifact-cache.test.ts's fakeDb
 * for lib/audit/artifact-cache.ts (no live Supabase in this repo).
 */
function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const deps: ReportErrorDeps = {
    _mockWrite: async (row: any) => {
      inserted.push(row);
    }
  };
  return { deps, inserted };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.beforeEach(() => {
  resetErrorDedupForTests();
});

test("second occurrence of the same fingerprint within the window is suppressed", async () => {
  const { deps, inserted } = fakeDb();
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "no healthy provider", route: "/api/scan", operation: "rpc.call" },
    deps
  );
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "no healthy provider (again)", route: "/api/scan", operation: "rpc.call" },
    deps
  );
  assert.equal(inserted.length, 1);
});

test("a different code, route, or operation is never suppressed even in the same window", async () => {
  const { deps, inserted } = fakeDb();
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "m", route: "/api/scan", operation: "rpc.call" },
    deps
  );
  await reportError(
    { code: "RC_RPC_TIMEOUT", message: "m", route: "/api/scan", operation: "rpc.call" }, // different code
    deps
  );
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "m", route: "/api/other", operation: "rpc.call" }, // different route
    deps
  );
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "m", route: "/api/scan", operation: "rpc.other" }, // different operation
    deps
  );
  assert.equal(inserted.length, 4);
});

test("two different providers failing independently both insert", async () => {
  const { deps, inserted } = fakeDb();
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "m", route: "/api/scan", operation: "rpc.call", providerId: "alchemy" },
    deps
  );
  await reportError(
    { code: "RC_RPC_NO_HEALTHY_PROVIDER", message: "m", route: "/api/scan", operation: "rpc.call", providerId: "infura" },
    deps
  );
  assert.equal(inserted.length, 2);
});

test("after the window elapses, the next occurrence inserts again with the suppressed count", async () => {
  const { deps, inserted } = fakeDb();
  const input = {
    code: "RC_RPC_NO_HEALTHY_PROVIDER" as const,
    message: "no healthy provider",
    route: "/api/scan",
    operation: "rpc.call",
  };
  await reportError(input, deps); // window 1, occurrence 1 — inserts
  await reportError(input, deps); // window 1, occurrence 2 — suppressed
  await reportError(input, deps); // window 1, occurrence 3 — suppressed

  await sleep(1100); // let the 1s window roll over

  await reportError(input, deps); // window 2, occurrence 1 — inserts, carries prior count

  assert.equal(inserted.length, 2);
  const rollover = inserted[1] as { details: { suppressedOccurrences: number; windowSeconds: number } };
  assert.equal(rollover.details.suppressedOccurrences, 2);
  assert.equal(rollover.details.windowSeconds, 1);
});

test("resetErrorDedupForTests clears state so a fresh test doesn't inherit a suppressed window", async () => {
  const { deps, inserted } = fakeDb();
  const input = {
    code: "RC_RPC_NO_HEALTHY_PROVIDER" as const,
    message: "m",
    route: "/api/scan",
    operation: "rpc.call",
  };
  await reportError(input, deps);
  await reportError(input, deps); // suppressed — proves the window is live

  resetErrorDedupForTests();

  await reportError(input, deps); // must insert again: no memory of the prior window
  assert.equal(inserted.length, 2);
});

test("an unregistered error code is still reported, never thrown (the reporter's own contract)", async () => {
  await assert.doesNotReject(reportError({ code: "RC_NOT_A_REAL_CODE" as never, message: "x", operation: "test" }, { _mockWrite: async () => {} }));
  await assert.doesNotReject(reportError({ code: "RC_JOB_FAILED", message: "x", operation: "test" }, { _mockWrite: async () => {} }), "control: a registered code");
});
