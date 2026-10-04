import test from "node:test";
import assert from "node:assert/strict";
import { proxyVerificationTarget } from "../lib/explorer/verification-target";

/**
 * The proxy gap: `pipeline.ts` asked for verification precision at the TOKEN
 * address. For an EIP-1167 clone that address has no verification record of its
 * own, so precision came back null and `source_verification` published the
 * unqualified "Contract source is verified on the explorer" — 11 of the 14
 * unqualified rows in prod. EXPLOITBNKR is the live case: proxy_type eip1167,
 * implementation DopplerERC20V1, which is PARTIALLY verified.
 */
test("an eip1167 clone resolves precision at its implementation", () => {
  assert.equal(
    proxyVerificationTarget("0x06e17f", {
      proxy_type: "eip1167",
      implementations: [{ address_hash: "0x3Be8B97" }],
    }),
    "0x3be8b97"
  );
});

test("a non-proxy keeps its own address", () => {
  assert.equal(
    proxyVerificationTarget("0xToken", { proxy_type: null, implementations: [] }),
    "0xtoken"
  );
});

test("an unreadable address payload keeps the requested address — never guesses a target", () => {
  assert.equal(proxyVerificationTarget("0xToken", null), "0xtoken");
});

test("a proxy whose implementation list is absent is NOT treated as a resolved non-proxy", () => {
  // §4: absent is not empty. We still read at the requested address (there is
  // nothing better to read), but the caller must be able to tell that apart
  // from a confirmed non-proxy, so the two cases return different flags.
  const unknown = proxyVerificationTarget("0xToken", { proxy_type: "eip1167" }, { detail: true });
  assert.deepEqual(unknown, { target: "0xtoken", resolvedVia: null, proxyUnresolved: true });

  const plain = proxyVerificationTarget("0xToken", { proxy_type: null, implementations: [] }, { detail: true });
  assert.deepEqual(plain, { target: "0xtoken", resolvedVia: null, proxyUnresolved: false });
});

test("a multi-implementation proxy (diamond) is not collapsed to its first facet", () => {
  // One facet's verification says nothing about the others, so picking [0]
  // would publish a precision label for a fraction of the contract (§9).
  const d = proxyVerificationTarget(
    "0xDiamond",
    { proxy_type: "eip2535", implementations: [{ address_hash: "0xA" }, { address_hash: "0xB" }] },
    { detail: true }
  );
  assert.deepEqual(d, { target: "0xdiamond", resolvedVia: null, proxyUnresolved: true });
});
