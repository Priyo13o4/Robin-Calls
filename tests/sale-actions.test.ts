import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeFunctionData, toFunctionSelector, type Address } from "viem";
import { SALE_STATE, SALE_STATE_LABELS, tokenSaleAbi } from "@/lib/sale/abi";
import {
  SALE_ACTIONS,
  actionAllowedInState,
  buildSaleCall,
  type SaleAction,
  type SaleActionKind,
} from "@/lib/sale/actions";

/**
 * The calldata the buttons send, checked against the COMPILED contract.
 *
 * The independence is the point. `buildSaleCall` encodes through
 * `lib/sale/abi.ts`, so testing it against that same file proves only that the
 * file agrees with itself. Selectors here are recomputed from
 * tests/fixtures/TokenSale.abi.json — generated from the Foundry artifact — so
 * a hand-written ABI entry with a wrong name or a drifted argument type fails
 * here rather than reverting on a live sale.
 *
 * The behavioural half of this (does the call actually DO what the label says)
 * is scripts/sale-e2e-anvil.mjs, which replays these exact bytes against a real
 * EVM. Neither test replaces the other: this one pins the shape, that one pins
 * the effect.
 */

interface FixtureEntry {
  type: string;
  name: string;
  stateMutability: string;
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "tests", "fixtures", "TokenSale.abi.json"), "utf8"),
) as { entries: FixtureEntry[]; saleStateEnum: string[] };

const byName = new Map(fixture.entries.map((e) => [e.name, e]));

/** Canonical `name(type,type)` from the compiled ABI, hashed to a selector. */
function selectorFromFixture(name: string): `0x${string}` {
  const e = byName.get(name);
  assert.ok(e, `no compiled function named "${name}"`);
  return toFunctionSelector(`${name}(${e.inputs.map((i) => i.type).join(",")})`);
}

const A: Address = "0x1111111111111111111111111111111111111111";
const B: Address = "0x2222222222222222222222222222222222222222";

/** One representative of every action kind. The exhaustiveness check below is
 *  what stops this list from silently missing a newly added action. */
const SAMPLES: SaleAction[] = [
  { kind: "contribute", valueWei: 10_000_000_000_000_000n }, // 0.01 ETH
  { kind: "claim" },
  { kind: "claimRefund" },
  { kind: "claimStray" },
  { kind: "start" },
  { kind: "pause" },
  { kind: "resume" },
  { kind: "close" },
  { kind: "abandon" },
  { kind: "setFeeAddress1", feeAddress: A },
  { kind: "setFeeAddress2", feeAddress: B },
  { kind: "setFeeAddress3", feeAddress: A },
  { kind: "setContributionLimits", minInitialContribution: 1000000000000000n, contributionStep: 1000000000000000n },
  { kind: "distribute", count: 25n },
  { kind: "withdrawProceeds" },
  { kind: "withdrawUnsoldTokens", to: A },
  { kind: "sweepStray", to: B },
  { kind: "setFeeEnabled", feeAddressId: 2, enabled: false },
  { kind: "setReferralPotRecipient", recipient: B },
  { kind: "burnUnclaimed" },
  { kind: "recoverERC20", erc20: A, to: B, amount: 7n },
];

test("every action kind has a sample, and every sample is a real kind", () => {
  const kinds = new Set(Object.keys(SALE_ACTIONS) as SaleActionKind[]);
  const sampled = new Set(SAMPLES.map((s) => s.kind));
  assert.deepEqual(
    [...kinds].filter((k) => !sampled.has(k)),
    [],
    "an action exists with no sample here — add one, this test is the only thing checking its calldata",
  );
  assert.deepEqual([...sampled].filter((k) => !kinds.has(k)), []);
});

test("every action's calldata carries the compiled contract's selector", () => {
  for (const action of SAMPLES) {
    const { data } = buildSaleCall(action);
    assert.equal(
      data.slice(0, 10),
      selectorFromFixture(action.kind),
      `${action.kind}: selector does not match the compiled contract`,
    );
  }
});

test("only contribute carries ETH; every other action sends zero", () => {
  // `contribute()` is the sole payable function. Value on any other call is a
  // guaranteed revert, and a defaulted-in amount is expensive to discover.
  for (const action of SAMPLES) {
    const { value } = buildSaleCall(action);
    if (action.kind === "contribute") {
      assert.equal(value, action.valueWei);
    } else {
      assert.equal(value, 0n, `${action.kind} must send no ETH`);
    }
  }
});

test("arguments survive the round trip, in order", () => {
  // Positional encoding means a swapped pair of same-typed arguments is
  // invisible to the type system. recoverERC20(erc20, to, amount) and
  // sweepStray(to) are exactly that shape.
  const rec = buildSaleCall({ kind: "recoverERC20", erc20: A, to: B, amount: 7n });
  const decodedRec = decodeFunctionData({ abi: tokenSaleAbi, data: rec.data });
  assert.equal(decodedRec.functionName, "recoverERC20");
  assert.deepEqual(decodedRec.args, [A, B, 7n]);

  const unsold = buildSaleCall({ kind: "withdrawUnsoldTokens", to: B });
  const decodedUnsold = decodeFunctionData({ abi: tokenSaleAbi, data: unsold.data });
  assert.deepEqual(decodedUnsold.args, [B]);

  const dist = buildSaleCall({ kind: "distribute", count: 25n });
  const decodedDist = decodeFunctionData({ abi: tokenSaleAbi, data: dist.data });
  assert.deepEqual(decodedDist.args, [25n]);

  const sf1 = buildSaleCall({ kind: "setFeeAddress1", feeAddress: A });
  assert.deepEqual(decodeFunctionData({ abi: tokenSaleAbi, data: sf1.data }).args, [A]);

  const sf2 = buildSaleCall({ kind: "setFeeAddress2", feeAddress: B });
  assert.deepEqual(decodeFunctionData({ abi: tokenSaleAbi, data: sf2.data }).args, [B]);

  const sf3 = buildSaleCall({ kind: "setFeeAddress3", feeAddress: A });
  assert.deepEqual(decodeFunctionData({ abi: tokenSaleAbi, data: sf3.data }).args, [A]);

  // setFeeEnabled(uint8,bool) is the other same-shape trap: an id and a flag,
  // where a swap encodes as a valid call against the wrong leg.
  const sfe = buildSaleCall({ kind: "setFeeEnabled", feeAddressId: 2, enabled: false });
  assert.deepEqual(decodeFunctionData({ abi: tokenSaleAbi, data: sfe.data }).args, [2, false]);

  const spr = buildSaleCall({ kind: "setReferralPotRecipient", recipient: B });
  assert.deepEqual(decodeFunctionData({ abi: tokenSaleAbi, data: spr.data }).args, [B]);
});

test("a payable action is payable on the contract, and the rest are not", () => {
  for (const action of SAMPLES) {
    const compiled = byName.get(action.kind);
    assert.ok(compiled);
    if (action.kind === "contribute") {
      assert.equal(compiled.stateMutability, "payable");
    } else {
      assert.notEqual(
        compiled.stateMutability,
        "payable",
        `${action.kind} is payable on the contract — buildSaleCall sends it 0 and would strand value`,
      );
    }
  }
});

test("declared states are real SaleState values", () => {
  const valid = new Set(SALE_STATE_LABELS.map((_, i) => i));
  for (const [kind, meta] of Object.entries(SALE_ACTIONS)) {
    if (meta.states === null) continue;
    assert.ok(meta.states.length > 0, `${kind}: an empty state list disables the action forever — use null`);
    for (const st of meta.states) {
      assert.ok(valid.has(st), `${kind}: ${st} is not a SaleState`);
    }
  }
});

test("an unknown sale state never disables an action", () => {
  // §4 at the button layer: an unread state is not a closed door. The contract
  // is the enforcer and the preflight is the warning; a failed read must not
  // silently withhold a legal owner action during an incident.
  for (const kind of Object.keys(SALE_ACTIONS) as SaleActionKind[]) {
    assert.equal(actionAllowedInState(kind, undefined), true, `${kind} was disabled by an unknown state`);
  }
});

test("state gating matches the lifecycle the contract enforces", () => {
  // Spot-checks against TokenSale.sol's own modifiers, so a copy-paste in the
  // metadata cannot quietly widen a window. The full check is the anvil replay.
  assert.equal(actionAllowedInState("start", SALE_STATE.PENDING), true);
  assert.equal(actionAllowedInState("start", SALE_STATE.ACTIVE), false);
  assert.equal(actionAllowedInState("contribute", SALE_STATE.ACTIVE), true);
  assert.equal(actionAllowedInState("contribute", SALE_STATE.PAUSED), false);
  assert.equal(actionAllowedInState("claim", SALE_STATE.CLOSED), true);
  assert.equal(actionAllowedInState("claim", SALE_STATE.ABANDONED), false);
  assert.equal(actionAllowedInState("claimRefund", SALE_STATE.ABANDONED), true);
  assert.equal(actionAllowedInState("claimRefund", SALE_STATE.CLOSED), false);
  // abandon is reachable from everything except the two terminal states
  assert.equal(actionAllowedInState("abandon", SALE_STATE.CLOSED), false);
  assert.equal(actionAllowedInState("abandon", SALE_STATE.ABANDONED), false);
  // The fee addresses are gated on proceedsWithdrawn, which is a flag and not a
  // state, so no state list can express it. `states: null` is the honest shape:
  // the contract is the enforcer, and a stale state read must not hide the one
  // control that repoints a payout away from a wallet nobody holds.
  for (const kind of ["setFeeAddress1", "setFeeAddress2", "setFeeAddress3", "setFeeEnabled"] as const) {
    assert.equal(SALE_ACTIONS[kind].states, null, `${kind} is gated on a flag, not on a state`);
  }
  // burnUnclaimed is state-gated (Closed) on top of its own 60-day timer.
  assert.equal(actionAllowedInState("burnUnclaimed", SALE_STATE.CLOSED), true);
  assert.equal(actionAllowedInState("burnUnclaimed", SALE_STATE.ACTIVE), false);
  assert.equal(actionAllowedInState("burnUnclaimed", SALE_STATE.ABANDONED), false);
  // claimStray is deliberately state-independent
  assert.equal(SALE_ACTIONS.claimStray.states, null);
});

test("every fund-moving owner action carries a danger note", () => {
  // The UI keys its confirmation step on this field, so a missing note is a
  // one-click irreversible payout rather than a cosmetic gap.
  for (const kind of ["close", "abandon", "withdrawProceeds", "withdrawUnsoldTokens", "sweepStray", "recoverERC20", "burnUnclaimed"] as const) {
    assert.ok(SALE_ACTIONS[kind].danger, `${kind} moves funds or is terminal and must carry a danger note`);
  }
});
