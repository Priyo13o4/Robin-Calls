import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ResponseBodyTooLargeError } from "viem";
import {
  isSplittableRangeError,
  poolRequest,
  resetProviderPoolForTests,
} from "../lib/rpc/provider-pool";
import { resetProviderSchedulerForTests } from "../lib/rpc/scheduler";

// ── isSplittableRangeError: pure classification (no network) ─────────────
//
// These mirror the exact shapes `shouldFailover`'s own tests use elsewhere in
// this suite (see tests/providers.test.ts), so the two classifiers stay
// comparable side by side.

test("isSplittableRangeError recognizes common range/result-cap refusals", () => {
  assert.equal(
    isSplittableRangeError({ code: -32005, message: "query returned more than 10000 results" }),
    true
  );
  assert.equal(isSplittableRangeError({ message: "block range is too large" }), true);
  assert.equal(
    isSplittableRangeError({ message: "block range exceeds the maximum allowed" }),
    true
  );
  assert.equal(
    isSplittableRangeError({ message: "eth_getLogs is limited to a 10,000 block range" }),
    true
  );
  // Limit wording must NAME what the limit is on. A bare "limit exceeded" was
  // asserted here as a requirement, and that is what let Alchemy's
  // "Monthly capacity limit exceeded" be classified as a range refusal —
  // suppressing failover and the circuit for a provider that was simply out of
  // quota. The subject is the whole signal; see LIMIT_WORDING in
  // lib/rpc/provider-pool.ts.
  assert.equal(isSplittableRangeError({ message: "block limit exceeded" }), true);
  assert.equal(isSplittableRangeError({ message: "result limit exceeded" }), true);
  assert.equal(isSplittableRangeError({ message: "limit exceeded" }), false);
  // The 4663 public node's wording, verbatim (2026-09-28).
  assert.equal(
    isSplittableRangeError({
      code: -32602,
      message: "query spans 899964 blocks (74068336 to 74968299), but only 100000 are allowed for this request; narrow the block range, or send one value per position",
    }),
    true,
  );
});

test("isSplittableRangeError walks the cause chain like the other classifiers", () => {
  assert.equal(
    isSplittableRangeError({
      message: "RPC Request failed.",
      cause: { code: -32005, message: "query returned more than 5000 results" },
    }),
    true
  );
});

test("isSplittableRangeError does NOT match a genuine transport/timeout fault", () => {
  // The chain's own RPC nodes answer an overlong eth_getLogs walk with this
  // EXACT -32000 message (see lib/rpc/log-index.ts:13, lib/explorer/logs.ts:12)
  // — a real, degraded-node TIMEOUT, not a "too big, retry narrower" refusal.
  // Deliberately proving this classifier does not key off code -32000 alone.
  assert.equal(isSplittableRangeError({ code: -32000, message: "log query timed out" }), false);
  assert.equal(isSplittableRangeError({ name: "TimeoutError", message: "took too long" }), false);
  assert.equal(isSplittableRangeError({ status: 503 }), false);
  assert.equal(isSplittableRangeError({ name: "TypeError", message: "fetch failed" }), false);
  assert.equal(isSplittableRangeError({ code: -32603, message: "internal error" }), false);
});

test("HTTP 403 and 413 status and WAF refusal messages are recognized as splittable range errors", () => {
  assert.equal(isSplittableRangeError({ status: 403 }), true);
  assert.equal(isSplittableRangeError({ status: 413 }), true);
  assert.equal(isSplittableRangeError({ message: "HTTP request failed with status 403 Forbidden" }), true);
  assert.equal(isSplittableRangeError({ message: "403 Forbidden: eth_getLogs block range rejected" }), true);
});

test("isSplittableRangeError does not match an execution revert", () => {
  assert.equal(isSplittableRangeError({ code: 3, message: "execution reverted" }), false);
});

// ── integration: a splittable-range response never opens the circuit ─────
//
// Exercises the REAL poolRequest() catch-block decision (not a reimplemented
// copy of it) against a local JSON-RPC server, since this module talks to
// real HTTP endpoints via viem's http() transport and there is no mocking
// library in this repo (see tests/rpc-scheduler.test.ts / providers.test.ts
// for the pure-function-only convention this suite otherwise follows).

const CHAIN_ID_HEX = "0x1237"; // ROBINHOOD_CHAIN_ID = 4663

interface RpcResponder {
  (method: string, hitCount: number): { result?: unknown; error?: { code: number; message: string } } | "http-500";
}

function startJsonRpcServer(respond: RpcResponder): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const method = parsed.method as string;
      calls.push(method);
      if (method === "eth_chainId") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: CHAIN_ID_HEX }));
        return;
      }
      const n = (counts.get(method) ?? 0) + 1;
      counts.set(method, n);
      const outcome = respond(method, n);
      if (outcome === "http-500") {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end("internal server error");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (outcome.error) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, error: outcome.error }));
      } else {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: outcome.result ?? [] }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        calls,
      });
    });
  });
}

async function withEnv(vars: Record<string, string>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  Object.assign(process.env, vars);
  resetProviderPoolForTests();
  resetProviderSchedulerForTests();
  try {
    await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();
  }
}

test("a splittable-range error propagates without ever opening the circuit", async () => {
  const server = await startJsonRpcServer((method, n) => {
    if (n === 1) {
      return { error: { code: -32005, message: "query returned more than 10000 results" } };
    }
    return { result: [] };
  });
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "solo", url: server.url }]),
        RPC_CIRCUIT_FAILURE_THRESHOLD: "1", // a single real transport fault would open it
        RPC_RETRY_WALKS: "1",
      },
      async () => {
        // First call: the server refuses with a splittable-range error — it
        // must reject with that error, not swallow/retry it.
        await assert.rejects(
          poolRequest({ method: "eth_getLogs", params: [] }),
          /query returned more than/i
        );
        // Second call, same (only) provider: if the range error had opened
        // the circuit (threshold=1), this would fail fast with
        // RC_RPC_NO_HEALTHY_PROVIDER instead of ever reaching the server.
        const result = await poolRequest({ method: "eth_getLogs", params: [] });
        assert.deepEqual(result, []);
      }
    );
  } finally {
    await server.close();
  }
});

test("sanity check: a genuine transport fault (HTTP 500) DOES open the circuit", async () => {
  // Confirms the test harness can actually detect circuit-open behavior, so
  // the previous test's "stayed closed" result is meaningful and not just an
  // artifact of a harness that can never observe an open circuit.
  const server = await startJsonRpcServer(() => "http-500");
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "solo", url: server.url }]),
        RPC_CIRCUIT_FAILURE_THRESHOLD: "1",
        RPC_RETRY_WALKS: "1",
      },
      async () => {
        await assert.rejects(poolRequest({ method: "eth_getLogs", params: [] }));
        // The circuit is now OPEN — the next call must fail fast without
        // reaching the server again for this method.
        const callsBefore = server.calls.filter((m) => m === "eth_getLogs").length;
        await assert.rejects(
          poolRequest({ method: "eth_getLogs", params: [] }),
          /RC_RPC_NO_HEALTHY_PROVIDER|No healthy RPC provider/
        );
        const callsAfter = server.calls.filter((m) => m === "eth_getLogs").length;
        assert.equal(callsAfter, callsBefore, "circuit-open call never reaches the server");
      }
    );
  } finally {
    await server.close();
  }
});

test("a quota-exhausted first provider fails over instead of hard-failing the pool", async () => {
  // The 2026-08-21 outage, end to end. Alchemy's monthly-quota body says
  // "Monthly capacity limit exceeded", which the range classifier matched on
  // its bare `limit exceeded` alternative. poolRequest's splittable branch
  // rethrows WITHOUT failover and WITHOUT opening the circuit, so the dead
  // provider stayed first in the ranking and every call died with two healthy
  // providers idle behind it — 100% of factory-discovery runs for 12h.
  //
  // Asserted on eth_blockNumber because a method with no block range must never
  // reach that branch at all, whatever the provider's prose says.
  const dead = await startJsonRpcServer(() => ({
    error: { code: 429, message: "Monthly capacity limit exceeded. Visit https://dashboard.alchemy.com/settings/billing to upgrade your scaling policy." },
  }));
  const healthy = await startJsonRpcServer((method) =>
    method === "eth_chainId" ? { result: "0x1237" } : { result: "0x28e9a86" },
  );
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([
          { id: "quota-dead", url: dead.url },
          { id: "healthy", url: healthy.url },
        ]),
        RPC_RETRY_WALKS: "1",
      },
      async () => {
        assert.equal(await poolRequest({ method: "eth_blockNumber", params: [] }), "0x28e9a86");
        assert.ok(
          healthy.calls.includes("eth_blockNumber"),
          "the healthy provider must actually have been reached",
        );
        // And the dead provider's circuit must be free to open, so it stops
        // being tried first — the splittable branch suppresses that entirely.
        for (let i = 0; i < 6; i++) await poolRequest({ method: "eth_blockNumber", params: [] });
        const deadCalls = dead.calls.filter((m) => m === "eth_blockNumber").length;
        assert.ok(deadCalls < 7, `dead provider should be circuit-broken, got ${deadCalls} attempts`);
      },
    );
  } finally {
    await dead.close();
    await healthy.close();
  }
});

// ── L144: a pruned node refusing an old block fails over, circuit untouched ──

test("requestsHistoricalState keys on an explicit block number, never a tag", async () => {
  const { requestsHistoricalState } = await import("../lib/rpc/provider-pool");
  assert.equal(requestsHistoricalState("eth_call", [{}, "0x3c1a2b"]), true);
  assert.equal(requestsHistoricalState("eth_getBalance", ["0xabc", "0x10"]), true);
  assert.equal(requestsHistoricalState("eth_call", [{}, "latest"]), false);
  assert.equal(requestsHistoricalState("eth_getLogs", [{ fromBlock: "0x1" }]), false);
  assert.equal(requestsHistoricalState("eth_blockNumber", []), false);
});

const PRUNED = { error: { code: -32000, message: "metadata is not found, 63032488" } };

test("a historical eth_call the first node has pruned is served by the next, and the pruned node stays in rotation", async () => {
  const pruned = await startJsonRpcServer(() => PRUNED);
  const archive = await startJsonRpcServer(() => ({ result: "0x2a" }));
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([
          { id: "pruned", url: pruned.url },
          { id: "archive", url: archive.url },
        ]),
        RPC_CIRCUIT_FAILURE_THRESHOLD: "1", // one counted fault would open it
        RPC_RETRY_WALKS: "1",
      },
      async () => {
        for (let i = 0; i < 3; i++) {
          assert.equal(await poolRequest({ method: "eth_call", params: [{ to: "0x01" }, "0x3c1a2b"] }), "0x2a");
        }
        const prunedCalls = pruned.calls.filter((m) => m === "eth_call").length;
        // An opened circuit would skip the pruned node after its first miss.
        assert.equal(prunedCalls, 3, "a missing-state answer must never open the circuit");
        assert.equal(archive.calls.filter((m) => m === "eth_call").length, 3);
      },
    );
  } finally {
    await pruned.close();
    await archive.close();
  }
});

test("the same prose on a `latest` read is still a counted fault", async () => {
  // Proves the structural gate: without a block number the request cannot earn
  // the pruned-node reading, so a node saying this at head is unhealthy.
  const pruned = await startJsonRpcServer(() => PRUNED);
  const archive = await startJsonRpcServer(() => ({ result: "0x2a" }));
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([
          { id: "pruned", url: pruned.url },
          { id: "archive", url: archive.url },
        ]),
        RPC_CIRCUIT_FAILURE_THRESHOLD: "1",
        RPC_RETRY_WALKS: "1",
      },
      async () => {
        for (let i = 0; i < 3; i++) {
          assert.equal(await poolRequest({ method: "eth_call", params: [{ to: "0x01" }, "latest"] }), "0x2a");
        }
        assert.ok(pruned.calls.filter((m) => m === "eth_call").length < 3, "the circuit must open on a head read");
      },
    );
  } finally {
    await pruned.close();
    await archive.close();
  }
});

test("when every node lacks the block, the missing-state error surfaces without a retry walk", async () => {
  const a = await startJsonRpcServer(() => PRUNED);
  const b = await startJsonRpcServer(() => PRUNED);
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([
          { id: "a", url: a.url },
          { id: "b", url: b.url },
        ]),
        RPC_RETRY_WALKS: "3",
      },
      async () => {
        await assert.rejects(
          poolRequest({ method: "eth_call", params: [{ to: "0x01" }, "0x10"] }),
          /metadata is not found/,
        );
        assert.equal(a.calls.filter((m) => m === "eth_call").length, 1, "no second walk");
        assert.equal(b.calls.filter((m) => m === "eth_call").length, 1, "no second walk");
      },
    );
  } finally {
    await a.close();
    await b.close();
  }
});
