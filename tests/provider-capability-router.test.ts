import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  isSplittableRangeError,
  logSpanOf,
  providerServes,
  providerServesMethod,
  parseEndpointConfig,
  poolRequest,
  OversizedLogRangeError,
  resetProviderPoolForTests,
  type ProviderEndpoint,
} from "../lib/rpc/provider-pool";
import { CuLimiter, cuCost, resetCuLimiterForTests } from "../lib/rpc/cu-limiter";
import { resetProviderSchedulerForTests } from "../lib/rpc/scheduler";

// ── logSpanOf: bounding an eth_getLogs range ─────────────────────────────

test("logSpanOf reads hex, decimal, and bigint block bounds", () => {
  assert.equal(logSpanOf([{ fromBlock: "0x0", toBlock: "0x64" }]), 100);
  assert.equal(logSpanOf([{ fromBlock: "10", toBlock: "40" }]), 30);
  assert.equal(logSpanOf([{ fromBlock: 5n, toBlock: 9n }]), 4);
});

test("logSpanOf returns null for symbolic tags or a malformed shape (never filtered)", () => {
  assert.equal(logSpanOf([{ fromBlock: "0x0", toBlock: "latest" }]), null);
  assert.equal(logSpanOf([{ fromBlock: "earliest", toBlock: "0x5" }]), null);
  assert.equal(logSpanOf([{}]), null);
  assert.equal(logSpanOf(["0xfilterId"]), null);
  assert.equal(logSpanOf(undefined), null);
});

// ── capability predicates ────────────────────────────────────────────────

test("providerServesMethod honors allow/deny lists", () => {
  assert.equal(providerServesMethod(undefined, "eth_call"), true);
  assert.equal(providerServesMethod({ denyMethods: ["eth_getLogs"] }, "eth_getLogs"), false);
  assert.equal(providerServesMethod({ denyMethods: ["eth_getLogs"] }, "eth_call"), true);
  assert.equal(providerServesMethod({ allowMethods: ["eth_getLogs"] }, "eth_call"), false);
  assert.equal(providerServesMethod({ allowMethods: ["eth_getLogs"] }, "eth_getLogs"), true);
});

test("providerServes excludes a provably-oversized getLogs but never a tag range", () => {
  const capped: ProviderEndpoint = { id: "g", url: "https://g", capabilities: { maxLogSpan: 19999 } };
  assert.equal(providerServes(capped, "eth_getLogs", [{ fromBlock: "0x0", toBlock: "0x1" }]), true);
  // 20,001-block span (delta 20000) is over Goldsky's 19,999 cap.
  assert.equal(providerServes(capped, "eth_getLogs", [{ fromBlock: "0", toBlock: "20000" }]), false);
  // Unbounded (tag) range is not provably over — left to try, not filtered.
  assert.equal(providerServes(capped, "eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest" }]), true);
  // The cap only applies to eth_getLogs.
  assert.equal(providerServes(capped, "eth_call", [{}]), true);
  // An uncapped provider serves any span.
  const open: ProviderEndpoint = { id: "pub", url: "https://pub" };
  assert.equal(providerServes(open, "eth_getLogs", [{ fromBlock: "0", toBlock: "9999999" }]), true);
});

// ── config parsing / validation ──────────────────────────────────────────

test("parseEndpointConfig parses a capabilities block", () => {
  const eps = parseEndpointConfig({
    RPC_ENDPOINTS_JSON: JSON.stringify([
      { id: "goldsky", url: "https://edge.goldsky.com", capabilities: { maxLogSpan: 19999, denyMethods: ["eth_sendRawTransaction"] } },
      { id: "public", url: "https://rpc.example" },
    ]),
  });
  assert.equal(eps[0].capabilities?.maxLogSpan, 19999);
  assert.deepEqual(eps[0].capabilities?.denyMethods, ["eth_sendRawTransaction"]);
  assert.equal(eps[1].capabilities, undefined);
});

test("parseEndpointConfig rejects a malformed capabilities block", () => {
  const bad = (caps: unknown) => () =>
    parseEndpointConfig({
      RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "x", url: "https://x", capabilities: caps }]),
    });
  assert.throws(bad({ maxLogSpan: -5 }), /maxLogSpan must be a positive integer/);
  assert.throws(bad({ maxLogSpan: 1.5 }), /maxLogSpan must be a positive integer/);
  assert.throws(bad({ denyMethods: "eth_getLogs" }), /denyMethods must be an array/);
  assert.throws(bad([1, 2]), /capabilities must be an object/);
});

// ── splittable-range classification incl. Goldsky shapes ─────────────────

test("isSplittableRangeError recognizes Goldsky's -32012 and its range messages", () => {
  assert.equal(isSplittableRangeError({ code: -32012, message: "Range too large" }), true);
  assert.equal(isSplittableRangeError({ message: "ErrGetLogsExceededMaxAllowedRange" }), true);
  assert.equal(isSplittableRangeError({ message: "request exceeded max allowed range" }), true);
  // Its transient siblings must NOT be treated as splittable.
  assert.equal(isSplittableRangeError({ code: -32005, message: "Too many requests" }), false);
  assert.equal(isSplittableRangeError({ code: -32015, message: "upstream node timed out" }), false);
});

test("a QUOTA/rate-limit refusal is not a range refusal — it must fail over", () => {
  // The outage this pins. Alchemy's monthly-quota body is
  // "Monthly capacity limit exceeded", which matched the bare `limit exceeded`
  // alternative and routed a DEAD provider into the healthy-provider branch of
  // poolRequest — no failover, no circuit, so it stayed first in the ranking
  // forever. Prod 2026-08-21/22: 100% of factory-discovery runs failed with two
  // healthy providers idle behind it.
  //
  // This case was previously KNOWN and worked around: the test above chose
  // Goldsky wording specifically because it "does not collide with the broad
  // 'limit exceeded' range pattern". A test written to dodge the bug can never
  // fail on it (§8 #10), so the colliding strings are now the assertion.
  for (const message of [
    "Monthly capacity limit exceeded. Visit https://dashboard.alchemy.com/settings/billing to upgrade your scaling policy for continued service.",
    "rate limit exceeded",
    "daily request limit exceeded",
    "Your app has exceeded its compute units per second capacity",
  ]) {
    assert.equal(isSplittableRangeError({ message }), false, message);
  }

  // …while limit wording that NAMES a range subject still splits.
  for (const message of [
    "requested block range exceeds the limit of 2000",
    "log query exceeds limit of 10000 results",
    "query returned more than 10000 results",
    "eth_getLogs is limited to a 10 block range",
  ]) {
    assert.equal(isSplittableRangeError({ message }), true, message);
  }
});

test("OversizedLogRangeError is classified splittable by its tag, not its wording", () => {
  assert.equal(isSplittableRangeError(new OversizedLogRangeError(50000)), true);
  // Even wrapped as a cause.
  assert.equal(isSplittableRangeError({ message: "wrapper", cause: new OversizedLogRangeError(1) }), true);
});

// ── CU / RPS token bucket ────────────────────────────────────────────────

test("cuCost weights eth_getLogs far above a point read", () => {
  assert.ok(cuCost("eth_getLogs") > cuCost("eth_call"));
  assert.equal(cuCost("eth_chainId"), 0);
  assert.equal(cuCost("some_unknown_method"), 20); // DEFAULT_CU
});

test("a provider with no limits configured is never throttled", () => {
  const l = new CuLimiter();
  const ep: ProviderEndpoint = { id: "unlimited", url: "https://u" };
  for (let i = 0; i < 1000; i++) assert.equal(l.tryAcquire(ep, "eth_getLogs", 0), true);
});

test("the RPS bucket denies past its per-second budget, then refills over time", () => {
  const l = new CuLimiter();
  const ep: ProviderEndpoint = { id: "capped", url: "https://c", maxRequestsPerSecond: 3 };
  // Bucket starts full (=3): three immediate acquires, fourth denied.
  assert.equal(l.tryAcquire(ep, "eth_call", 0), true);
  assert.equal(l.tryAcquire(ep, "eth_call", 0), true);
  assert.equal(l.tryAcquire(ep, "eth_call", 0), true);
  assert.equal(l.tryAcquire(ep, "eth_call", 0), false);
  // ~334ms later one token has refilled (3/sec).
  assert.equal(l.tryAcquire(ep, "eth_call", 334), true);
  assert.equal(l.tryAcquire(ep, "eth_call", 334), false);
});

test("a single call costlier than the whole CU budget still eventually admits (no deadlock)", () => {
  const l = new CuLimiter();
  // 50 CU/s budget, one eth_getLogs costs 75 — more than a full second.
  const ep: ProviderEndpoint = { id: "tight", url: "https://t", maxCuPerSecond: 50 };
  assert.equal(l.tryAcquire(ep, "eth_getLogs", 0), true); // admitted when full, borrows into the red
  assert.equal(l.tryAcquire(ep, "eth_getLogs", 0), false);
  // A full second later the bucket has recovered to capacity and admits again.
  assert.equal(l.tryAcquire(ep, "eth_getLogs", 2000), true);
});

// ── integration: capability routing + CU skip-not-fault via poolRequest ──

const CHAIN_ID_HEX = "0x1237"; // 4663

function startJsonRpcServer(
  respond: (method: string, n: number) => { result?: unknown; error?: { code: number; message: string } },
): Promise<{ url: string; close: () => Promise<void>; counts: Map<string, number> }> {
  const counts = new Map<string, number>();
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body);
      const method = parsed.method as string;
      if (method === "eth_chainId") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: CHAIN_ID_HEX }));
        return;
      }
      const n = (counts.get(method) ?? 0) + 1;
      counts.set(method, n);
      const outcome = respond(method, n);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify(
          outcome.error
            ? { jsonrpc: "2.0", id: parsed.id, error: outcome.error }
            : { jsonrpc: "2.0", id: parsed.id, result: outcome.result ?? [] },
        ),
      );
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
        counts,
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
  resetCuLimiterForTests();
  try {
    await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();
    resetCuLimiterForTests();
  }
}

test("capability filter routes an oversized eth_getLogs to the uncapped provider", async () => {
  const capped = await startJsonRpcServer(() => ({ result: ["capped-should-not-serve"] }));
  const open = await startJsonRpcServer(() => ({ result: ["open"] }));
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([
          // Capped provider is FIRST in order — it would be preferred, but the
          // 100-block read is over its 10-block cap, so it must be filtered out.
          { id: "capped", url: capped.url, capabilities: { maxLogSpan: 10 } },
          { id: "open", url: open.url },
        ]),
      },
      async () => {
        const result = await poolRequest({
          method: "eth_getLogs",
          params: [{ fromBlock: "0x0", toBlock: "0x64" }],
        });
        assert.deepEqual(result, ["open"]);
        assert.equal(capped.counts.get("eth_getLogs") ?? 0, 0, "capped provider was sent an over-span read");
        assert.equal(open.counts.get("eth_getLogs"), 1);
      },
    );
  } finally {
    await capped.close();
    await open.close();
  }
});

test("an over-budget provider is skipped and the request still completes (no fault)", async () => {
  // Single provider with a 25 req/s budget; a 30-wide burst forces 5 skips.
  // Each skip rides the saturation-wait loop until the bucket refills — proving
  // budget exhaustion is a WAIT, not a fault (a fault would throw, not resolve).
  const server = await startJsonRpcServer(() => ({ result: ["ok"] }));
  try {
    await withEnv(
      {
        RPC_ENDPOINTS_JSON: JSON.stringify([{ id: "solo", url: server.url, maxRequestsPerSecond: 25 }]),
        RPC_SATURATION_WAIT_MS: "20",
      },
      async () => {
        const results = await Promise.all(
          Array.from({ length: 30 }, () => poolRequest({ method: "eth_call", params: [{}] })),
        );
        assert.equal(results.length, 30);
        assert.ok(results.every((r) => Array.isArray(r) && r[0] === "ok"), "some request faulted instead of waiting");
      },
    );
  } finally {
    await server.close();
  }
});
