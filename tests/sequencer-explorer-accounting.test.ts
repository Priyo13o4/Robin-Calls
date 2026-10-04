import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { accountBlockscoutHttpAttempt, blockscoutCreditsForUrl } from "@/lib/explorer/http";
import { explorerApiUrl } from "@/lib/config/chain";

const apiKey = "private-test-key-value";
const primaryUrl = `${explorerApiUrl}?module=transaction&action=gettxinfo&apikey=${apiKey}`;

test("Blockscout credit estimates use the measured endpoint rates", () => {
  assert.equal(blockscoutCreditsForUrl("https://api.test/api/v2/transactions/0x123"), 20);
  assert.equal(blockscoutCreditsForUrl("https://api.test/api/v2/transactions/0x123/internal-transactions"), 40);
  assert.equal(blockscoutCreditsForUrl("https://api.test/api/v2/addresses/0x123/logs"), 30);
  assert.equal(blockscoutCreditsForUrl("https://api.test/api?module=logs&action=getLogs"), 20);
  assert.equal(blockscoutCreditsForUrl("https://api.test/api?module=transaction&action=gettxinfo"), 20);
  assert.equal(blockscoutCreditsForUrl("https://api.test/api?module=account&action=txlistinternal"), 40);
});

test("one authenticated Blockscout attempt records one hashed spend and status metric", async () => {
  const spent: Array<[string, number]> = [];
  const metrics: Array<Record<string, unknown>> = [];
  await accountBlockscoutHttpAttempt({ requestUrl: primaryUrl, adapterId: "blockscout", domain: "scoring", endpoint: "?module=transaction&action=gettxinfo", outcome: "http_503", latencyMs: 17 }, {
    spend: async (id, credits) => { spent.push([id, credits]); },
    metric: async (metric) => { metrics.push(metric); },
  });
  assert.deepEqual(spent, [[createHash("sha256").update(apiKey).digest("hex").slice(0, 16), 20]]);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].provider, "blockscout");
  assert.equal(metrics[0].event, "http_503");
  assert.equal(metrics[0].reason, "scoring:blockscout:/api?module=transaction&action=gettxinfo");
  assert.equal(JSON.stringify(metrics).includes(apiKey), false);
});

test("community, Robinscan, and unkeyed requests are not charged; telemetry failure is isolated", async () => {
  let calls = 0;
  const deps = {
    spend: async () => { calls++; throw new Error("telemetry offline"); },
    metric: async () => { calls++; throw new Error("telemetry offline"); },
  };
  await accountBlockscoutHttpAttempt({ requestUrl: "https://community.blockscout.com/api?apikey=x", adapterId: "blockscout-verified-fallback", domain: "scoring", endpoint: "/api", outcome: "http_200", latencyMs: 2 }, deps);
  await accountBlockscoutHttpAttempt({ requestUrl: "https://robinscan.io/api/txs/0x123", adapterId: "robinscan", domain: "scoring", endpoint: "/txs/:id", outcome: "http_200", latencyMs: 2 }, deps);
  await accountBlockscoutHttpAttempt({ requestUrl: explorerApiUrl, adapterId: "blockscout", domain: "scoring", endpoint: "/api", outcome: "http_402", latencyMs: 2 }, deps);
  assert.equal(calls, 0);
  await accountBlockscoutHttpAttempt({ requestUrl: primaryUrl, adapterId: "blockscout", domain: "scoring", endpoint: "/api", outcome: "transport_error", latencyMs: 3 }, deps);
  assert.equal(calls, 2);
});
