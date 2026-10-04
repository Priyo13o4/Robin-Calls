import test from "node:test";
import assert from "node:assert/strict";

process.env.EXPLORER_API_URL = "https://explorer.test/api/v2";
process.env.EXPLORER_API_KEY = "test-key";

// GraphQL was removed (it failed on every prod scan); REST /smart-contracts carries the same provenance.
async function detailFor(payload: Record<string, unknown>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const { explorer } = await import("../lib/explorer/blockscout");
    return await explorer.verificationDetail("0x00000000000000000000000000000000000000aa");
  } finally {
    globalThis.fetch = original;
  }
}

test("REST reports source borrowed from the bytecode database", async () => {
  const d = await detailFor({ is_verified: true, is_fully_verified: true, is_partially_verified: false, is_verified_via_eth_bytecode_db: true, is_verified_via_sourcify: false });
  assert.equal(d?.isFullyVerified, true);
  assert.equal(d?.viaBytecodeDb, true);
  assert.equal(d?.viaSourcify, false);
});

test("a payload without the flag stays 'not said', never 'not borrowed'", async () => {
  const d = await detailFor({ is_verified: true, is_fully_verified: true });
  assert.equal(d?.isVerified, true, "control: the row itself was read");
  assert.equal(d?.viaBytecodeDb, undefined);
});
