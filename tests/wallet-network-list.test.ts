import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_TESTNET_CHAIN_ID,
  activeSaleChainId,
  setActiveSaleChainId,
  walletNetworks,
} from "../lib/config/chain";

/**
 * The wallet stack's network list froze the operator out of the admin panel.
 *
 * `walletNetworks()` used to return the sale's chain alone, and that list is
 * built ONCE per page load, from `window.__SALE_CHAIN_ID__` — which is null on
 * every prerendered route, because app/layout.tsx reads the column at build
 * time where there is no DATABASE_URL. Landing anywhere static therefore built
 * a mainnet-only wallet stack for the whole session: wagmi reported 4663 no
 * matter what the wallet was really on, AppKit opened its UnsupportedChain view
 * for the testnet the sale was actually on, and @reown's `ModalUtil.safeClose`
 * refuses to close that view (it shakes), so the X did nothing.
 *
 * Two invariants, and the SECOND is the one that hides: a two-entry list is
 * useless if AppKit is still allowed to seize the UI for a third chain.
 */

test("both Robinhood chains are always configured, so switchChain can reach either", () => {
  const ids = walletNetworks().map((c) => c.id);
  assert.equal(ids.length, 2, "a one-entry list is the lockout: wagmi cannot switch to an unconfigured chain");
  assert.ok(ids.includes(ROBINHOOD_CHAIN_ID));
  assert.ok(ids.includes(ROBINHOOD_TESTNET_CHAIN_ID));
});

test("the sale's own chain is first, so it stays AppKit's default", () => {
  assert.equal(walletNetworks()[0].id, ROBINHOOD_CHAIN_ID, "unset resolves to mainnet");
});

test("a server-resolved sale chain overrides the absent global, and reorders the list", () => {
  // The store is browser-only on purpose: module state on the server is shared
  // by every concurrent request. Stand in for the browser to exercise it.
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  g.window = {};
  try {
    setActiveSaleChainId(ROBINHOOD_TESTNET_CHAIN_ID);
    assert.equal(activeSaleChainId(), ROBINHOOD_TESTNET_CHAIN_ID);
    assert.equal(walletNetworks()[0].id, ROBINHOOD_TESTNET_CHAIN_ID);
    assert.equal(walletNetworks().length, 2, "mainnet stays reachable, or a testnet operator cannot get back");

    // Anything we cannot read the sale on is refused rather than stored: an
    // accepted junk id would point every switch prompt at a dead network.
    setActiveSaleChainId(1);
    assert.equal(activeSaleChainId(), ROBINHOOD_TESTNET_CHAIN_ID);
    setActiveSaleChainId(null);
    assert.equal(activeSaleChainId(), ROBINHOOD_TESTNET_CHAIN_ID);
  } finally {
    setActiveSaleChainId(ROBINHOOD_CHAIN_ID);
    if (!had) delete g.window;
  }
});

test("AppKit may not seize the UI over an unsupported chain", () => {
  const src = readFileSync(join(process.cwd(), "lib", "wallet", "appkit-config.ts"), "utf8");
  assert.match(
    src,
    /allowUnsupportedChain:\s*true/,
    "without this AppKit opens UnsupportedChain, whose close button cannot close it",
  );
});
