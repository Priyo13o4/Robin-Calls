import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { poolRequest, resetProviderPoolForTests } from "../lib/rpc/provider-pool";
import { resetProviderSchedulerForTests } from "../lib/rpc/scheduler";

type Reply = { status?: number; result?: unknown; delayMs?: number };
async function startServer(reply: (method: string, count: number) => Promise<Reply> | Reply) {
  const calls: string[] = [];
  const counts = new Map<string, number>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      const parsed = JSON.parse(body);
      const method = parsed.method as string;
      calls.push(method);
      const count = (counts.get(method) ?? 0) + 1;
      counts.set(method, count);
      const out = await reply(method, count);
      if (out.delayMs) await new Promise((resolve) => setTimeout(resolve, out.delayMs));
      res.writeHead(out.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: out.result ?? [] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls,
    count: (method: string) => counts.get(method) ?? 0,
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

test("an unverified endpoint is skipped after a failed chain probe, retried later, then disabled if wrong-chain", async () => {
  const flaky = await startServer((method, count) => {
    if (method === "eth_chainId") return count === 1 ? { status: 503 } : { result: "0x1" };
    return { result: "unverified-provider" };
  });
  const healthy = await startServer((method) => ({ result: method === "eth_chainId" ? "0x1237" : "healthy-provider" }));
  try {
    await withEnv({
      RPC_ENDPOINTS_JSON: JSON.stringify([
        { id: "flaky", url: flaky.url },
        { id: "healthy", url: healthy.url },
      ]),
      RPC_CHAIN_ID_REPROBE_MS: "500",
      RPC_RETRY_WALKS: "1",
    }, async () => {
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      assert.equal(flaky.count("eth_call"), 0, "an endpoint with no successful chain proof never serves data");
      assert.equal(flaky.count("eth_chainId"), 1, "a failed probe is not hammered on every request");
      assert.equal(healthy.count("eth_chainId"), 1, "verified endpoints are not probed repeatedly");

      await new Promise((resolve) => setTimeout(resolve, 520));
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      assert.equal(flaky.count("eth_chainId"), 2, "the failed endpoint is re-probed after cooldown");
      assert.equal(flaky.count("eth_call"), 0, "a wrong-chain endpoint is permanently excluded for this pool generation");
      assert.equal(healthy.count("eth_chainId"), 1, "the healthy provider stays verified");
    });
  } finally {
    await Promise.all([flaky.close(), healthy.close()]);
  }
});

test("concurrent requests share one initial chain-id probe per endpoint", async () => {
  const server = await startServer((method) => ({ result: method === "eth_chainId" ? "0x1237" : "ok", delayMs: method === "eth_chainId" ? 30 : 0 }));
  try {
    await withEnv({ RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "one", url: server.url }]) }, async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => poolRequest({ method: "eth_blockNumber", params: [] }, "swap")));
      assert.deepEqual(results, ["ok", "ok", "ok", "ok"]);
      assert.equal(server.count("eth_chainId"), 1, "overlapping first-use calls join one probe");
    });
  } finally {
    await server.close();
  }
});

test("a verified capable provider serves while another endpoint is in a slow re-probe", async () => {
  const flaky = await startServer((method, count) => {
    if (method === "eth_chainId") {
      return count === 1 ? { status: 503 } : { result: "0x1237", delayMs: 1_500 };
    }
    return { result: "flaky-provider" };
  });
  const healthy = await startServer((method) => ({ result: method === "eth_chainId" ? "0x1237" : "healthy-provider" }));
  try {
    await withEnv({
      RPC_ENDPOINTS_JSON: JSON.stringify([
        { id: "flaky", url: flaky.url },
        { id: "healthy", url: healthy.url },
      ]),
      RPC_CHAIN_ID_REPROBE_MS: "25",
      RPC_RETRY_WALKS: "1",
      RPC_REQUEST_TIMEOUT_MS: "4000",
    }, async () => {
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      await new Promise((resolve) => setTimeout(resolve, 35));

      const startedAt = Date.now();
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      assert.ok(Date.now() - startedAt < 1_000, "healthy route should not wait for an unrelated endpoint's re-probe");
      assert.equal(flaky.count("eth_call"), 0, "the still-unverified endpoint never receives data reads");
      assert.equal(healthy.count("eth_call"), 2);
    });
  } finally {
    await Promise.all([flaky.close(), healthy.close()]);
  }
});

test("a malformed chain-id response leaves the endpoint unverified", async () => {
  const malformed = await startServer((method) => ({
    result: method === "eth_chainId" ? "0x1237junk" : "malformed-provider",
  }));
  const healthy = await startServer((method) => ({ result: method === "eth_chainId" ? "0x1237" : "healthy-provider" }));
  try {
    await withEnv({
      RPC_ENDPOINTS_JSON: JSON.stringify([
        { id: "malformed", url: malformed.url },
        { id: "healthy", url: healthy.url },
      ]),
      RPC_CHAIN_ID_REPROBE_MS: "500",
      RPC_RETRY_WALKS: "1",
    }, async () => {
      assert.equal(await poolRequest({ method: "eth_call", params: [] }, "swap"), "healthy-provider");
      assert.equal(malformed.count("eth_call"), 0, "a prefix-parsed chain ID must not verify an endpoint");
      assert.equal(malformed.count("eth_chainId"), 1);
    });
  } finally {
    await Promise.all([malformed.close(), healthy.close()]);
  }
});

test("when no endpoint has proved its chain, the call fails as a transient outage, not a capability gap", async () => {
  const down = await startServer((method) => (method === "eth_chainId" ? { status: 503 } : { result: "never" }));
  try {
    await withEnv({
      RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "down", url: down.url }]),
      RPC_CHAIN_ID_REPROBE_MS: "500",
      RPC_RETRY_WALKS: "1",
    }, async () => {
      await assert.rejects(
        poolRequest({ method: "eth_getLogs", params: [{ fromBlock: "0x1", toBlock: "0x2" }] }, "swap"),
        (err: Error) => err.name === "TimeoutError" && /confirmed its chain id/.test(err.message),
      );
      assert.equal(down.count("eth_getLogs"), 0);
    });
  } finally {
    await down.close();
  }
});
