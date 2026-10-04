import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createScanContext, runWithScanContext } from "../lib/observability/context";
import { poolRequest, resetProviderPoolForTests } from "../lib/rpc/provider-pool";
import { resetProviderSchedulerForTests } from "../lib/rpc/scheduler";

type Reply = { status?: number; result?: unknown; delayMs?: number; wait?: Promise<void> };
async function startServer(reply: (method: string, count: number) => Promise<Reply> | Reply) {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  let activeCalls = 0;
  let maxActiveCalls = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const parsed = JSON.parse(body);
      const method = parsed.method as string;
      calls.push(method);
      const count = (counts.get(method) ?? 0) + 1;
      counts.set(method, count);
      if (method !== "eth_chainId") {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      }
      const out = await reply(method, count);
      if (out.delayMs) await new Promise((resolve) => setTimeout(resolve, out.delayMs));
      if (out.wait) await out.wait;
      if (method !== "eth_chainId") activeCalls -= 1;
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: out.result ?? [] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    calls,
    count: (method: string) => counts.get(method) ?? 0,
    get maxActiveCalls() { return maxActiveCalls; },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function withEnv(vars: Record<string, string>, fn: () => Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  resetProviderPoolForTests();
  resetProviderSchedulerForTests();
  try { await fn(); }
  finally {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();
  }
}

test("a route deadline keeps the provider slot reserved until the HTTP request settles", async () => {
  let releaseSlow!: () => void;
  const slowResponse = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const slow = await startServer((method) => ({
    result: method === "eth_chainId" ? "0x1237" : "slow",
    wait: method === "eth_call" ? slowResponse : undefined,
  }));
  const secondary = await startServer((method) => ({ result: method === "eth_chainId" ? "0x1237" : "secondary" }));
  try {
    await withEnv({
      RPC_ENDPOINTS_JSON: JSON.stringify([
        { id: "slow", url: slow.url, maxConcurrentRequests: 1 },
        { id: "secondary", url: secondary.url },
      ]),
      RPC_REQUEST_TIMEOUT_MS: "30000",
      RPC_SCAN_DEADLINE_MS: "5000",
      RPC_RETRY_WALKS: "1",
      RPC_MAX_SATURATION_WAITS: "2",
      RPC_SATURATION_WAIT_MS: "10",
    }, async () => {
      // Finish startup chain probes before measuring route admission. The
      // held HTTP response, rather than a timed server delay, controls overlap.
      await poolRequest({ method: "eth_chainId", params: [] }, "swap");
      const ctx = createScanContext("deadline-test");
      const first = runWithScanContext(ctx, () => poolRequest({ method: "eth_call", params: [] }, "swap"));
      const deadlineResult = assert.rejects(first, { name: "TimeoutError" });
      await deadlineResult;
      assert.equal(slow.count("eth_call"), 1, "the held request reached the first provider before its deadline");

      const next = await poolRequest({ method: "eth_call", params: [] }, "swap");
      assert.equal(next, "secondary", "the second call must skip the still-busy capped provider");
      assert.equal(slow.count("eth_call"), 1, "no second request reached the slow endpoint");
      assert.equal(slow.maxActiveCalls, 1, "the endpoint never exceeded maxConcurrentRequests=1");
    });
  } finally {
    releaseSlow();
    await Promise.all([slow.close(), secondary.close()]);
  }
});

test("caller cancellation does not open a circuit for the provider's late HTTP failure", async () => {
  const primary = await startServer((method, count) => {
    if (method === "eth_chainId") return { result: "0x1237" };
    return count === 1 ? { status: 500, delayMs: 80 } : { result: "primary-recovered" };
  });
  const secondary = await startServer((method) => ({ result: method === "eth_chainId" ? "0x1237" : "secondary" }));
  try {
    await withEnv({
      RPC_ENDPOINTS_JSON: JSON.stringify([
        { id: "primary", url: primary.url },
        { id: "secondary", url: secondary.url },
      ]),
      RPC_CIRCUIT_FAILURE_THRESHOLD: "1",
      RPC_RETRY_WALKS: "1",
    }, async () => {
      const ctx = createScanContext("caller-cancel-test");
      const controller = new AbortController();
      ctx.signal = controller.signal;
      const cancelled = runWithScanContext(ctx, () => poolRequest({ method: "eth_call", params: [] }, "swap"));
      while (primary.count("eth_call") === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      controller.abort();
      await assert.rejects(cancelled, { name: "AbortError" });
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "primary-recovered");
      assert.equal(primary.count("eth_call"), 2, "the late cancelled failure did not open the primary circuit");
      assert.equal(secondary.count("eth_call"), 0);
    });
  } finally {
    await Promise.all([primary.close(), secondary.close()]);
  }
});
