import test, { mock } from "node:test";
import assert from "node:assert/strict";

let complete = false;
let observedBudget: unknown;
const token = { address: "0x0000000000000000000000000000000000000001", asset_name: "Example", asset_symbol: "EX", category: "stock-token", verify_status: "ok" };
mock.module("@/lib/data/registry", { namedExports: { readRwaRegistryTokens: async () => [token] } });
mock.module("@/lib/config/trusted-addresses", { namedExports: {
  primeTrustedAddresses: async () => {}, isTrustedRwaToken: () => true,
} });
mock.module("@/lib/market/rwa-quotes", { namedExports: {
  readAllRwaQuotes: async (_addresses: string[], options: unknown) => {
    observedBudget = options;
    return { complete, quotes: new Map() };
  },
} });

test("pending RWA prices do not hide the list or become a shared cached outage", async () => {
  const { GET } = await import("../app/api/rwa/feed/route");
  complete = false;
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(observedBudget, { waitMs: 3000 });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.quotesComplete, false);
  assert.equal(body.tokens.length, 1);
  assert.equal(body.tokens[0].trusted, true);
  assert.equal(body.tokens[0].priceUsd, null);
});

test("complete RWA enrichment retains the existing shared response cache", async () => {
  const { GET } = await import("../app/api/rwa/feed/route");
  complete = true;
  const response = await GET();
  assert.equal(response.headers.get("cache-control"), "public, s-maxage=30, stale-while-revalidate=60");
  assert.equal((await response.json()).quotesComplete, true);
});
