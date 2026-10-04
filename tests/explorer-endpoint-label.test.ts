import test from "node:test";
import assert from "node:assert/strict";
import { endpointOf } from "../lib/explorer/http";

/**
 * `endpointOf` is what names a call in `scan_runs.explorer_endpoint_counts` and
 * in `providerStates`. Those columns exist for exactly one purpose — telling us
 * WHICH explorer endpoint a scan's time went to — so a label that collides
 * silently pools unrelated endpoints and the metric quietly stops answering the
 * question it was added for.
 *
 * The v1 Etherscan-compatible API is the trap: it carries the whole route in the
 * query string, so the pre-`?` part is the empty string. `addressTxWindowAsc`
 * shipped filed under "" (observed as `operation: 'explorer.blockscout.get '`).
 */

test("a v1 query-only path is named by module and action, not the empty string", () => {
  const label = endpointOf("?module=account&action=txlist&address=0xabc&sort=asc");
  assert.equal(label, "/api?module=account&action=txlist");
  assert.notEqual(label, "");
});

test("two different v1 actions do not collide", () => {
  assert.notEqual(
    endpointOf("?module=account&action=txlist&address=0xabc"),
    endpointOf("?module=logs&action=getLogs&address=0xabc"),
  );
});

test("a v1 path with a module but no action still gets a real name", () => {
  assert.equal(endpointOf("?module=stats"), "/api?module=stats");
});

test("a query-only path with no module falls back to /api, never empty", () => {
  assert.equal(endpointOf("?foo=bar"), "/api");
});

test("v2 REST paths are unchanged — addresses collapse to :id", () => {
  assert.equal(
    endpointOf("/addresses/0x1234567890123456789012345678901234567890/transactions"),
    "/addresses/:id/transactions",
  );
  assert.equal(endpointOf("/tokens/0x1234567890123456789012345678901234567890/holders"), "/tokens/:id/holders");
});

test("v2 paths keep collapsing numeric segments, and query strings still drop", () => {
  assert.equal(endpointOf("/blocks/12345/transactions?page=2"), "/blocks/:n/transactions");
});

test("a 64-char hash is collapsed too, so per-tx labels never explode the map", () => {
  const hash = "0x" + "a".repeat(64);
  assert.equal(endpointOf(`/transactions/${hash}`), "/transactions/:id");
});
