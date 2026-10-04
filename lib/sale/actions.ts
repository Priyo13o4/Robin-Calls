import { encodeFunctionData, type Address, type Hex } from "viem";
import { SALE_STATE, tokenSaleAbi } from "./abi";

/**
 * Every write the sale surfaces can make, in one place, as data rather than as
 * a click handler.
 *
 * The point is testability. A button that inlines `encodeFunctionData` can only
 * be checked by rendering it; a spec can be diffed against the compiled ABI at
 * the selector level and replayed against a real EVM. Both of those tests exist
 * (tests/sale-actions.test.ts, scripts/sale-e2e-anvil.mjs), and neither is
 * possible while the calldata lives inside JSX.
 *
 * `value` is part of the spec, not a caller's option. `contribute()` is the ONLY
 * payable function on this contract, so a non-zero value on any other call is a
 * guaranteed revert — a defaulted-in ETH amount is the kind of mistake that
 * costs a whole transaction to discover.
 */

export type SaleAction =
  // ---- anyone ----
  | { kind: "contribute"; valueWei: bigint }
  | { kind: "claim" }
  | { kind: "claimRefund" }
  | { kind: "claimStray" }
  // ---- owner: lifecycle ----
  | { kind: "start" }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "close" }
  | { kind: "abandon" }
  | { kind: "setFeeAddress1"; feeAddress: Address }
  | { kind: "setFeeAddress2"; feeAddress: Address }
  | { kind: "setFeeAddress3"; feeAddress: Address }
  | { kind: "setFeeEnabled"; feeAddressId: 1 | 2 | 3; enabled: boolean }
  | { kind: "setReferralPotRecipient"; recipient: Address }
  | { kind: "setContributionLimits"; minInitialContribution: bigint; contributionStep: bigint }
  // ---- owner: distribution and treasury ----
  | { kind: "distribute"; count: bigint }
  | { kind: "withdrawProceeds" }
  | { kind: "withdrawUnsoldTokens"; to: Address }
  | { kind: "sweepStray"; to: Address }
  | { kind: "burnUnclaimed" }
  | { kind: "recoverERC20"; erc20: Address; to: Address; amount: bigint };

export type SaleActionKind = SaleAction["kind"];

/** The transaction body for an action. `to` is supplied by the caller — the
 *  sale address is configuration, not part of the action's identity. */
export interface SaleCall {
  data: Hex;
  /** Always 0n except for `contribute` — see the note above. */
  value: bigint;
}

export function buildSaleCall(action: SaleAction): SaleCall {
  switch (action.kind) {
    case "contribute":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "contribute" }),
        value: action.valueWei,
      };
    case "distribute":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "distribute", args: [action.count] }),
        value: 0n,
      };
    case "withdrawUnsoldTokens":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "withdrawUnsoldTokens", args: [action.to] }),
        value: 0n,
      };
    case "setFeeAddress1":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "setFeeAddress1", args: [action.feeAddress] }),
        value: 0n,
      };
    case "setFeeAddress2":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "setFeeAddress2", args: [action.feeAddress] }),
        value: 0n,
      };
    case "setFeeAddress3":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "setFeeAddress3", args: [action.feeAddress] }),
        value: 0n,
      };
    case "setContributionLimits":
      return {
        data: encodeFunctionData({
          abi: tokenSaleAbi,
          functionName: "setContributionLimits",
          args: [action.minInitialContribution, action.contributionStep],
        }),
        value: 0n,
      };
    case "setFeeEnabled":
      return {
        data: encodeFunctionData({
          abi: tokenSaleAbi,
          functionName: "setFeeEnabled",
          args: [action.feeAddressId, action.enabled],
        }),
        value: 0n,
      };
    case "setReferralPotRecipient":
      return {
        data: encodeFunctionData({
          abi: tokenSaleAbi,
          functionName: "setReferralPotRecipient",
          args: [action.recipient],
        }),
        value: 0n,
      };
    case "burnUnclaimed":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "burnUnclaimed" }),
        value: 0n,
      };
    case "sweepStray":
      return {
        data: encodeFunctionData({ abi: tokenSaleAbi, functionName: "sweepStray", args: [action.to] }),
        value: 0n,
      };
    case "recoverERC20":
      return {
        data: encodeFunctionData({
          abi: tokenSaleAbi,
          functionName: "recoverERC20",
          args: [action.erc20, action.to, action.amount],
        }),
        value: 0n,
      };
    default:
      // The no-argument calls. Listed by name rather than by a cast so a typo
      // is a compile error instead of a runtime "function does not exist".
      return { data: encodeFunctionData({ abi: tokenSaleAbi, functionName: action.kind }), value: 0n };
  }
}

/* ------------------------------------------------------------------ */
/*  UI metadata                                                        */
/* ------------------------------------------------------------------ */

export type SaleActionGroup = "contributor" | "lifecycle" | "treasury" | "recovery";

export interface SaleActionMeta {
  label: string;
  group: SaleActionGroup;
  ownerOnly: boolean;
  /**
   * Sale states the CONTRACT permits this call from, or null when the call is
   * state-independent. Advisory only — it drives which buttons look available;
   * the contract is still the enforcer and the preflight still simulates.
   * Pinned against the real EVM by the anvil replay, so it cannot quietly drift
   * from what the contract actually allows.
   */
  states: readonly number[] | null;
  /** Irreversible or fund-moving. The UI must make the operator type/confirm. */
  danger?: string;
  /** One line under the control saying what it does, in plain words. */
  hint?: string;
}

const S = SALE_STATE;

export const SALE_ACTIONS: Record<SaleActionKind, SaleActionMeta> = {
  contribute: {
    label: "Contribute",
    group: "contributor",
    ownerOnly: false,
    states: [S.ACTIVE],
    hint: "Buys a pro-rata share of the pool. Priced at the close, not now.",
  },
  claim: {
    label: "Claim tokens",
    group: "contributor",
    ownerOnly: false,
    states: [S.CLOSED],
    hint: "Pulls this wallet's whole allocation. Once only.",
  },
  claimRefund: {
    label: "Claim refund",
    group: "contributor",
    ownerOnly: false,
    states: [S.ABANDONED],
    hint: "Returns this wallet's exact contribution.",
  },
  claimStray: {
    label: "Claim stray ETH",
    group: "contributor",
    ownerOnly: false,
    states: null,
    hint: "Pulls back ETH sent directly to the contract. Available until the owner sweeps.",
  },

  start: {
    label: "Start sale",
    group: "lifecycle",
    ownerOnly: true,
    states: [S.PENDING],
    hint: "Opens contributions. The contract must already hold exactly the sale pool.",
  },
  pause: {
    label: "Pause",
    group: "lifecycle",
    ownerOnly: true,
    states: [S.ACTIVE],
    hint: "Stops new contributions. Nothing already committed moves.",
  },
  resume: {
    label: "Resume",
    group: "lifecycle",
    ownerOnly: true,
    states: [S.PAUSED],
    hint: "Reopens contributions.",
  },
  close: {
    label: "Close sale",
    group: "lifecycle",
    ownerOnly: true,
    states: [S.ACTIVE, S.PAUSED],
    danger: "Closing is permanent. Contributions stop, the price is fixed at raised ÷ pool, and claiming opens.",
    hint: "Ends the sale and opens claiming.",
  },
  abandon: {
    label: "Abandon sale",
    group: "lifecycle",
    ownerOnly: true,
    states: [S.PENDING, S.ACTIVE, S.PAUSED],
    danger: "Abandoning is permanent and cannot be undone. Every contributor gets their ETH back and this sale can never open again.",
    hint: "Cancels the sale and opens refunds.",
  },
  setFeeAddress1: {
    label: "Set fee address 1 (team/admin)",
    group: "lifecycle",
    ownerOnly: true,
    states: null,
    hint: "Editable until the proceeds are withdrawn, in any state. After that the split is settled.",
  },
  setFeeAddress2: {
    label: "Set fee address 2 (partner 1)",
    group: "lifecycle",
    ownerOnly: true,
    states: null,
    hint: "Editable until the proceeds are withdrawn, in any state. After that the split is settled.",
  },
  setFeeAddress3: {
    label: "Set fee address 3 (partner 2)",
    group: "lifecycle",
    ownerOnly: true,
    states: null,
    hint: "Editable until the proceeds are withdrawn, in any state. After that the split is settled.",
  },
  setContributionLimits: {
    label: "Set contribution limits",
    group: "lifecycle",
    ownerOnly: true,
    states: [S.PENDING, S.ACTIVE, S.PAUSED],
    hint: "Updates minimum first contribution and contribution step increment.",
  },

  distribute: {
    label: "Distribute",
    group: "treasury",
    ownerOnly: true,
    states: [S.CLOSED],
    hint: "Pushes tokens to the next batch of contributors. Skips anyone who already claimed.",
  },
  withdrawProceeds: {
    label: "Withdraw proceeds",
    group: "treasury",
    ownerOnly: true,
    states: [S.CLOSED],
    danger: "Pays out the entire raise, split between the referral pot, deployer/LP and fee recipients. It can only ever run once.",
    hint: "Takes the 4% referral scoop off the top, then splits the rest 80/8/8/4 between deployer and the three fee addresses.",
  },
  withdrawUnsoldTokens: {
    label: "Withdraw unsold tokens",
    group: "treasury",
    ownerOnly: true,
    states: [S.CLOSED, S.ABANDONED],
    danger: "Moves the contract's entire sale-token balance to the address you name.",
    hint: "Only from an abandoned sale, or a closed one that raised nothing.",
  },
  sweepStray: {
    label: "Sweep stray ETH",
    group: "treasury",
    ownerOnly: true,
    states: [S.CLOSED, S.ABANDONED],
    danger: "Takes all unclaimed stray ETH. After the first sweep, senders can no longer pull theirs back.",
    hint: "Repeatable, so ETH that turns up later can still be collected. The first run permanently closes claims by senders.",
  },
  setFeeEnabled: {
    label: "Turn a fee leg on or off",
    group: "lifecycle",
    ownerOnly: true,
    states: null,
    hint: "A disabled leg is paid nothing and falls to the owner. Allowed in any state until the proceeds are withdrawn.",
  },
  setReferralPotRecipient: {
    label: "Set the referral pot address",
    group: "treasury",
    ownerOnly: true,
    states: null,
    hint: "Where the 4% referral scoop is sent. Leave it unset and it goes to the owner, which is a valid configuration.",
  },
  burnUnclaimed: {
    label: "Burn unclaimed sale tokens",
    group: "treasury",
    ownerOnly: true,
    states: [S.CLOSED],
    danger: "Permanently destroys every sale token still held by the contract. Distribute first.",
    hint: "Opens 60 days after the close. A real burn: total supply falls.",
  },
  recoverERC20: {
    label: "Recover a stray token",
    group: "recovery",
    ownerOnly: true,
    states: null,
    danger: "Moves the amount you name to the address you name.",
    hint: "For an unrelated ERC-20 sent here by mistake. The sale token is refused.",
  },
};

/** Does the contract permit this action from `state`? `undefined` state is
 *  unknown, and unknown never disables — the contract remains the enforcer. */
export function actionAllowedInState(kind: SaleActionKind, state: number | undefined): boolean {
  const states = SALE_ACTIONS[kind].states;
  if (states === null) return true;
  if (state === undefined) return true;
  return states.includes(state);
}
