import test from "node:test";
import assert from "node:assert/strict";
import { ProviderScheduler } from "../lib/rpc/scheduler";
import type { ProviderEndpoint } from "../lib/rpc/provider-pool";

const A: ProviderEndpoint = { id: "a", url: "https://a.example" };
const B: ProviderEndpoint = { id: "b", url: "https://b.example" };
const C: ProviderEndpoint = { id: "c", url: "https://c.example" };

test("a never-tracked provider has zero inflight", () => {
  const s = new ProviderScheduler();
  assert.equal(s.inflightCount("a"), 0);
});

test("markInflight/clearInflight track per-provider counts", () => {
  const s = new ProviderScheduler();
  s.markInflight(A);
  s.markInflight(A);
  assert.equal(s.inflightCount("a"), 2);
  s.clearInflight(A);
  assert.equal(s.inflightCount("a"), 1);
  s.clearInflight(A);
  assert.equal(s.inflightCount("a"), 0);
});

test("clearInflight never goes negative on an unbalanced call", () => {
  const s = new ProviderScheduler();
  s.clearInflight(A);
  assert.equal(s.inflightCount("a"), 0);
});

test("rankLeastInflight orders the busiest provider last", () => {
  const s = new ProviderScheduler();
  s.markInflight(A);
  s.markInflight(A);
  s.markInflight(B);
  const ranked = s.rankLeastInflight([{ endpoint: A }, { endpoint: B }, { endpoint: C }]);
  assert.deepEqual(
    ranked.map((r) => r.endpoint.id),
    ["c", "b", "a"],
  );
});
