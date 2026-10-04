import test from "node:test";
import assert from "node:assert/strict";
import { scanControlConfig } from "../lib/scan-control/config";
import { MemoryScanCoordinator } from "../lib/scan-control/memory-coordinator";
import { clientIpFrom, hashClientIp } from "../lib/scan-control";
import {
  buildScanMeta,
  capacityHeaders,
  verdictFromRow,
  CAPACITY_COPY,
} from "../lib/scan-control/serve";
import { degradedScanMessage } from "../lib/ledger/completeness";
import type { VerdictRow } from "../lib/types";

/**
 * The Redis coordinator runs the same admission policy as one Lua script;
 * the in-process coordinator is the testable mirror of that policy.
 */

function withEnv(vars: Record<string, string>, run: () => Promise<void>) {
  return async () => {
    const saved = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(vars)) {
      saved.set(k, process.env[k]);
      process.env[k] = v;
    }
    try {
      await run();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

// ── §9.1 configuration ───────────────────────────────────────

test("scan-control config uses PRD launch defaults", () => {
  const cfg = scanControlConfig();
  assert.equal(cfg.ipBurstLimit, 3);
  assert.equal(cfg.ipDailyLimit, 25);
  assert.equal(cfg.tokenCooldownSeconds, 600);
  assert.equal(cfg.globalMaxConcurrent, 1);
  assert.equal(cfg.globalDailyPipelineLimit, 250);
  assert.equal(cfg.lockTtlSeconds, 210);
  assert.equal(cfg.lockWaitSeconds, 20);
});

test(
  "scan-control config reads env overrides and ignores garbage",
  withEnv(
    { SCAN_IP_BURST_LIMIT: "7", SCAN_LOCK_TTL_SECONDS: "not-a-number" },
    async () => {
      const cfg = scanControlConfig();
      assert.equal(cfg.ipBurstLimit, 7);
      assert.equal(cfg.lockTtlSeconds, 210); // malformed → default
    }
  )
);

// ── fresh-pipeline admission (§9.2: consume only when every gate passes) ──

test(
  "ip burst budget denies the 4th fresh pipeline with scope=ip",
  withEnv({ SCAN_GLOBAL_MAX_CONCURRENT: "10" }, async () => {
    const c = new MemoryScanCoordinator();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const a = await c.admitFreshPipeline("ip-a", now);
      assert.equal(a.ok, true, `admission ${i + 1} should pass`);
      await c.releasePipelineSlot();
    }
    const denied = await c.admitFreshPipeline("ip-a", now);
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.scope, "ip");
      assert.equal(denied.limit, 3);
      assert.equal(denied.remaining, 0);
      assert.ok(denied.retryAfterSeconds >= 1);
    }
    // a different IP is not affected by ip-a's burst
    const other = await c.admitFreshPipeline("ip-b", now);
    assert.equal(other.ok, true);
  })
);

test("global concurrency of 1 denies a second simultaneous pipeline", async () => {
  const c = new MemoryScanCoordinator();
  const now = Date.now();
  assert.equal((await c.admitFreshPipeline("ip-1", now)).ok, true);
  const denied = await c.admitFreshPipeline("ip-2", now);
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.scope, "global");
  await c.releasePipelineSlot();
  assert.equal((await c.admitFreshPipeline("ip-2", now)).ok, true);
});

test("a denied admission consumes no budget", async () => {
  const c = new MemoryScanCoordinator();
  const now = Date.now();
  assert.equal((await c.admitFreshPipeline("ip-1", now)).ok, true);
  // denied by concurrency — must not eat ip-2's burst budget
  for (let i = 0; i < 5; i++) await c.admitFreshPipeline("ip-2", now);
  await c.releasePipelineSlot();
  const after = await c.admitFreshPipeline("ip-2", now);
  assert.equal(after.ok, true, "ip-2 budget untouched by denied attempts");
});

test("capacity snapshot reflects usage without consuming budget (§24.15)", async () => {
  const c = new MemoryScanCoordinator();
  const now = Date.now();

  const empty = await c.readCapacitySnapshot(now);
  assert.equal(empty.coordinator, "memory");
  assert.equal(empty.reachable, true);
  assert.equal(empty.pipelinesToday.used, 0);
  assert.equal(empty.activePipelines.used, 0);

  assert.equal((await c.admitFreshPipeline("ip-1", now)).ok, true);
  await c.reserveReceiptSlot(now);

  const busy = await c.readCapacitySnapshot(now);
  assert.equal(busy.pipelinesToday.used, 1, "one fresh pipeline counted");
  assert.equal(busy.activePipelines.used, 1, "one pipeline running");
  assert.equal(busy.receiptsToday.used, 1, "one receipt reserved");

  // The read is pure: a second peek is unchanged, and a new IP can still be
  // admitted once the concurrency slot frees — reading consumed no budget.
  const again = await c.readCapacitySnapshot(now);
  assert.equal(again.pipelinesToday.used, 1, "reading did not consume budget");
  await c.releasePipelineSlot();
  assert.equal((await c.admitFreshPipeline("ip-2", now)).ok, true);
});

// ── token lock (§10.3) ───────────────────────────────────────

test("token lock is exclusive and released only by its ownership token", async () => {
  const c = new MemoryScanCoordinator();
  const token = "0xAbC0000000000000000000000000000000000001";
  const first = await c.acquireTokenLock(token);
  assert.equal(first.acquired, true);
  assert.ok(first.lockToken.length > 0);

  const second = await c.acquireTokenLock(token.toLowerCase());
  assert.equal(second.acquired, false, "same token (any case) stays locked");

  await c.releaseTokenLock(token, "wrong-ownership-token");
  assert.equal((await c.acquireTokenLock(token)).acquired, false, "wrong token must not unlock");

  await c.releaseTokenLock(token, first.lockToken);
  assert.equal((await c.acquireTokenLock(token)).acquired, true);
});

test("token lock reports remaining TTL for Retry-After derivation", async () => {
  const c = new MemoryScanCoordinator();
  const token = "0xabc0000000000000000000000000000000000002";
  await c.acquireTokenLock(token);
  const ttl = await c.tokenLockTtlSeconds(token);
  assert.ok(ttl !== null && ttl > 0 && ttl <= 210);
  assert.equal(await c.tokenLockTtlSeconds("0xdead000000000000000000000000000000000000"), null);
});

// ── token result cache (§7 steps 4–5, 13) ────────────────────

test("result cache round-trips results and failure markers, and expires", async () => {
  const c = new MemoryScanCoordinator();
  const token = "0xabc0000000000000000000000000000000000003";

  await c.writeTokenResult(
    token,
    {
      kind: "result",
      scannedAt: new Date().toISOString(),
      body: { verdict: { score: 88 } },
      receiptAction: "appended",
      completeness: "complete",
      dexProtocols: ["uniswap-v3"],
    },
    60
  );
  const hit = await c.readTokenResult(token.toUpperCase().replace("0X", "0x"));
  assert.equal(hit?.kind, "result");

  await c.writeTokenResult(
    token,
    { kind: "failure", code: "RC_SCAN_PIPELINE_FAILED", failedAt: new Date().toISOString() },
    60
  );
  const marker = await c.readTokenResult(token);
  assert.equal(marker?.kind, "failure");

  await c.writeTokenResult(
    token,
    { kind: "failure", code: "RC_SCAN_PIPELINE_FAILED", failedAt: new Date().toISOString() },
    0 // expires immediately
  );
  assert.equal(await c.readTokenResult(token), null);
});

// ── IP hashing (§10.2) ───────────────────────────────────────

test("rate keys carry a one-way hash, never the raw IP", () => {
  const hash = hashClientIp("203.0.113.7");
  assert.equal(hash.length, 24);
  assert.ok(!hash.includes("203"));
  assert.equal(hash, hashClientIp("203.0.113.7"), "stable for the same IP");
  assert.notEqual(hash, hashClientIp("203.0.113.8"));
});

test("client IP comes from the first x-forwarded-for hop", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
  assert.equal(clientIpFrom(headers), "203.0.113.7");
  assert.equal(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIpFrom(new Headers()), "unknown");
});

// ── response shaping (§9.3, §18 subset) ──────────────────────

test("scanMeta reports age and the next fresh-scan time honestly", () => {
  const scannedAt = "2026-07-14T12:00:00.000Z";
  const meta = buildScanMeta({
    source: "cache",
    receiptAction: "appended",
    completeness: "complete",
    dexProtocols: ["uniswap-v3"],
    scannedAt,
    cooldownSeconds: 600,
    requestId: "req-1",
    nowMs: Date.parse("2026-07-14T12:04:00.000Z"),
  });
  assert.equal(meta.ageSeconds, 240);
  assert.equal(meta.nextFreshScanAt, "2026-07-14T12:10:00.000Z");
  assert.equal(meta.source, "cache");
  assert.equal(meta.completeness, "complete");
  assert.deepEqual(meta.dexProtocols, ["uniswap-v3"]);
  assert.equal(meta.receiptPolicyVersion, "1");
  assert.equal(meta.providerStates, undefined);
  assert.equal(meta.degradedAttempt, undefined);
});

test("stale fallback metadata preserves a queued pool-history gap beside its provider reason", () => {
  const meta = buildScanMeta({
    source: "stale-fallback",
    receiptAction: "none",
    completeness: "partial",
    scannedAt: "2026-07-14T12:00:00.000Z",
    cooldownSeconds: 600,
    requestId: "req-history",
    degradedAttempt: {
      attemptedAt: "2026-07-14T12:04:00.000Z",
      failedProvider: "pool-history",
      reason: "history-incomplete",
      detail: "history cursor is behind the confirmed head",
    },
    historyIncomplete: {
      poolCount: 3,
      detail: "history cursor is behind the confirmed head",
      followUp: "queued",
    },
  });
  assert.equal(meta.degradedAttempt?.failedProvider, "pool-history");
  assert.equal(meta.degradedAttempt?.reason, "history-incomplete");
  assert.equal(meta.historyIncomplete?.poolCount, 3);
  assert.equal(meta.historyIncomplete?.followUp, "queued");
  assert.match(degradedScanMessage(meta), /Pool-flow history coverage is incomplete/);
  assert.match(degradedScanMessage(meta), /bounded background follow-up for 3 material pools is queued/);

  const bothDegraded = buildScanMeta({
    source: "stale-fallback",
    receiptAction: "none",
    completeness: "partial",
    scannedAt: "2026-07-14T12:00:00.000Z",
    cooldownSeconds: 600,
    requestId: "req-both",
    degradedAttempt: {
      attemptedAt: "2026-07-14T12:04:00.000Z",
      failedProvider: "market:dexscreener",
      reason: "timeout",
      detail: "history cursor is behind the confirmed head",
    },
    historyIncomplete: {
      poolCount: 2,
      detail: "history cursor is behind the confirmed head",
      followUp: "queued",
    },
  });
  assert.equal(bothDegraded.degradedAttempt?.failedProvider, "market:dexscreener");
  assert.equal(bothDegraded.degradedAttempt?.reason, "timeout");
  assert.equal(bothDegraded.historyIncomplete?.poolCount, 2);
  assert.match(degradedScanMessage(bothDegraded), /Live market data is temporarily unavailable \(timeout\)/);
  assert.match(degradedScanMessage(bothDegraded), /Pool-flow history coverage is incomplete/);
  assert.match(degradedScanMessage(bothDegraded), /bounded background follow-up for 2 material pools is queued/);
});

// ── receipt-daily budget reservation (§9.2) ──────────────────

test(
  "receipt slot reserves up to the daily budget, then denies",
  withEnv({ SCAN_GLOBAL_DAILY_RECEIPT_LIMIT: "2" }, async () => {
    const c = new MemoryScanCoordinator();
    const now = Date.now();
    assert.equal(await c.reserveReceiptSlot(now), true);
    assert.equal(await c.reserveReceiptSlot(now), true);
    assert.equal(await c.reserveReceiptSlot(now), false, "3rd exceeds budget of 2");
    // releasing a failed append frees the slot back
    await c.releaseReceiptSlot(now);
    assert.equal(await c.reserveReceiptSlot(now), true, "released slot is reusable");
  })
);

test("capacity headers follow §9.3", () => {
  const h = capacityHeaders({
    ok: false,
    scope: "pipeline-daily",
    limit: 250,
    remaining: 0,
    retryAfterSeconds: 3600,
  });
  assert.equal(h["Retry-After"], "3600");
  assert.equal(h["X-RateLimit-Scope"], "pipeline-daily");
  assert.equal(h["X-RateLimit-Limit"], "250");
  assert.equal(h["X-RateLimit-Remaining"], "0");
  assert.ok(CAPACITY_COPY["pipeline-daily"].includes("remain available"));
});

test("verdictFromRow rebuilds the public verdict from its ledger row", () => {
  const row = {
    id: 42,
    token_address: "0xabc0000000000000000000000000000000000004",
    token_name: "Test",
    token_symbol: "TST",
    score: 55,
    tier: "CAUTION",
    critical_override: null,
    score_version: "1.1",
    checks: [],
    market_snapshot: null,
    entry_hash: "e",
    prev_hash: "p",
    anchor_tx: null,
    anchored_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
  } as unknown as VerdictRow;
  const verdict = verdictFromRow(row);
  assert.equal(verdict.tokenAddress, row.token_address);
  assert.equal(verdict.score, 55);
  assert.equal(verdict.scoreVersion, "1.1");
});
