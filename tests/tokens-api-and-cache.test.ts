import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { readSwappableTokens, BASE_SWAP_TOKENS } from "../lib/data/tokens";
import { GET } from "../app/api/tokens/route";
import { resetTokenApiCache } from "../lib/trade/tokens-api-cache";
import {
  IMPORTED_TOKENS_STORAGE_KEY,
  RECENT_TOKENS_STORAGE_KEY,
} from "../app/components/trade/ModernTradingCard";
import { fetchSwapPlan } from "../lib/swap/client";
import type { SwapRequest } from "../lib/swap/types";

test("readSwappableTokens: returns all BASE_SWAP_TOKENS when query is omitted and DB is absent", async () => {
  const tokens = await readSwappableTokens();
  assert.ok(tokens.length >= BASE_SWAP_TOKENS.length);
  const symbols = tokens.map((t) => t.symbol);
  assert.ok(symbols.includes("ETH"));
  assert.ok(symbols.includes("WETH"));
  assert.ok(symbols.includes("USDG"));
});

test("readSwappableTokens: filters base tokens by query string (case-insensitive)", async () => {
  const ethTokens = await readSwappableTokens("eth");
  const ethSymbols = ethTokens.map((t) => t.symbol);
  assert.ok(ethSymbols.includes("ETH"));
  assert.ok(ethSymbols.includes("WETH"));
  assert.ok(!ethSymbols.includes("USDG"));

  const usdgTokens = await readSwappableTokens("usdg");
  assert.equal(usdgTokens.length, 1);
  assert.equal(usdgTokens[0].symbol, "USDG");

  const byAddress = await readSwappableTokens("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  assert.equal(byAddress.length, 1);
  assert.equal(byAddress[0].symbol, "USDG");

  const empty = await readSwappableTokens("nonexistent_xyz_symbol");
  assert.equal(empty.length, 0);
});

test("readSwappableTokens: throws on transient DB failure when DB is configured (AGENTS.md §4)", async () => {
  const savedDbUrl = process.env.DATABASE_URL;
  try {
    // Simulate configured DATABASE_URL that cannot connect
    process.env.DATABASE_URL = "postgres://invalid_user:invalid_pass@127.0.0.1:54329/invalid_db";
    // Should throw transient failure rather than laundering failure into clean base tokens
    await assert.rejects(
      async () => {
        await readSwappableTokens();
      },
      (err: Error) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  } finally {
    if (savedDbUrl !== undefined) {
      process.env.DATABASE_URL = savedDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }
});

test("/api/tokens route: GET returns 200 with no-store when DB is unconfigured", async () => {
  resetTokenApiCache();
  const savedDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const req = new NextRequest("http://localhost/api/tokens");
    const res = await GET(req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const data = await res.json();
    assert.ok(Array.isArray(data.tokens));
    assert.ok(data.tokens.length >= 3);
  } finally {
    if (savedDbUrl !== undefined) {
      process.env.DATABASE_URL = savedDbUrl;
    }
  }
});

test("/api/tokens route: supports search query ?q= dynamically", async () => {
  resetTokenApiCache();
  const savedDbUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const req = new NextRequest("http://localhost/api/tokens?q=usdg");
    const res = await GET(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.tokens.length, 1);
    assert.equal(data.tokens[0].symbol, "USDG");
  } finally {
    if (savedDbUrl !== undefined) {
      process.env.DATABASE_URL = savedDbUrl;
    }
  }
});

test("/api/tokens route: returns 503 and no-store on transient DB failure without caching it", async () => {
  resetTokenApiCache();
  const savedDbUrl = process.env.DATABASE_URL;

  try {
    process.env.DATABASE_URL = "postgres://invalid:invalid@127.0.0.1:54329/invalid_db";
    const req = new NextRequest("http://localhost/api/tokens");
    const res = await GET(req);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const data = await res.json();
    assert.deepEqual(data, { tokens: [] });
  } finally {
    if (savedDbUrl !== undefined) {
      process.env.DATABASE_URL = savedDbUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  }
});

test("ModernTradingCard: localStorage keys match the specified contract", () => {
  assert.equal(IMPORTED_TOKENS_STORAGE_KEY, "robincalls_imported_tokens");
  assert.equal(RECENT_TOKENS_STORAGE_KEY, "robincalls_recent_tokens");
});

const dummySwapReq: SwapRequest = {
  account: "0x00000000000000000000000000000000000000aa",
  tokenIn: "0x0000000000000000000000000000000000000000",
  tokenOut: "0x269a3a9df8f8a6adfa6adfa7b556b62744888334",
  amountIn: "1000000000000000000",
  slippageBps: 50,
};

test("fetchSwapPlan: calls /api/swap/plan and returns parsed SwapPlanResponse", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let capturedUrl = "";
    let capturedBody = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      return new Response(JSON.stringify({ status: "ready", plan: { mock: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const res = await fetchSwapPlan(dummySwapReq);
    assert.equal(capturedUrl, "/api/swap/plan");
    assert.ok(capturedBody.includes("1000000000000000000"));
    assert.equal(res.status, "ready");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchSwapPlan: rebases expiresAt with positive clock skew (client ahead of server) for fresh plan", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    const serverTime = 1_700_000_000_000;
    const serverExpiresAt = 1_700_000_015_000; // 15 seconds in future on server
    const clientNow = 1_700_000_060_000; // Client is +60s ahead

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": String(serverTime),
          },
        }
      );
    }) as typeof fetch;

    Date.now = () => clientNow;

    const res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      const expectedRebased = serverExpiresAt - serverTime + clientNow;
      assert.equal(res.plan.expiresAt, expectedRebased);
      assert.equal(res.plan.expiresAt, 1_700_000_075_000);
      // Plan is fresh relative to client local clock
      assert.ok(res.plan.expiresAt > clientNow);
      assert.equal(res.plan.expiresAt - clientNow, 15_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("fetchSwapPlan: rebases expiresAt with positive clock skew (client ahead of server) for expired plan", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    const serverTime = 1_700_000_000_000;
    const serverExpiresAt = 1_699_999_995_000; // Expired 5 seconds ago on server
    const clientNow = 1_700_000_060_000; // Client is +60s ahead

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": String(serverTime),
          },
        }
      );
    }) as typeof fetch;

    Date.now = () => clientNow;

    const res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      const expectedRebased = serverExpiresAt - serverTime + clientNow;
      assert.equal(res.plan.expiresAt, expectedRebased);
      assert.equal(res.plan.expiresAt, 1_700_000_055_000);
      // Plan is expired relative to client local clock
      assert.ok(res.plan.expiresAt < clientNow);
      assert.equal(clientNow - res.plan.expiresAt, 5_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("fetchSwapPlan: rebases expiresAt with negative clock skew (client behind server) for fresh plan", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    const serverTime = 1_700_000_000_000;
    const serverExpiresAt = 1_700_000_015_000; // 15 seconds in future on server
    const clientNow = 1_699_999_940_000; // Client is -60s behind

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": String(serverTime),
          },
        }
      );
    }) as typeof fetch;

    Date.now = () => clientNow;

    const res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      const expectedRebased = serverExpiresAt - serverTime + clientNow;
      assert.equal(res.plan.expiresAt, expectedRebased);
      assert.equal(res.plan.expiresAt, 1_699_999_955_000);
      // Plan is fresh relative to client local clock (15s remaining)
      assert.ok(res.plan.expiresAt > clientNow);
      assert.equal(res.plan.expiresAt - clientNow, 15_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("fetchSwapPlan: rebases expiresAt with negative clock skew (client behind server) for expired plan", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    const serverTime = 1_700_000_000_000;
    const serverExpiresAt = 1_699_999_990_000; // Expired 10 seconds ago on server
    const clientNow = 1_699_999_940_000; // Client is -60s behind

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": String(serverTime),
          },
        }
      );
    }) as typeof fetch;

    Date.now = () => clientNow;

    const res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      const expectedRebased = serverExpiresAt - serverTime + clientNow;
      assert.equal(res.plan.expiresAt, expectedRebased);
      assert.equal(res.plan.expiresAt, 1_699_999_930_000);
      // Plan is expired relative to client local clock
      assert.ok(res.plan.expiresAt < clientNow);
      assert.equal(clientNow - res.plan.expiresAt, 10_000);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("fetchSwapPlan: makes ready plan unusable (expiresAt=0) when x-server-time header is malformed, non-numeric, or missing", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    const serverExpiresAt = 1_700_000_015_000;
    const clientNow = 1_700_000_060_000;
    Date.now = () => clientNow;

    // 1. Malformed string header
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "not-a-timestamp",
          },
        }
      );
    }) as typeof fetch;

    let res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      assert.equal(res.plan.expiresAt, 0);
    }

    // 2. Non-positive numeric header
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "-1000",
          },
        }
      );
    }) as typeof fetch;

    res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      assert.equal(res.plan.expiresAt, 0);
    }

    // 3. Zero header
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "0",
          },
        }
      );
    }) as typeof fetch;

    res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      assert.equal(res.plan.expiresAt, 0);
    }

    // 4. Missing header
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }) as typeof fetch;

    res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      assert.equal(res.plan.expiresAt, 0);
    }

    // 5. Malformed/non-finite expiresAt from server
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: null, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "1700000000000",
          },
        }
      );
    }) as typeof fetch;

    res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      assert.equal(res.plan.expiresAt, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("fetchSwapPlan: captures local timestamp at response receipt, not request start", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  try {
    const serverTime = 1_700_000_000_000;
    const serverExpiresAt = 1_700_000_015_000;
    const requestStartTime = 1_700_000_050_000;
    const responseReceiptTime = 1_700_000_050_250; // 250ms simulated roundtrip latency

    // Before fetch finishes, clock is requestStartTime. Upon response arrival, Date.now() returns responseReceiptTime.
    let fetchFinished = false;
    Date.now = () => (fetchFinished ? responseReceiptTime : requestStartTime);

    globalThis.fetch = (async () => {
      fetchFinished = true;
      return new Response(
        JSON.stringify({
          status: "ready",
          plan: { expiresAt: serverExpiresAt, tokenIn: "0x1", tokenOut: "0x2" },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": String(serverTime),
          },
        }
      );
    }) as typeof fetch;

    const res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "ready");
    if (res.status === "ready") {
      const expectedAtReceipt = serverExpiresAt - serverTime + responseReceiptTime;
      const wronglyAtStart = serverExpiresAt - serverTime + requestStartTime;
      assert.equal(res.plan.expiresAt, expectedAtReceipt);
      assert.notEqual(res.plan.expiresAt, wronglyAtStart);
    }
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("fetchSwapPlan: preserves non-ready response statuses (e.g. invalid, quote-unavailable, no-route)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    // 1. 400 Invalid
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "invalid",
          detail: "Cannot route pair.",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "1700000000000",
          },
        }
      );
    }) as typeof fetch;

    let res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "invalid");
    assert.equal("detail" in res && res.detail, "Cannot route pair.");

    // 2. 503 Quote Unavailable
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "quote-unavailable",
          detail: "Price service error.",
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "1700000000000",
          },
        }
      );
    }) as typeof fetch;

    res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "quote-unavailable");
    assert.equal("detail" in res && res.detail, "Price service error.");

    // 3. 200 No Route
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          status: "no-route",
          searchComplete: true,
          excluded: [],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-server-time": "1700000000000",
          },
        }
      );
    }) as typeof fetch;

    res = await fetchSwapPlan(dummySwapReq);
    assert.equal(res.status, "no-route");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
