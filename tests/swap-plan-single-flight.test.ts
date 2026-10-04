import test from "node:test";
import assert from "node:assert/strict";
import { fetchSwapPlan, isSupersededPlanError } from "../lib/swap/client";
import type { SwapRequest } from "../lib/swap/types";

const base: SwapRequest = {
  account: "0x1111111111111111111111111111111111111111",
  tokenIn: "0x0000000000000000000000000000000000000000",
  tokenOut: "0x2222222222222222222222222222222222222222",
  amountIn: "1000", slippageBps: "auto",
};

function stubFetch() {
  const calls: { body: string; signal: AbortSignal }[] = [];
  const release: Array<() => void> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls.push({ body: String(init.body), signal: init.signal! });
    await new Promise<void>((resolve, reject) => {
      release.push(resolve);
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
    return new Response(JSON.stringify({ status: "no-route", searchComplete: true, excluded: [] }), { status: 200 });
  }) as typeof fetch;
  return { calls, release, restore: () => { globalThis.fetch = original; } };
}

test("identical plan requests share one network call", async () => {
  const s = stubFetch();
  try {
    const a = fetchSwapPlan(base), b = fetchSwapPlan({ ...base });
    assert.equal(a, b);
    await new Promise((r) => setImmediate(r));
    assert.equal(s.calls.length, 1);
    s.release.forEach((r) => r());
    await a;
  } finally { s.restore(); }
});

test("a new plan request cancels the older one: one request in flight", async () => {
  const s = stubFetch();
  try {
    const first = fetchSwapPlan(base);
    await new Promise((r) => setImmediate(r));
    const second = fetchSwapPlan({ ...base, amountIn: "2000" });
    await assert.rejects(first, (err) => isSupersededPlanError(err));
    await new Promise((r) => setImmediate(r));
    assert.equal(s.calls.filter((c) => !c.signal.aborted).length, 1);
    s.release.forEach((r) => r());
    await second;
  } finally { s.restore(); }
});

test("a signed permit step is never cancelled by a background quote", async () => {
  const s = stubFetch();
  try {
    const signed = fetchSwapPlan({ ...base, permit: { token: base.tokenOut, spender: base.account, amount: "1",
      expiration: 1, nonce: 0, sigDeadline: "1", signature: "0x00" } });
    await new Promise((r) => setImmediate(r));
    const bg = fetchSwapPlan({ ...base, amountIn: "3000" });
    await new Promise((r) => setImmediate(r));
    assert.equal(s.calls[0].signal.aborted, false);
    s.release.forEach((r) => r());
    await Promise.all([signed, bg]);
  } finally { s.restore(); }
});
