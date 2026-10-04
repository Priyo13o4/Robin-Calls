import test from "node:test";
import assert from "node:assert/strict";

/**
 * The PRO gateway and the community instance are separate deployments with
 * separate verification stores. Measured 2026-08-17 across all 57 scanned
 * tokens: the PRO API had no `/smart-contracts` row for LadyMarian (FULL) or
 * LaunchToken (PARTIAL) while the community instance served both, so the audit
 * built `completeness: "unresolved"` on contracts whose source is public, and
 * a partial match published as an unqualified "verified".
 *
 * Both URLs are module-level consts read at import time, so every test here
 * sets the env FIRST and imports dynamically. Without `EXPLORER_API_URL` the
 * two hosts are identical and the fallback is correctly skipped — which is the
 * local-dev path, and is itself pinned below.
 */

const PRIMARY = "https://api.example-pro.test/4663/api/v2";
const FALLBACK = "https://community.example.test/api/v2";
const ADDR = "0x020bfc650a365f8bb26819deaabf3e21291018b4";

type Reply = { status: number; body: unknown } | "throw";

/** Records every URL fetched, so "did we ask twice?" is assertable. */
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

async function loadModule() {
  process.env.EXPLORER_API_URL = PRIMARY;
  process.env.EXPLORER_FALLBACK_API_URL = FALLBACK;
  // Cache-bust: lib/config/chain.ts captures EXPLORER_API_URL as a const at
  // first evaluation, so the env must be set before the very first import.
  return (await import(
    `../lib/explorer/blockscout.ts?t=${Math.random()}`
  )) as typeof import("../lib/explorer/blockscout");
}

async function loadExplorer() {
  return (await loadModule()).explorer;
}

const VERIFIED = {
  is_verified: true,
  is_fully_verified: false,
  is_partially_verified: true,
  name: "LaunchToken",
  source_code: "// SPDX-License-Identifier: MIT",
  abi: [{ type: "function", name: "transfer" }],
  compiler_version: "v0.8.30+commit.73712a01",
};

test("primary reports no verified row; the fallback host's verified row is used", async () => {
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch((url) =>
    url.startsWith(FALLBACK)
      ? { status: 200, body: VERIFIED }
      : { status: 200, body: { is_verified: false } }
  );
  try {
    const row = await explorer.smartContractFull(ADDR);
    assert.equal(row?.is_verified, true);
    assert.equal(row?.name, "LaunchToken");
    // The precision fields are the point: an unqualified "verified" is exactly
    // what this token was published as while the row was missing.
    assert.equal(row?.is_partially_verified, true);
    assert.equal(row?.is_fully_verified, false);
    assert.equal(urls.length, 2, "expected the primary then the fallback");
  } finally {
    restore();
  }
});

test("a verified primary is never second-guessed — the fallback host is not called at all", async () => {
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch(() => ({ status: 200, body: VERIFIED }));
  try {
    await explorer.smartContractFull(ADDR);
    assert.equal(urls.length, 1);
    assert.ok(urls[0].startsWith(PRIMARY));
  } finally {
    restore();
  }
});

test("neither host can tell us: the answer stays null, never a fabricated 'unverified'", async () => {
  const explorer = await loadExplorer();
  // 404 on both — `null` is the honest answer, and buildArtifact maps it to
  // `unresolved` with `sourceVerified: null`. A `{is_verified:false}` here
  // would be this codebase's §4 error: an absent read published as a fact.
  const { restore } = mockFetch(() => ({ status: 404, body: { error: "not found" } }));
  try {
    assert.equal(await explorer.smartContractFull(ADDR), null);
  } finally {
    restore();
  }
});

test("both hosts answer 'unverified': that stays an explicit false, not a null", async () => {
  const explorer = await loadExplorer();
  const { restore } = mockFetch(() => ({ status: 200, body: { is_verified: false } }));
  try {
    const row = await explorer.smartContractFull(ADDR);
    assert.equal(row?.is_verified, false);
  } finally {
    restore();
  }
});

test("a dead fallback host costs nothing: the primary's answer survives and no fault escapes", async () => {
  const explorer = await loadExplorer();
  // The regression this guards: an ExplorerFault escaping the fallback reaches
  // the router, counts as blockscout failing the method, and can latch
  // `explorer-exhausted:` — voiding a scan the primary already answered.
  const { restore } = mockFetch((url) =>
    url.startsWith(FALLBACK) ? "throw" : { status: 200, body: { is_verified: false } }
  );
  try {
    const row = await explorer.smartContractFull(ADDR);
    assert.equal(row?.is_verified, false);
  } finally {
    restore();
  }
});

test("verificationDetail takes the same fallback path (wiring, not just the helper)", async () => {
  const explorer = await loadExplorer();
  const { urls, restore } = mockFetch((url) =>
    url.startsWith(FALLBACK)
      ? { status: 200, body: { is_verified: true, is_fully_verified: false, is_partially_verified: true } }
      : { status: 404, body: {} }
  );
  try {
    const detail = await explorer.verificationDetail(ADDR);
    assert.deepEqual(detail, {
      isVerified: true,
      isFullyVerified: false,
      isPartiallyVerified: true,
    });
    assert.ok(urls.some((u) => u.startsWith(FALLBACK)), "verificationDetail must reach the fallback");
  } finally {
    restore();
  }
});

test("distinct hosts produce a fallback base; identical ones (local/dev) produce none", async () => {
  // Asserted on the predicate rather than through a second module load: both
  // URLs are consts in lib/config/chain.ts, which resolves once per process,
  // so a re-import of blockscout.ts cannot re-read them.
  const { verifiedFallbackBase } = await loadModule();
  assert.equal(verifiedFallbackBase(), FALLBACK, "differing hosts must yield the fallback base");

  // Same function, new env — it resolves the fallback per call by design.
  process.env.EXPLORER_FALLBACK_API_URL = `${PRIMARY}/`;
  assert.equal(
    verifiedFallbackBase(),
    null,
    "identical hosts must yield no fallback — a trailing slash is not a different deployment"
  );
  process.env.EXPLORER_FALLBACK_API_URL = FALLBACK;
});

test("the PRO key is never sent to the fallback host", async () => {
  process.env.EXPLORER_API_URL = PRIMARY;
  process.env.EXPLORER_API_KEY = "proapi_SECRET_VALUE";
  const { withApiKey } = await import(`../lib/explorer/http.ts?t=${Math.random()}`);
  try {
    assert.ok(
      withApiKey(`${PRIMARY}/smart-contracts/${ADDR}`).includes("proapi_SECRET_VALUE"),
      "the primary must still be authenticated"
    );
    const fallbackUrl = withApiKey(`${FALLBACK}/smart-contracts/${ADDR}`);
    assert.ok(
      !fallbackUrl.includes("proapi_SECRET_VALUE") && !fallbackUrl.includes("apikey"),
      "a PRO credential in a third-party query string is logged by every proxy in between (§6)"
    );
  } finally {
    delete process.env.EXPLORER_API_KEY;
  }
});

test("the v1 Etherscan-compatible endpoint on the SAME host is still authenticated", async () => {
  // The regression this exists for: scoping the key with
  // `startsWith(explorerApiUrl)` de-authenticated every v1 call, because
  // explorerApiUrl ends in `/api/v2` and v1Base() strips that suffix.
  // `module=logs&action=getLogs` is 94.8% of our PRO credit spend, unkeyed
  // requests get 402, and the pipeline turns a 402 into
  // RC_EXPLORER_UNAVAILABLE — so this silently stopped prod publishing
  // verdicts. The earlier test only covered the v2 base and a foreign host,
  // which is exactly why it stayed green.
  process.env.EXPLORER_API_URL = PRIMARY;
  process.env.EXPLORER_API_KEY = "proapi_SECRET_VALUE";
  const { withApiKey, v1Base } = await import(`../lib/explorer/http.ts?t=${Math.random()}`);
  try {
    const v1 = `${v1Base()}?module=logs&action=getLogs&address=0xabc`;
    assert.ok(v1.startsWith("https://api.example-pro.test/4663/api"), `unexpected v1 base: ${v1}`);
    assert.ok(!v1.includes("/api/v2"), "v1 must not carry the v2 suffix");
    assert.ok(
      withApiKey(v1).includes("proapi_SECRET_VALUE"),
      "a v1 call on the key's own host must still be authenticated"
    );
    // And a different PORT on the same hostname is still a different origin.
    assert.ok(!withApiKey("https://api.example-pro.test:8443/4663/api").includes("proapi_SECRET_VALUE"));
    assert.ok(!withApiKey("not a url").includes("proapi_SECRET_VALUE"));
  } finally {
    delete process.env.EXPLORER_API_KEY;
  }
});

test("multiple keys rotate round-robin, and only on the host they belong to", async () => {
  // Blockscout meters per KEY, not per IP (measured: two keys served 16/20
  // concurrent where one served 5/10), so pooling is real added throughput.
  process.env.EXPLORER_API_URL = PRIMARY;
  process.env.EXPLORER_API_KEYS = "keyA, keyB";
  const mod = await import(`../lib/explorer/http.ts?t=${Math.random()}`);
  const { withApiKey, resetApiKeyRotationForTests } = mod;
  try {
    resetApiKeyRotationForTests();
    const used = [0, 1, 2, 3].map(() => {
      const u = withApiKey(`${PRIMARY}/addresses/${ADDR}`);
      return u.includes("keyA") ? "A" : u.includes("keyB") ? "B" : "none";
    });
    assert.deepEqual(used, ["A", "B", "A", "B"], "keys must alternate");

    // A foreign host gets no key AND must not consume a rotation step —
    // otherwise one key silently ends up carrying most of the traffic.
    resetApiKeyRotationForTests();
    assert.ok(!withApiKey(`${FALLBACK}/addresses/${ADDR}`).includes("key"));
    assert.ok(withApiKey(`${PRIMARY}/addresses/${ADDR}`).includes("keyA"));
  } finally {
    delete process.env.EXPLORER_API_KEYS;
  }
});

test("the single-key env still works on its own", async () => {
  process.env.EXPLORER_API_URL = PRIMARY;
  delete process.env.EXPLORER_API_KEYS;
  process.env.EXPLORER_API_KEY = "solo";
  const { withApiKey } = await import(`../lib/explorer/http.ts?t=${Math.random()}`);
  try {
    assert.ok(withApiKey(`${PRIMARY}/addresses/${ADDR}`).includes("solo"));
  } finally {
    delete process.env.EXPLORER_API_KEY;
  }
});
