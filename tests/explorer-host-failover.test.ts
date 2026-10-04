import test from "node:test";
import assert from "node:assert/strict";

/**
 * The PRO gateway's upstream 500s independently of the community instance.
 * Probed 2026-08-26 with both prod PRO keys: `/addresses/:id` returned
 * `{"error":"Internal server error","source":"upstream"}` on one key and a
 * connection failure on the other, WHILE `/tokens/:id/holders` served 200 on
 * both and the community instance served the same `/addresses/:id` with its
 * full payload. That fault classifies RC_EXPLORER_UNAVAILABLE and ends the
 * scan — a healthy host sat unasked while the user saw "CHAIN EXPLORER
 * unavailable" (L51).
 *
 * `getVerifiedRow`'s fallback was scoped to the verified-source question only;
 * these pin the failover across EVERY read, and — more importantly — pin the
 * two directions it must NOT go.
 */

const PRIMARY = "https://api.example-pro.test/4663/api/v2";
const FALLBACK = "https://community.example.test/api/v2";
const ADDR = "0x020bfc650a365f8bb26819deaabf3e21291018b4";

type Reply = { status: number; body: unknown } | "throw";

function mockFetch(replies: (url: string) => Reply) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const reply = replies(url);
    if (reply === "throw") throw new Error("network down");
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

async function loadExplorer() {
  process.env.EXPLORER_API_URL = PRIMARY;
  process.env.EXPLORER_FALLBACK_API_URL = FALLBACK;
  const mod = (await import(
    `../lib/explorer/blockscout.ts?t=${Math.random()}`
  )) as typeof import("../lib/explorer/blockscout");
  return mod.explorer;
}

const ADDRESS_ROW = {
  is_contract: true,
  is_verified: true,
  hash: ADDR,
  creator_address_hash: "0x3711cea4feade896c913c68f01eda97cb06d1a42",
  creation_transaction_hash: "0x111bac442a3cae479c7e23c4ff1b3e90ed6718afb0352279ea39549025682c30",
};

test("a 500 on the primary is answered by the fallback host, not surfaced as unavailable", async () => {
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch((url) =>
    url.startsWith(FALLBACK)
      ? { status: 200, body: ADDRESS_ROW }
      : { status: 500, body: { error: "Internal server error", source: "upstream" } }
  );
  try {
    const info = await explorer.addressInfo(ADDR);
    assert.equal(info?.creator_address_hash, ADDRESS_ROW.creator_address_hash);
    assert.ok(urls.some((u) => u.startsWith(FALLBACK)), "the fallback host must be asked");
  } finally {
    restore();
  }
});

test("a 404 is a domain answer and must NOT be re-asked on the second host", async () => {
  // Re-asking would launder "no such address" into "we could not look" (§4),
  // and would double every read for addresses that legitimately do not exist.
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch(() => ({ status: 404, body: { message: "Not found" } }));
  try {
    const info = await explorer.addressInfo(ADDR);
    assert.equal(info, null);
    assert.equal(urls.filter((u) => u.startsWith(FALLBACK)).length, 0, "404 must not fail over");
  } finally {
    restore();
  }
});

test("a healthy primary is never second-guessed", async () => {
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch(() => ({ status: 200, body: ADDRESS_ROW }));
  try {
    await explorer.addressInfo(ADDR);
    assert.equal(urls.filter((u) => u.startsWith(FALLBACK)).length, 0);
  } finally {
    restore();
  }
});

test("when BOTH hosts fault, the second host is still tried and nothing is invented", async () => {
  // The adapter's contract is that a fault becomes null and the router's
  // exhaustion latch is what surfaces it — so the assertion here is that
  // failover does not turn a two-host outage into a fabricated answer, and
  // does not quietly skip the second host.
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch(() => ({ status: 500, body: { error: "down" } }));
  try {
    const info = await explorer.addressInfo(ADDR);
    assert.equal(info, null, "a two-host outage must never yield a payload");
    assert.ok(urls.some((u) => u.startsWith(FALLBACK)), "the fallback must still have been tried");
  } finally {
    restore();
  }
});
