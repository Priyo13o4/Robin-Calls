import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScanContext, recordRpcAttempt } from "../lib/observability/context";
import { buildScanRunRow } from "../lib/observability/scan-run";
import { scanRuns } from "../lib/db/schema";

/**
 * docs/KNOWN-PROBLEMS.md L40 — nothing persisted WHICH provider served a call.
 * `recordRpcAttempt` received a providerId and used it only to bump
 * `rpcProviderSwitches`, so "is goldsky getting used?" was unanswerable.
 *
 * These pin the CONTRACT, not the arithmetic: that the id survives to a real
 * column, that a failing provider does not read as an idle one, and that the
 * null/empty distinction stays intact.
 */

const attempt = (providerId: string, over: Partial<Parameters<typeof recordRpcAttempt>[0]> = {}) => ({
  method: "eth_call",
  providerId,
  latencyMs: 100,
  outcome: "ok" as const,
  ...over,
});

test("a fresh context starts with no provider attributed", () => {
  assert.deepEqual(createScanContext().rpc.providerCalls, {});
});

test("attempts are attributed to the provider that took them", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("goldsky-edge", { latencyMs: 50 }), ctx);
  recordRpcAttempt(attempt("goldsky-edge", { latencyMs: 70 }), ctx);
  recordRpcAttempt(attempt("robinhood-public", { latencyMs: 10 }), ctx);

  assert.deepEqual(ctx.rpc.providerCalls, {
    "goldsky-edge": { n: 2, err: 0, ms: 120 },
    "robinhood-public": { n: 1, err: 0, ms: 10 },
  });
});

// The whole point of the column. A provider that fails every call has still
// been USED — counting only successes would render it identical to one the
// pool never routed to, which is the misreading L40 is about.
test("a transport error counts as a call AND as an error, never as idleness", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("alchemy-secondary", { outcome: "transport-error" }), ctx);
  recordRpcAttempt(attempt("alchemy-secondary", { outcome: "transport-error" }), ctx);

  const p = ctx.rpc.providerCalls["alchemy-secondary"];
  assert.equal(p.n, 2, "a failing provider must not look unused");
  assert.equal(p.err, 2);
});

test("an expected revert is the provider answering, not failing", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("goldsky-edge", { outcome: "expected-revert" }), ctx);

  assert.deepEqual(ctx.rpc.providerCalls["goldsky-edge"], { n: 1, err: 0, ms: 100 });
});

test("negative latency cannot drag a provider's total below zero", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("goldsky-edge", { latencyMs: -5 }), ctx);
  assert.equal(ctx.rpc.providerCalls["goldsky-edge"].ms, 0);
});

test("recordRpcAttempt outside a scan context is a no-op, not a throw", () => {
  assert.doesNotThrow(() => recordRpcAttempt(attempt("goldsky-edge")));
});

// ── persistence contract ──────────────────────────────────────

test("providerCalls reaches the row in camelCase and is a real column", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("goldsky-edge"), ctx);
  const row = buildScanRunRow(ctx, { outcome: "complete" });

  // Drizzle silently DISCARDS keys that do not match a column (CLAUDE.md §3),
  // so naming and column existence are the contract — not the value.
  assert.ok("providerCalls" in row);
  assert.ok(
    Object.keys(scanRuns).includes("providerCalls"),
    "scan_runs has no providerCalls column — the write would be dropped in silence"
  );
  assert.deepEqual(row.providerCalls, { "goldsky-edge": { n: 1, err: 0, ms: 100 } });
});

// §4: an empty result is not a fact. NULL means we never looked; a map that
// simply lacks a provider means that provider served nothing. Collapsing the
// two rebuilds the ambiguity provider_states already has.
test("no RPC attempted persists NULL, not an empty map", () => {
  const row = buildScanRunRow(createScanContext(), { outcome: "complete" });
  assert.equal(row.providerCalls, null);
});

test("an attempt that happened persists a map, so absence means served-nothing", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("robinhood-public"), ctx);
  const row = buildScanRunRow(ctx, { outcome: "complete" });

  assert.notEqual(row.providerCalls, null);
  assert.ok(!("goldsky-edge" in (row.providerCalls as object)));
});

test("migration 0067 actually adds the column the schema declares", () => {
  const sql = readFileSync("supabase/migrations/0067_scan_run_provider_calls.sql", "utf8");
  assert.match(sql, /alter table scan_runs add column if not exists provider_calls jsonb/i);
});

// provider_calls records who SERVED; provider_states records who DENIED. They
// are complements, and the switch counter must keep measuring its own thing.
test("attribution does not disturb the existing switch counter", () => {
  const ctx = createScanContext();
  recordRpcAttempt(attempt("goldsky-edge"), ctx);
  recordRpcAttempt(attempt("robinhood-public"), ctx);
  recordRpcAttempt(attempt("robinhood-public"), ctx);

  assert.equal(ctx.rpc.providerSwitches, 2);
  assert.equal(ctx.rpc.physicalAttempts, 3);
  assert.deepEqual(ctx.providerStates, {}, "serving a call must not write a denial");
});
