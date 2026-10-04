import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createScanContext, runWithScanContext } from "../lib/observability/context";
import { poolRequest, resetProviderPoolForTests } from "../lib/rpc/provider-pool";
import { setRpcEndpointCache } from "../lib/config/rpc-endpoints";

// A quote the browser replaced keeps no claim on the RPC budget: once the
// request's signal fires, the pool sends nothing more for it.
test("the pool sends no call for a request whose caller has left", async () => {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const p = JSON.parse(body);
      hits.push(p.method);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: p.id, result: p.method === "eth_chainId" ? "0x1237" : "0x1" }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    resetProviderPoolForTests();
    setRpcEndpointCache([{ id: "only", url }]);
    const ctx = createScanContext("abort-test");
    const caller = new AbortController();
    ctx.signal = caller.signal;

    await runWithScanContext(ctx, () => poolRequest({ method: "eth_blockNumber", params: [] }, "swap"));
    caller.abort();
    await assert.rejects(
      runWithScanContext(ctx, () => poolRequest({ method: "eth_blockNumber", params: [] }, "swap")),
      { name: "AbortError" },
    );
    assert.equal(hits.filter((m) => m === "eth_blockNumber").length, 1);
  } finally {
    resetProviderPoolForTests();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("the swap route hands the request's signal to the RPC context", () => {
  const route = readFileSync("app/api/swap/plan/route.ts", "utf8");
  assert.match(route, /trace\.signal = req\.signal;/);
  assert.match(route, /runWithScanContext\(trace,/);
});

test("a replaced quote gives its rate-limit slot back, with the refund capped", () => {
  const route = readFileSync("app/api/swap/plan/route.ts", "utf8");
  assert.match(route, /if \(req\.signal\.aborted\) void refundRateLimit\("swapPlan", clientIpFromHeaders\(req\.headers\) \?\? "anon", 10\)/);
  const limiter = readFileSync("lib/security/ratelimit.ts", "utf8");
  assert.match(limiter, /if used >= tonumber\(ARGV\[2\]\) then return 0 end/);
  // The proxy must key the budget the same way, or the refund returns someone else's slot.
  assert.match(readFileSync("proxy.ts", "utf8"), /clientIpFromHeaders\(req\.headers\) \?\? "anon"/);
});

test("an idle swap card does not re-quote on balance or price refreshes, and a hidden tab waits", () => {
  const card = readFileSync("app/components/trade/ModernTradingCard.tsx", "utf8");
  const start = card.indexOf("// Debounced auto-quote on amount");
  const effect = card.slice(start, card.indexOf("const handleRefreshQuote", start));
  assert.ok(effect.length > 0, "found the quote effect");
  assert.ok(!/\bhandleFetchQuoteBackground,\s*\n/.test(effect.slice(effect.indexOf("}, ["))), "the rebuilt callback is not a dependency");
  assert.match(effect, /fetchQuoteRef\.current\(trimmed\)/);
  assert.match(effect, /if \(document\.hidden\) \{\s*hiddenQuoteRef\.current = trimmed;/);
  assert.match(effect, /addEventListener\("visibilitychange"/);
});

test("a shown quote renews at expiry, only while visible and recently edited", () => {
  const card = readFileSync("app/components/trade/ModernTradingCard.tsx", "utf8");
  const start = card.indexOf("// A shown quote is renewed when it expires");
  assert.ok(start > 0, "found the renewal effect");
  const effect = card.slice(start, card.indexOf("const handleRefreshQuote", start));
  assert.match(effect, /activePlan\.expiresAt - Date\.now\(\)/);
  assert.match(effect, /Date\.now\(\) - lastInputAtRef\.current > 5 \* 60_000\) return;/);
  assert.match(effect, /if \(document\.hidden\) \{\s*hiddenQuoteRef\.current = trimmed;/);
  assert.match(effect, /if \(!activePlan \|\| isReviewing \|\| isPendingBroadcast\) return;/);
});
