import test from "node:test";
import assert from "node:assert/strict";
import type { PublicClient } from "viem";
import {
  _setTrustedAddressDeps,
  clearTrustedAddressCache,
  isTrustedRwaToken,
  primeTrustedAddresses,
  primeTrustedRegistry,
  trustedAddressCachePrimed,
  type TrustedAddress,
} from "../lib/config/trusted-addresses";

/**
 * The registry half and the RWA-probe half of `trusted-addresses` have separate
 * costs, separate readers, and now separate clocks.
 *
 * The trap this pins: the app container runs the tracker job and scans in ONE
 * process, so they share this module cache. A registry-only prime that also
 * refreshed the RWA clock would satisfy `primeTrustedAddresses`'s TTL gate, and
 * every scan for the next 10 minutes would read an EMPTY `rwaTokens` set —
 * publishing "not a canonical RWA token" about all 194 of them. That is §4
 * exactly: a read we never performed, answered as a negative.
 *
 * Injected through `_setTrustedAddressDeps`, NOT `mock.module`: the real
 * dependencies arrive by dynamic `import()`, and module mocking does not
 * intercept those on the Linux runner. It no-ops there, the real repository
 * returns its documented empty value, and the counters below stay at zero —
 * green on macOS, red in CI, and asserting nothing in either.
 */

const RWA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ROW: TrustedAddress = {
  address: "0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3",
  category: "dex-factory",
  subtype: null,
  label: "Up CL",
  chain_id: 4663,
  dex_id: "up",
  metadata: {},
  verify_status: "ok",
};

let probeCalls = 0;
let registryReads = 0;

type Overrides = Parameters<typeof _setTrustedAddressDeps>[0];

/**
 * Install fakes WITHOUT touching the module cache. Separate from `fresh()` on
 * purpose: the DB-failure test swaps a broken registry for a working one and
 * the cache the broken load left behind is the whole subject.
 */
function installDeps(overrides: Overrides = {}): void {
  _setTrustedAddressDeps({
    adminTrust: async () => ({
      readEnabledTrustedAddresses: async () => {
        registryReads += 1;
        return [ROW];
      },
      readVerifiedRwaRegistry: async () => [
        { address: RWA, category: "rwa-token", verify_status: "ok" },
      ],
    }),
    rpcClient: async () => ({ rpc: () => ({}) as unknown as PublicClient }),
    verify: async () => ({
      verifyRwaToken: async () => {
        probeCalls += 1;
        return { ok: true, status: "ok" as const, reason: "", evidence: {} };
      },
    }),
    ...overrides,
  });
}

/** Fresh module cache, zeroed counters, fakes installed. */
function fresh(overrides: Overrides = {}): void {
  clearTrustedAddressCache();
  probeCalls = 0;
  registryReads = 0;
  installDeps(overrides);
}

test.after(() => {
  _setTrustedAddressDeps(null);
  clearTrustedAddressCache();
});

test("the registry prime costs one DB read and ZERO rpc probes", async () => {
  fresh();
  await primeTrustedRegistry();
  assert.equal(registryReads, 1);
  assert.equal(probeCalls, 0, "the 194-token RWA probe must not ride along");
  assert.ok(trustedAddressCachePrimed(), "dexEnabled reads this — it must be primed");
});

test("a registry prime does NOT satisfy the full prime", async () => {
  fresh();
  await primeTrustedRegistry();
  assert.equal(probeCalls, 0);

  // The gate that would be skipped if a registry load refreshed the RWA clock.
  await primeTrustedAddresses();
  assert.equal(probeCalls, 1, "the full prime must still probe on a warm registry");
  assert.ok(isTrustedRwaToken(RWA), "and the scanner must see the probed token as trusted");
});

test("a registry prime does not ERASE an RWA result already probed", async () => {
  fresh();
  await primeTrustedAddresses();
  assert.ok(isTrustedRwaToken(RWA));

  await primeTrustedRegistry(true);
  assert.ok(
    isTrustedRwaToken(RWA),
    "overwriting rwaTokens with an empty set publishes a negative we never read (§4)",
  );
});

test("the full prime still short-circuits when BOTH halves are fresh", async () => {
  fresh();
  await primeTrustedAddresses();
  await primeTrustedAddresses();
  assert.equal(probeCalls, 1, "a warm cache must not re-probe 194 tokens every call");
});

test("a FAILED registry read does not claim the probe ran", async () => {
  // The DB-failure path installs the env seed. If it stamped the RWA clock while
  // doing so, it would assert a probe that never happened, and the next full
  // prime would skip for a whole TTL — every scan in that window reading an
  // empty rwaTokens set. §4: the fallback must not manufacture freshness.
  fresh({
    adminTrust: async () => {
      throw new Error("DATABASE_URL unset");
    },
  });
  await primeTrustedAddresses();
  assert.equal(probeCalls, 0, "nothing to probe — the registry read never returned");

  // Registry recovers. Deps only: clearing the cache here would delete the
  // falsely-fresh clock this test exists to catch, and the test would pass
  // against the bug (it did, first time round).
  installDeps();
  probeCalls = 0;
  registryReads = 0;
  await primeTrustedAddresses();
  assert.equal(probeCalls, 1, "a failed load must leave the RWA clock stale");
});

test("a full prime never JOINS an in-flight registry prime", async () => {
  // The docstring on primeTrustedRegistry promises this direction is forbidden:
  // joining would hand the caller a load that skipped the probe entirely, and
  // the scan behind it would read an empty rwaTokens set with a null clock.
  // Separate in-flight promises are what enforce it, so pin the property.
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });

  fresh({
    adminTrust: async () => {
      await gate;
      registryReads += 1;
      return {
        readEnabledTrustedAddresses: async () => [ROW],
        readVerifiedRwaRegistry: async () => [
          { address: RWA, category: "rwa-token", verify_status: "ok" },
        ],
      };
    },
  });

  const registry = primeTrustedRegistry();
  const full = primeTrustedAddresses();
  release();
  await Promise.all([registry, full]);

  assert.equal(probeCalls, 1, "the full prime must run its own load, not join the registry one");
  assert.ok(isTrustedRwaToken(RWA), "and the probed set must reach the scanner");
});
