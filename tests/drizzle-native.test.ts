import test from "node:test";
import assert from "node:assert/strict";

const address = "0x00000000C0ffeE00000000000000000000DeAD01";

test("drizzle-native: archived /scan/[address]?v=... renders without a db client", async () => {
  process.env.DATABASE_URL = "postgres://postgres:postgres@localhost:5432/postgres";

  const MockPool = {
    query: async (queryObj: any) => {
      const text = typeof queryObj === 'string' ? queryObj : queryObj.text;
      if (text.includes("verdicts")) {
        const match = text.match(/select\s+(.*?)\s+from/i);
        const cols = match ? match[1].split(',').map((c: string) => c.trim().replace(/"/g, '')) : [];
        
        const rowObj: any = {
          id: 123,
          token_address: address.toLowerCase(),
          token_name: "Mock Token",
          token_symbol: "MOCK",
          score: 5,
          tier: "SAFE",
          critical_override: null,
          score_version: "v1",
          checks: {},
          market_snapshot: null,
          entry_hash: "abc",
          prev_hash: "xyz",
          anchor_tx: null,
          anchored_at: null,
          created_at: new Date(),
          result_fingerprint: "abc",
          completeness: "complete",
          receipt_policy_version: "1",
          dex_protocols: ["uniswap_v2"],
          primary_pool_address: null,
          scan_started_at: null,
          count: "1"
        };
        if (queryObj.rowMode === "array") {
          return { rows: [cols.map((c: string) => rowObj[c] !== undefined ? rowObj[c] : null)] };
        } else {
          return { rows: [rowObj] };
        }
      }
      return { rows: [] };
    }
  } as any;

  (globalThis as any).robincallsPgPool = MockPool;

  const { readArchivedVerdict } = await import("../app/scan/[address]/page");
  
  const result = await readArchivedVerdict(address.toLowerCase(), 123);
  assert.ok(result);
  assert.equal(result?.ledger?.id, 123);
  assert.equal(result?.verdict?.tier, "SAFE");

  delete (globalThis as any).robincallsPgPool;
});
