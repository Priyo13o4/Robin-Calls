import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

/**
 * Every explorer-originated `reportError` call had `providerId: null` and
 * `details: null` — the admin Logs panel already renders both (per-provider
 * grouping, a pretty-printed JSON block), but nothing was ever written into
 * them for an explorer fault. An operator staring at "explorer blockscout
 * /addresses/:id returned 500 (after 2 attempts)" could not tell which HOST
 * answered (PRO gateway vs community instance), how long it actually took, or
 * whether time was spent queued behind this process's own concurrency gate vs.
 * on the wire — exactly the numbers needed to size L59's retry policy, which is
 * why this file exists alongside that fix.
 *
 * Uses node:test's experimental module mocking (same pattern as
 * tests/curve-unified-walker.test.ts) to intercept reportError — no DB, no
 * network. `baseUrl`, never the api-keyed `requestUrl`, is asserted present:
 * logging the latter would leak the PRO credential into `app_error_events`
 * (§6 — never log secrets), even though `redactString` would defang it too.
 */

// Set BEFORE the first (dynamic) import of lib/explorer/http → lib/explorer/retry
// below, whose backoff constants are read once at module load. No static import
// of that chain exists in this file, so this assignment runs first — keeps two
// terminal-retry sequences in this file from costing 2×(TRANSIENT_ATTEMPTS-1)×
// TRANSIENT_BACKOFF_MS of real wall-clock time apiece.
process.env.EXPLORER_TRANSIENT_BACKOFF_MS = "5";

const reported: {
  code: string;
  providerId?: string;
  httpStatus?: number;
  message: string;
  details?: unknown;
}[] = [];

mock.module("../lib/observability/reporter", {
  namedExports: {
    reportError: async (input: {
      code: string;
      providerId?: string;
      httpStatus?: number;
      message: string;
      details?: unknown;
    }) => {
      reported.push(input);
    },
  },
});

type Mod = typeof import("../lib/explorer/http");
async function load(): Promise<Mod> {
  return import("../lib/explorer/http");
}

const BASE = "https://api.blockscout.com/4663/api/v2";

function stubFetch(handler: () => Promise<Response> | Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => handler()) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("a terminal 5xx reports providerId + a structured, secret-free details object", async () => {
  const { explorerFetch, ExplorerFault } = await load();
  reported.length = 0;
  const restore = stubFetch(() => new Response("boom", { status: 500 }));
  try {
    await assert.rejects(
      () => explorerFetch("blockscout", BASE, "/addresses/0xccc"),
      (e: unknown) => e instanceof ExplorerFault,
    );
  } finally {
    restore();
  }

  assert.equal(reported.length, 1);
  const row = reported[0];
  assert.equal(row.providerId, "blockscout", "must be structured, not just embedded in the message text");
  assert.equal(row.httpStatus, 500);
  assert.match(row.message, /after \d+ attempts? \(\d+ms elapsed, \d+ms queued\)/);

  const details = row.details as Record<string, unknown>;
  assert.equal(typeof details.elapsedMs, "number");
  assert.equal(typeof details.queuedMs, "number");
  assert.equal(details.attempt, 3, "the terminal attempt count, matching TRANSIENT_ATTEMPTS");
  assert.equal(typeof details.baseUrl, "string");
  assert.ok(!JSON.stringify(details).includes("apikey"), "requestUrl's apikey param must never reach details");
});

test("a network/timeout fault reports errorName and elapsedMs, distinguishing a hard timeout from any other transport error", async () => {
  const { explorerFetch, ExplorerFault } = await load();
  reported.length = 0;
  const restore = stubFetch(() => {
    throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  });
  try {
    await assert.rejects(
      () => explorerFetch("blockscout", BASE, "/addresses/0xddd"),
      (e: unknown) => e instanceof ExplorerFault,
    );
  } finally {
    restore();
  }

  assert.equal(reported.length, 1);
  const row = reported[0];
  assert.equal(row.providerId, "blockscout");
  const details = row.details as Record<string, unknown>;
  assert.equal(details.timeout, true);
  assert.equal(details.errorName, "TimeoutError");
  assert.equal(typeof details.elapsedMs, "number");
});
