import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  poolRequest,
  resetProviderPoolForTests,
  type ProviderEndpoint,
} from "../lib/rpc/provider-pool";
import {
  ProviderScheduler,
  providerScheduler,
  rankEligibleProviders,
  resetProviderSchedulerForTests,
} from "../lib/rpc/scheduler";
import { resetProviderGateForTests } from "../lib/rpc/admission";

// ── rankEligibleProviders: pure composition (no network) ──────────────────
//
// Proves preference still wins first and least-inflight only breaks ties
// WITHIN a preference tier — it must never let a busy preferred provider be
// jumped by an idle non-preferred one.

const A: ProviderEndpoint = { id: "a", url: "https://a.example" };
const B: ProviderEndpoint = { id: "b", url: "https://b.example", preferMethods: ["eth_getLogs"] };
const C: ProviderEndpoint = { id: "c", url: "https://c.example", preferMethods: ["eth_getLogs"] };

test("preference still wins first; least-inflight only breaks ties within a tier", () => {
  const s = new ProviderScheduler();
  // B and C both prefer eth_getLogs; C has more in flight than B.
  s.markInflight(C);
  s.markInflight(C);
  s.markInflight(A); // A is busiest of all, but not preferred for this method

  const ranked = rankEligibleProviders(
    [{ endpoint: A }, { endpoint: B }, { endpoint: C }],
    "eth_getLogs",
    s
  );
  assert.deepEqual(
    ranked.map((r) => r.endpoint.id),
    ["b", "c", "a"],
    "preferred tier (b, c) entirely before the non-preferred tier (a), least-inflight breaking the b/c tie"
  );
});

test("with no preference declared, ranking is pure least-inflight", () => {
  const s = new ProviderScheduler();
  s.markInflight(A);
  s.markInflight(A);
  const ranked = rankEligibleProviders([{ endpoint: A }, { endpoint: B }], "eth_call", s);
  assert.deepEqual(
    ranked.map((r) => r.endpoint.id),
    ["b", "a"]
  );
});

// ── integration: real per-instance maxConcurrentRequests enforcement ─────

const CHAIN_ID_HEX = "0x1237";

interface RpcResponder {
  (method: string, hitCount: number): Promise<{ result?: unknown; error?: { code: number; message: string } }>;
}

function startJsonRpcServer(respond: RpcResponder): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
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
      const outcome = await respond(method, n);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a provider at its maxConcurrentRequests ceiling is skipped for the next eligible provider", async () => {
  const primary = await startJsonRpcServer(async () => ({ result: ["primary"] }));
  const secondary = await startJsonRpcServer(async () => ({ result: ["secondary"] }));
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([
          { id: "primary", url: primary.url, maxConcurrentRequests: 1 },
          { id: "secondary", url: secondary.url },
        ]),
      },
      async () => {
        // Pre-occupy "primary"'s single concurrency slot, simulating an
        // in-flight call from elsewhere in the process — the same singleton
        // scheduler poolRequest() itself reads.
        providerScheduler().markInflight({ id: "primary", url: primary.url });

        const result = await poolRequest({ method: "eth_getLogs", params: [] });
        assert.deepEqual(result, ["secondary"], "the at-capacity primary is skipped");
        assert.equal(
          primary.calls.includes("eth_getLogs"),
          false,
          "primary never receives the actual request while at capacity"
        );
        assert.ok(secondary.calls.includes("eth_getLogs"));
      }
    );
  } finally {
    await primary.close();
    await secondary.close();
  }
});

test("inflight count increments for the duration of an attempt and clears after, on success", async () => {
  let releaseServer: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseServer = resolve;
  });
  const server = await startJsonRpcServer(async () => {
    await gate; // hold the response open until the test releases it
    return { result: ["ok"] };
  });
  try {
    await withEnv(
      { RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "solo", url: server.url }]) },
      async () => {
        const pending = poolRequest({ method: "eth_getLogs", params: [] });
        // Give the chainId probe + attempt time to start and mark inflight.
        await delay(50);
        assert.equal(providerScheduler().inflightCount("solo"), 1, "marked inflight mid-attempt");
        releaseServer?.();
        const result = await pending;
        assert.deepEqual(result, ["ok"]);
        assert.equal(providerScheduler().inflightCount("solo"), 0, "cleared after a successful attempt");
      }
    );
  } finally {
    await server.close();
  }
});

test("inflight count clears after a failed attempt too", async () => {
  const server = await startJsonRpcServer(async () => ({
    error: { code: -32603, message: "internal error" },
  }));
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "solo", url: server.url }]),
        RPC_RETRY_WALKS: "1",
      },
      async () => {
        await assert.rejects(poolRequest({ method: "eth_getLogs", params: [] }));
        assert.equal(
          providerScheduler().inflightCount("solo"),
          0,
          "cleared even though the attempt failed"
        );
      }
    );
  } finally {
    await server.close();
  }
});
