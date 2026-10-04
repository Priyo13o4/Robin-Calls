import test from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

/**
 * The token lock and the global pipeline slot must stay held for as long as
 * the scan actually runs.
 *
 * `runFreshPipeline` hands back a streaming Response whose `start()` contains
 * the whole pipeline, so the Response object returns almost immediately. The
 * route used to release both in a `finally` wrapped around that return, which
 * freed them milliseconds in: `joinInFlightScan` could never find a lock to
 * join, and `globalMaxConcurrent` was inert.
 *
 * These assertions read the REAL MemoryScanCoordinator's state — can a second
 * caller take the lock, can a second pipeline be admitted — instead of spying
 * on `releaseTokenLock`. A call-spy passes on the broken code too, because the
 * release genuinely happened, just far too early. The closing assertions are
 * the other half of the contract: both must actually be FREE once the stream
 * drains, so "hold it forever" cannot pass either.
 */

const TOKEN = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

// Deterministic: no Redis (so scanCoordinator() builds the in-process
// MemoryScanCoordinator this test inspects), no DB, scans enabled by default.
delete process.env.REDIS_URL;
delete process.env.DATABASE_URL;
delete process.env.ENABLE_PUBLIC_SCAN;
delete process.env.ENABLE_FRESH_SCAN;

/** Resolved when the mocked pipeline has been entered; released by the test. */
let pipelineEntered!: () => void;
let releasePipeline!: () => void;
const enteredPipeline = new Promise<void>((r) => {
  pipelineEntered = r;
});
const pipelineGate = new Promise<void>((r) => {
  releasePipeline = r;
});
let scanTokenCalls = 0;

mock.module("../lib/scanner/pipeline", {
  namedExports: {
    ScanError: class ScanError extends Error {},
    scanToken: async () => {
      scanTokenCalls += 1;
      pipelineEntered();
      await pipelineGate;
      return {
        verdict: {
          tokenAddress: TOKEN,
          score: 80,
          tier: "CLEAR",
          checks: [],
        },
        row: null,
        source: "fresh",
        completeness: "complete",
        // "none" keeps the result out of the cache, so the second POST below
        // is decided by the LOCK rather than by a cooldown hit.
        receiptAction: "none",
        receiptCapacityExceeded: false,
        dexProtocols: [],
      };
    },
  },
});

// Everything below is an I/O boundary this test is not about. The coordinator
// is deliberately NOT mocked — it is the subject.
mock.module("../lib/scanner/record", {
  namedExports: { readTokenRecord: async () => null },
});
mock.module("../lib/data/ledger", {
  namedExports: { latestVerdictRowForToken: async () => null },
});
mock.module("../lib/observability/scan-run", {
  namedExports: { persistScanRun: async () => undefined },
});
mock.module("../lib/observability/uncertainties", {
  namedExports: {
    collectUncertainties: () => [],
    persistUncertainties: async () => undefined,
  },
});

async function drain(res: Response): Promise<void> {
  const reader = res.body!.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

test("the token lock and the pipeline slot outlive the Response, and are freed when the scan ends", async () => {
  const { POST } = await import("../app/api/scan/route");
  const { scanCoordinator } = await import("../lib/scan-control");
  const { NextRequest } = await import("next/server");

  const coordinator = scanCoordinator();
  assert.ok(coordinator, "test needs the in-process coordinator");

  const post = (address: string) =>
    POST(
      new NextRequest("http://localhost/api/scan", {
        method: "POST",
        body: JSON.stringify({ address }),
      })
    );

  const first = await post(TOKEN);
  assert.equal(first.status, 200, "fresh scan streams a 200");

  // The Response is already back. The pipeline is still inside scanToken.
  await enteredPipeline;

  // (1) The lock must still be held. This is the assertion that fails on the
  // pre-fix route, where the finally had already released it.
  const contender = await coordinator.acquireTokenLock(TOKEN);
  assert.equal(
    contender.acquired,
    false,
    "a second caller took the token lock while the first scan was still running"
  );

  // (2) The slot must still be held: globalMaxConcurrent is 1, so a scan of a
  // DIFFERENT token cannot be admitted while this one runs.
  const otherToken = await post(OTHER);
  assert.equal(
    otherToken.status,
    429,
    "a second concurrent pipeline was admitted while the first still ran"
  );

  // (3) A second request for the SAME token is turned away while the first
  // still runs, so it cannot scan twice. It is the global slot that stops it
  // here, not the token lock: admission runs before the lock is even attempted
  // and this fixture allows one concurrent pipeline, so the same-token request
  // never reaches joinInFlightScan. AWAIT it — an unawaited request whose
  // admission lands after the release below is admitted, takes the token lock,
  // and fails assertion (4) for a reason that is about scheduling rather than
  // about the lock. That is what went red on CI and stayed green here.
  const joiner = await post(TOKEN);
  assert.equal(joiner.status, 429, "a second request for the same token was admitted");

  releasePipeline();
  await drain(first);

  // (4) Both must now be free — the half that catches "just never release".
  const afterLock = await coordinator.acquireTokenLock(TOKEN);
  assert.equal(afterLock.acquired, true, "token lock was not released when the scan ended");
  await coordinator.releaseTokenLock(TOKEN, afterLock.lockToken);

  const admission = await coordinator.admitFreshPipeline("test-ip", Date.now());
  assert.equal(admission.ok, true, "pipeline slot was not released when the scan ended");
  await coordinator.releasePipelineSlot();

  const joined = await joiner;
  await drain(joined).catch(() => undefined);

  // (5) One pipeline for one token, however many callers arrived.
  assert.equal(scanTokenCalls, 1, "the same token was scanned by two pipelines at once");
});
