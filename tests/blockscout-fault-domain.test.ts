import test from "node:test";
import assert from "node:assert/strict";
import {
  createScanContext,
  explorerFaulted,
  runWithScanContext,
} from "../lib/observability/context";
import { explorer } from "../lib/explorer/blockscout";

/**
 * Directly proves correction 2 (robust-wiggling-engelbart.md): a shadow-audit
 * ABI/source fetch failing must never trip `explorerFaulted()` / void a real
 * scan, while a scoring-domain failure still does, unchanged. No test DB or
 * live network needed — `fetch` is monkey-patched for the duration of each
 * test and always restored.
 */

function mockFetch(status: number) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "boom" }), { status })) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("a shadow-audit fetch failure records under explorer-shadow: and does not fault the scoring domain", async () => {
  const restore = mockFetch(500);
  try {
    const ctx = createScanContext();
    const result = await runWithScanContext(ctx, () =>
      explorer.smartContractFull("0xf2915d1e3c1b0c769d0c756ec43f1c1f6c99cd03")
    );
    assert.equal(result, null);

    const shadowIds = Object.keys(ctx.providerStates).filter((id) => id.startsWith("explorer-shadow:"));
    assert.ok(shadowIds.length > 0, "expected a provider state recorded under explorer-shadow:");
    assert.ok(
      Object.keys(ctx.providerStates).every((id) => !id.startsWith("explorer:")),
      "a shadow-audit fault must never record under the scoring explorer: prefix"
    );

    // The key assertion this test exists to prove: a shadow-audit-only fault
    // never trips explorerFaulted(), so assertExplorerHealthy() (pipeline.ts)
    // never voids the scan over it.
    assert.equal(explorerFaulted(ctx), false);
  } finally {
    restore();
  }
});

test("a scoring-domain failure still trips explorerFaulted(), unchanged", async () => {
  const restore = mockFetch(500);
  try {
    const ctx = createScanContext();
    const result = await runWithScanContext(ctx, () => explorer.smartContract("0xdeadbeef"));
    assert.equal(result, null);

    const scoringIds = Object.keys(ctx.providerStates).filter((id) => id.startsWith("explorer:"));
    assert.ok(scoringIds.length > 0, "expected a provider state recorded under explorer:");

    // Regression check: unchanged existing behavior for the scoring domain.
    assert.equal(explorerFaulted(ctx), true);
  } finally {
    restore();
  }
});

test("a shadow-audit call still short-circuits when the scoring domain is already faulted, but records nothing new", async () => {
  const restore = mockFetch(500);
  try {
    const ctx = createScanContext();
    // Establish a scoring-domain fault first.
    await runWithScanContext(ctx, () => explorer.smartContract("0xdeadbeef"));
    assert.equal(explorerFaulted(ctx), true);

    const before = { ...ctx.providerStates };
    const result = await runWithScanContext(ctx, () =>
      explorer.smartContractFull("0xf2915d1e3c1b0c769d0c756ec43f1c1f6c99cd03")
    );
    assert.equal(result, null);
    // Circuit breaker short-circuits before any fetch/record happens.
    assert.deepEqual(ctx.providerStates, before);
  } finally {
    restore();
  }
});
