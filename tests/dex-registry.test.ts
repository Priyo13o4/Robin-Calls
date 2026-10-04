import test from "node:test";
import assert from "node:assert/strict";
import { dexes, enabledDexes, v3Factories, v2Factories, quoteAssets, launchQuoteAssets } from "../lib/config/dex-registry";

// ── multi-DEX registry (formula v1.12) ──
//
// The registry reads process.env at CALL time, so each test sets the env it
// needs and reads a fresh view. We snapshot/restore the keys we touch so tests
// don't leak into each other.

const KEYS = [
  "ENABLE_SUSHISWAP", "ENABLE_PANCAKESWAP",
  "SUSHI_V2_FACTORY_ADDRESS", "SUSHI_V2_ROUTER02_ADDRESS",
  "SUSHI_V3_FACTORY_ADDRESS", "SUSHI_V3_SWAP_ROUTER_ADDRESS",
  "SUSHI_V3_QUOTER_V2_ADDRESS", "SUSHI_V3_POSITION_MANAGER_ADDRESS",
  "SUSHI_V4_POOL_MANAGER_ADDRESS",
  "PANCAKE_V2_FACTORY_ADDRESS", "PANCAKE_V3_FACTORY_ADDRESS",
  "PANCAKE_V3_QUOTER_V2_ADDRESS", "USDG_ADDRESS",
];
function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try { fn(); } finally {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
}

const F = (n: string) => `0x${n.repeat(40).slice(0, 40)}`;

test("v1.12: a DEX with a configured factory but no ENABLE flag stays OFF", () => {
  withEnv({ SUSHI_V3_FACTORY_ADDRESS: F("a") }, () => {
    const sushi = dexes().find((d) => d.id === "sushiswap")!;
    assert.equal(sushi.v3?.factory, F("a")); // parsed…
    assert.equal(sushi.enabled, false);       // …but inert
    assert.ok(!enabledDexes().some((d) => d.id === "sushiswap"));
  });
});

test("v1.12: enabling a DEX surfaces its factories in the discovery lists", () => {
  withEnv(
    { ENABLE_SUSHISWAP: "true", SUSHI_V3_FACTORY_ADDRESS: F("a"), SUSHI_V3_POSITION_MANAGER_ADDRESS: F("b"), SUSHI_V2_FACTORY_ADDRESS: F("c") },
    () => {
      const v3 = v3Factories().find((x) => x.dex.id === "sushiswap");
      assert.equal(v3?.v3.factory, F("a"));
      assert.equal(v3?.v3.positionManager, F("b"));
      assert.ok(v2Factories().some((x) => x.dex.id === "sushiswap" && x.v2.factory === F("c")));
    },
  );
});

test("v1.12: a missing peripheral is null, not a zero address — custody/sim degrade, discovery still works", () => {
  withEnv(
    { ENABLE_PANCAKESWAP: "true", PANCAKE_V3_FACTORY_ADDRESS: F("d") /* no quoter */ },
    () => {
      const pcs = v3Factories().find((x) => x.dex.id === "pancakeswap");
      assert.equal(pcs?.v3.factory, F("d"));
      assert.equal(pcs?.v3.quoter, null); // absent, not "0x000…"
    },
  );
});

test("v1.12: a DEX enabled but with NO configured venue is not listed as enabled", () => {
  withEnv({ ENABLE_SUSHISWAP: "true" /* no addresses */ }, () => {
    assert.ok(!enabledDexes().some((d) => d.id === "sushiswap"));
  });
});

test("v1.12: quoteAssets always includes USDG and dedupes", () => {
  withEnv({ USDG_ADDRESS: F("e") }, () => {
    const q = quoteAssets();
    assert.ok(q.includes(F("e")));
    assert.equal(new Set(q).size, q.length); // no dupes
  });
});

test("launchQuoteAssets adds valid verified stock addresses without widening scanner quoteAssets", () => {
  const stock = `0x${"A".repeat(40)}`;
  const launchQuotes = launchQuoteAssets([stock, stock, "not-an-address", "0x0000000000000000000000000000000000000000"]);
  assert.ok(launchQuotes.includes(stock.toLowerCase()));
  assert.equal(launchQuotes.filter((address) => address === stock.toLowerCase()).length, 1);
  assert.ok(!launchQuotes.includes("not-an-address"));
  assert.ok(!launchQuotes.includes("0x0000000000000000000000000000000000000000"));
  assert.ok(!quoteAssets().includes(stock.toLowerCase()), "scanner-wide quote list must stay bounded to infra assets");
});

test("v1.12: the primary Uniswap deployment is always present and enabled", () => {
  withEnv({}, () => {
    const uni = dexes().find((d) => d.id === "uniswap");
    assert.ok(uni);
    assert.equal(uni!.enabled, true);
  });
});

test("launchQuoteAssets includes base quotes and canonical stock tokens (e.g. NVDA, TSLA, HOOD)", () => {
  const base = quoteAssets();
  const launchQuotes = launchQuoteAssets();

  // All base quote assets must be in launchQuoteAssets
  for (const b of base) {
    assert.ok(launchQuotes.includes(b.toLowerCase()));
  }

  // Canonical stock tokens must be present
  const NVDA = "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec";
  const TSLA = "0x322f0929c4625ed5bad873c95208d54e1c003b2d";
  const HOOD = "0x274c8c4665c0343730c78b184e560f902a8bf200";

  assert.ok(launchQuotes.includes(NVDA));
  assert.ok(launchQuotes.includes(TSLA));
  assert.ok(launchQuotes.includes(HOOD));
  assert.equal(new Set(launchQuotes).size, launchQuotes.length); // no duplicates
});

test("launchQuoteAssets includes verified registry stocks without expanding scan quotes", () => {
  const extra = F("f");
  assert.ok(launchQuoteAssets([extra]).includes(extra));
  assert.ok(!quoteAssets().includes(extra));
});
