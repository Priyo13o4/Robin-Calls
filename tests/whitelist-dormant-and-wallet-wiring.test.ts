import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Whitelist onboarding was retired 2026-09-04, and "retired" here means two
 * separate things that can each be undone without the other noticing:
 *
 *   1. no env var can switch it back on, and
 *   2. no rendered surface imports its components any more.
 *
 * A flag test alone would pass while a button sat on the landing page reading
 * a flag that is now permanently false — visible, inert, and confusing. An
 * import test alone would pass while POST /api/whitelist quietly accepted
 * signups again. Both, or neither is worth having.
 *
 * The wallet half pins §8 #10's lesson: assert the WIRING, not the logic. Both
 * chain fixes are only real if the call sites read them.
 */
const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("no env var can re-enable the whitelist", async () => {
  process.env.NEXT_PUBLIC_ENABLE_WHITELIST = "true";
  process.env.ENABLE_WHITELIST = "true";
  const { flags } = await import("../lib/config/flags");
  assert.equal(
    flags.whitelist,
    false,
    "flags.whitelist read an env var again — the retirement is only dormant while this literal stands",
  );
});

test("flags.ts does not read either whitelist env var", () => {
  const src = read("lib/config/flags.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !/process\.env\.\w*ENABLE_WHITELIST/.test(code),
    "flags.ts reads a whitelist env var outside a comment",
  );
});

test("no rendered surface imports a whitelist component", () => {
  // The components themselves stay on disk as the revival path; what must not
  // come back is a live importer. WhitelistStatusContext is excluded on
  // purpose — it is the app's wallet provider, and only its whitelist half
  // was retired.
  const surfaces = [
    "app/page.tsx",
    "app/components/site/AppSidebar.tsx",
    "app/components/site/SiteNav.tsx",
    "app/components/site/RwaDetailClient.tsx",
  ];
  for (const f of surfaces) {
    const src = read(f);
    for (const banned of ["WhitelistModal", "WhitelistCTA", "WhitelistDrawerAction"]) {
      assert.ok(
        !new RegExp(`^import[^;]*\\b${banned}\\b`, "m").test(src),
        `${f} imports ${banned} — the whitelist surface is meant to be unreachable, not merely flagged off`,
      );
    }
  }
});

test("useWallet judges the chain the SALE is on, resolved at call time", () => {
  const src = read("lib/wallet/useWallet.ts");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // For a sale on testnet ROBINHOOD_CHAIN_ID is the chain the sale is NOT on,
  // so comparing against it reported a correctly-connected user as wrong-chain
  // and would have switched them away from the sale.
  assert.ok(
    !/ROBINHOOD_CHAIN_ID/.test(code),
    "useWallet is back to hardcoding mainnet — use activeSaleChainId()",
  );
  // A CALL, not a constant. The id is injected into the document by RootLayout
  // and the framework's chunk scripts are async, so anything this module froze
  // at import time could be the mainnet fallback taken before that ran.
  assert.match(code, /activeSaleChainId/, "useWallet no longer resolves the sale chain at all");
  // And SUBSCRIBES: on a prerendered page the id is unknown at mount and
  // arrives when a sale surface resolves it, so a one-shot read leaves this
  // hook holding the mainnet guess with no reason to re-render.
  assert.match(code, /useSyncExternalStore\(\s*subscribeSaleChainId/, "useWallet reads the sale chain once and never updates");
});

test("every wallet.sendTransaction call site pins a chainId", () => {
  // A render-time chain gate cannot survive the user switching networks
  // between the click and the confirm; only the pin passed to wagmi can.
  const callSites = [
    "app/token-sale/SalePageClient.tsx",
    "app/admin/(dashboard)/token-sale/TokenSalePanel.tsx",
  ];
  for (const f of callSites) {
    const src = read(f);
    const calls = src.match(/wallet\.sendTransaction\(\{[^}]*\}/g) ?? [];
    assert.ok(calls.length > 0, `${f} no longer calls wallet.sendTransaction — update this test`);
    for (const c of calls) {
      assert.ok(
        /\bchainId\b/.test(c),
        `${f} sends a transaction without pinning chainId:\n${c}`,
      );
    }
  }
});
