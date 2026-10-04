import test from "node:test";
import assert from "node:assert/strict";
import {
  ProviderGate,
  resetProviderGateForTests,
  type CircuitConfig,
} from "../lib/rpc/admission";
import type { ProviderEndpoint } from "../lib/rpc/provider-pool";

const CFG: CircuitConfig = {
  circuitFailureThreshold: 3,
  circuitOpenSeconds: 60,
  recoveryProbeSeconds: 30,
};

function endpoint(over: Partial<ProviderEndpoint> = {}): ProviderEndpoint {
  return { id: "p1", url: "https://example.invalid", ...over };
}

function freshGate(): ProviderGate {
  // Clears the process-wide scheduler and CU buckets the gate reads through,
  // so budget/inflight state never leaks between tests.
  resetProviderGateForTests();
  return new ProviderGate();
}

test("a grant reserves the concurrency slot immediately, not at first use", () => {
  const gate = freshGate();
  const e = endpoint({ maxConcurrentRequests: 2 });

  assert.equal(gate.inflightCount("p1"), 0);
  const a = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(a.admitted, true);
  assert.equal(
    gate.inflightCount("p1"),
    1,
    "admission must take the slot atomically — a check-then-mark gap lies about the ceiling",
  );
});

test("denial at the concurrency ceiling is transient and names the reason", () => {
  const gate = freshGate();
  const e = endpoint({ maxConcurrentRequests: 1 });

  const first = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(first.admitted, true);

  const second = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(second.admitted, false);
  assert.equal(second.admitted === false && second.reason, "at-concurrency");
  assert.equal(
    second.admitted === false && second.transient,
    true,
    "a busy provider is healthy — waiting can change the answer",
  );
});

test("an open circuit denies as NON-transient — a breaker is not a queueing delay", () => {
  const gate = freshGate();
  const e = endpoint();

  for (let i = 0; i < CFG.circuitFailureThreshold; i++) {
    gate.onFailure(e, CFG, 1000);
  }
  assert.equal(gate.phase("p1"), "OPEN");

  const denied = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(denied.admitted, false);
  assert.equal(denied.admitted === false && denied.reason, "circuit-open");
  assert.equal(
    denied.admitted === false && denied.transient,
    false,
    "waiting out a 60s breaker inside a request just burns the scan deadline",
  );
});

test("exhausted CU/RPS budget denies as transient, without opening the circuit", () => {
  const gate = freshGate();
  const e = endpoint({ maxRequestsPerSecond: 1 });

  const first = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(first.admitted, true);
  if (first.admitted) first.release();

  const second = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(second.admitted, false);
  assert.equal(second.admitted === false && second.reason, "over-budget");
  assert.equal(second.admitted === false && second.transient, true);
  assert.equal(
    gate.phase("p1"),
    "CLOSED",
    "budget exhaustion must never open a breaker on a healthy provider (§11.2)",
  );
});

test("a provider denied earlier in the chain does NOT have its budget spent", () => {
  // The ordering invariant tryAdmit exists to enforce: CU/RPS is the only check
  // with a side effect, so it must run last. If a concurrency denial still
  // deducted a token, the bucket would drain against requests that were never
  // sent — throttling a healthy provider for traffic it never received.
  const gate = freshGate();
  const e = endpoint({ maxConcurrentRequests: 1, maxRequestsPerSecond: 2 });

  const first = gate.tryAdmit(e, "eth_call", CFG, 1000); // grants, spends 1 of 2
  assert.equal(first.admitted, true);

  const blocked = gate.tryAdmit(e, "eth_call", CFG, 1000); // denied: at ceiling
  assert.equal(blocked.admitted === false && blocked.reason, "at-concurrency");

  if (first.admitted) first.release();

  const third = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(
    third.admitted,
    true,
    "the second token must still be there — the blocked call must not have spent it",
  );
});

test("release is idempotent — a double release must not under-count inflight", () => {
  const gate = freshGate();
  const e = endpoint({ maxConcurrentRequests: 1 });

  const a = gate.tryAdmit(e, "eth_call", CFG, 1000);
  const b = gate.tryAdmit(e, "eth_call", CFG, 1000);
  assert.equal(a.admitted, true);
  assert.equal(b.admitted, false);

  if (a.admitted) {
    a.release();
    a.release(); // a stray second release, e.g. from a retry wrapper
  }
  assert.equal(
    gate.inflightCount("p1"),
    0,
    "inflight must not go negative — that would let the provider exceed its ceiling",
  );
});

test("a success closes a circuit that had accumulated failures", () => {
  const gate = freshGate();
  const e = endpoint();

  gate.onFailure(e, CFG, 1000);
  gate.onFailure(e, CFG, 1000);
  assert.equal(gate.phase("p1"), "CLOSED", "below threshold, still serving");

  gate.onSuccess(e);
  gate.onFailure(e, CFG, 1000);
  assert.equal(
    gate.phase("p1"),
    "CLOSED",
    "the success must have reset the counter, not just the phase",
  );
});

test("rank puts a method's preferred provider first regardless of pool order", () => {
  const gate = freshGate();
  const providers = [
    { endpoint: endpoint({ id: "paid" }) },
    { endpoint: endpoint({ id: "public", preferMethods: ["eth_getLogs"] }) },
  ];

  assert.deepEqual(
    gate.rank(providers, "eth_getLogs").map((p) => p.endpoint.id),
    ["public", "paid"],
  );
  assert.deepEqual(
    gate.rank(providers, "eth_call").map((p) => p.endpoint.id),
    ["paid", "public"],
    "preference is per-method — it must not reorder unrelated methods",
  );
});
