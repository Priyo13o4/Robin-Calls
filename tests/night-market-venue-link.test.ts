import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = readFileSync(join(root, "app/components/site/NightMarketTabs.tsx"), "utf8");
const fn = src.slice(src.indexOf("function venueLink"), src.indexOf("function badgeFor"));

/**
 * Every Night Market card needs one outbound link that RESOLVES.
 *
 * Prod config measured 2026-08-26: cashcat and party ship no `website` and no
 * `tokenUrlTemplate`, so their cards carried no outbound link at all; meanwhile
 * the DEX-market link was offered to DIRECT_DEX rows unconditionally.
 *
 * The new rule: the DexScreener page exists iff DexScreener returned a pair
 * for the token, and `liquidity_usd` is non-null exactly then — so THAT field
 * is the gate. Where it is absent, the explorer's token page (which always
 * resolves) takes over. No link beats a broken one, and no URL is ever
 * synthesised here.
 */

interface Rowish {
  liquidity_usd: number | null;
  pool_address: string | null;
  token_address: string;
  source_kind: "DIRECT_DEX" | "LAUNCHPAD";
}

/** The component's venueLink, restated. Pinned against the source below. */
function venueLink(row: Rowish, explorerBase: string): { href: string; label: string } {
  if (row.liquidity_usd !== null) {
    return {
      href: dexMarketUrl(row),
      label:
        row.source_kind === "DIRECT_DEX" ? "VIEW DIRECT DEX MARKET" : "VIEW DEX MARKET",
    };
  }
  return { href: `${explorerBase}/token/${row.token_address}`, label: "VIEW ON EXPLORER" };
}

function dexMarketUrl(row: Rowish): string {
  const marketId = row.pool_address ?? row.token_address;
  return `https://dexscreener.com/robinhood/${marketId}`;
}

const TOKEN = "0x" + "ab".repeat(20);
const POOL = "0x" + "cd".repeat(20);

test("a real $0 liquidity still links the DEX market — zero is a measurement", () => {
  // §8.3 in the UI layer: `!== null` is load-bearing. A truthiness gate would
  // send a drained pool's card to the explorer instead of its market.
  const out = venueLink(
    { liquidity_usd: 0, pool_address: POOL, token_address: TOKEN, source_kind: "DIRECT_DEX" },
    "https://explorer.example"
  );
  assert.equal(out.label, "VIEW DIRECT DEX MARKET");
  assert.equal(out.href, `https://dexscreener.com/robinhood/${POOL}`);
});

test("a launchpad row with liquidity links the market via its POOL address", () => {
  const out = venueLink(
    { liquidity_usd: 12_400, pool_address: POOL, token_address: TOKEN, source_kind: "LAUNCHPAD" },
    "https://explorer.example"
  );
  assert.equal(out.label, "VIEW DEX MARKET");
  assert.equal(out.href, `https://dexscreener.com/robinhood/${POOL}`);
});

test("no pool address yet → the token itself names the pair page", () => {
  const out = venueLink(
    { liquidity_usd: 900, pool_address: null, token_address: TOKEN, source_kind: "LAUNCHPAD" },
    "https://explorer.example"
  );
  assert.equal(out.href, `https://dexscreener.com/robinhood/${TOKEN}`);
});

test("liquidity unknown → explorer page, even for a DIRECT_DEX row", () => {
  // The old code linked dexscreener for every DIRECT_DEX row regardless of
  // evidence; the evidence gate now applies to every row alike.
  const out = venueLink(
    { liquidity_usd: null, pool_address: POOL, token_address: TOKEN, source_kind: "DIRECT_DEX" },
    "https://explorer.example"
  );
  assert.equal(out.label, "VIEW ON EXPLORER");
  assert.equal(out.href, `https://explorer.example/token/${TOKEN}`);
});

test("source pins: the gate is strict-null, wired into the card, and synthesises nothing", () => {
  // A truthiness rewrite (`if (row.liquidity_usd)`) is the §8.3 trap.
  assert.ok(fn.includes("row.liquidity_usd !== null"), "gate must be `!== null`, never truthiness");
  assert.ok(src.includes("{venue && ("), "venue link must be rendered from the card");
  assert.ok(src.includes("href={venue.href}"));
  // The invented-host class of bug: no template-built URL inside the selector.
  assert.ok(!/https:\/\/\$\{/.test(fn), "no synthesised hosts in venueLink");
});
