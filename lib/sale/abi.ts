/**
 * The ITokenSale surface the app calls. Source of truth is
 * contracts/src/token-sale/ITokenSale.sol; every entry here is diffed against
 * the COMPILED artifact by tests/sale-abi-and-quote.test.ts, so never guess a
 * shape — regenerate the fixture instead.
 *
 * Functions and errors are separate exports because the wiring test holds them
 * to different rules, and because `encodeFunctionData` wants functions while
 * revert decoding wants errors. `tokenSaleFullAbi` is the union, and it is what
 * any simulate/decode path must use: an ABI with no error entries cannot name
 * the revert it just caught, and prints four bytes of hex at an operator
 * instead of a sentence.
 */
export const tokenSaleAbi = [
  // ---- views ----
  { type: "function", name: "state", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "tokensForSale", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "totalRaised", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "contributorCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  /** The census array getter. The contribution mirror reads it index-by-index
   *  (lib/referrals/census.ts) — the reconciler's whole replacement for the
   *  log walker rests on it, so it is exposed like any other view. */
  { type: "function", name: "contributors", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "contributed", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "refunded", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "allocationOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  // The 2026-09-11 rework. The deferred-fee reads it replaced (feeAddressNOwed,
  // FEE_RECLAIM_DELAY, claimFeeShare, reclaimFeeShare) are gone from the contract, so
  // they are gone from here: an ABI entry for a function that no longer exists reverts
  // the whole multicall and takes every sibling read down with it.
  { type: "function", name: "feeDisabled", stateMutability: "view", inputs: [{ name: "feeAddressId", type: "uint8" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "referralBps", stateMutability: "pure", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "referralPotRecipient", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "closedAt", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "unclaimedBurned", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "BURN_DELAY", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "setFeeEnabled", stateMutability: "nonpayable", inputs: [{ name: "feeAddressId", type: "uint8" }, { name: "enabled", type: "bool" }], outputs: [] },
  { type: "function", name: "setReferralPotRecipient", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [] },
  { type: "function", name: "burnUnclaimed", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "strayOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeAddress1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeAddress2", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeAddress3", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "feeAddress1Bps", stateMutability: "pure", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "feeAddress2Bps", stateMutability: "pure", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "feeAddress3Bps", stateMutability: "pure", inputs: [], outputs: [{ name: "", type: "uint16" }] },
  { type: "function", name: "proceedsWithdrawn", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "minInitialContribution", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "contributionStep", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "censusSlice", stateMutability: "view", inputs: [{ name: "offset", type: "uint256" }, { name: "count", type: "uint256" }], outputs: [{ name: "wallets", type: "address[]" }, { name: "amounts", type: "uint256[]" }] },
  { type: "function", name: "distributionCursor", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "distributionComplete", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "totalStray", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "straySwept", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bool" }] },
  /** Ownable2Step. Read-only here: a rotation in flight is a fact the operator
   *  must SEE, even though the panel deliberately does not drive one. */
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  // ---- contributor actions ----
  { type: "function", name: "contribute", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimRefund", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimStray", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // ---- owner lifecycle / treasury ----
  { type: "function", name: "start", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "resume", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "close", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "abandon", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "distribute", stateMutability: "nonpayable", inputs: [{ name: "count", type: "uint256" }], outputs: [{ name: "processed", type: "uint256" }] },
  { type: "function", name: "withdrawProceeds", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "withdrawUnsoldTokens", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "setContributionLimits", stateMutability: "nonpayable", inputs: [{ name: "minInitialContribution_", type: "uint256" }, { name: "contributionStep_", type: "uint256" }], outputs: [] },
  { type: "function", name: "setFeeAddress1", stateMutability: "nonpayable", inputs: [{ name: "feeAddress1_", type: "address" }], outputs: [] },
  { type: "function", name: "setFeeAddress2", stateMutability: "nonpayable", inputs: [{ name: "feeAddress2_", type: "address" }], outputs: [] },
  { type: "function", name: "setFeeAddress3", stateMutability: "nonpayable", inputs: [{ name: "feeAddress3_", type: "address" }], outputs: [] },
  { type: "function", name: "sweepStray", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }], outputs: [] },
  { type: "function", name: "recoverERC20", stateMutability: "nonpayable", inputs: [{ name: "erc20", type: "address" }, { name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
] as const;

/**
 * Every custom error the deployed contract can revert with, INCLUDING the ones
 * inherited from OpenZeppelin — `OwnableUnauthorizedAccount` is what an
 * operator sees when they click an owner button from the wrong wallet, and it
 * is not declared in ITokenSale.sol. The list is pinned against the compiled
 * artifact by the wiring test, so a new contract error cannot ship without
 * either a sentence in lib/sale/errors.ts or an explicit note there.
 */
export const tokenSaleErrorsAbi = [
  { type: "error", name: "AlreadyBurned", inputs: [] },
  { type: "error", name: "AlreadyClaimed", inputs: [] },
  { type: "error", name: "AlreadyRefunded", inputs: [] },
  { type: "error", name: "BelowMinimumContribution", inputs: [{ name: "sent", type: "uint256" }, { name: "minimum", type: "uint256" }] },
  { type: "error", name: "BurnTooEarly", inputs: [{ name: "availableAt", type: "uint256" }] },
  { type: "error", name: "CannotRecoverSaleToken", inputs: [] },
  { type: "error", name: "EthTransferFailed", inputs: [] },
  { type: "error", name: "FeeAddressRequired", inputs: [] },
  { type: "error", name: "InvalidContributionLimits", inputs: [{ name: "minContribution", type: "uint256" }, { name: "step", type: "uint256" }] },
  { type: "error", name: "InvalidFeeAddressId", inputs: [{ name: "feeAddressId", type: "uint8" }] },
  { type: "error", name: "NoStray", inputs: [] },
  { type: "error", name: "NothingToClaim", inputs: [] },
  { type: "error", name: "NothingToRefund", inputs: [] },
  { type: "error", name: "NothingToWithdraw", inputs: [] },
  { type: "error", name: "NotStepMultiple", inputs: [{ name: "sent", type: "uint256" }, { name: "step", type: "uint256" }] },
  { type: "error", name: "Overfunded", inputs: [{ name: "held", type: "uint256" }, { name: "required", type: "uint256" }] },
  { type: "error", name: "OwnableInvalidOwner", inputs: [{ name: "owner", type: "address" }] },
  { type: "error", name: "OwnableUnauthorizedAccount", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "ProceedsAlreadyWithdrawn", inputs: [] },
  { type: "error", name: "ReentrancyGuardReentrantCall", inputs: [] },
  { type: "error", name: "RenounceOwnershipDisabled", inputs: [] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
  { type: "error", name: "SaleTokensBurned", inputs: [] },
  { type: "error", name: "SaleWasNotEmpty", inputs: [] },
  { type: "error", name: "StrayAlreadySwept", inputs: [] },
  { type: "error", name: "Underfunded", inputs: [{ name: "held", type: "uint256" }, { name: "required", type: "uint256" }] },
  { type: "error", name: "WrongState", inputs: [{ name: "current", type: "uint8" }] },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroContribution", inputs: [] },
  { type: "error", name: "ZeroTokensForSale", inputs: [] },
] as const;

/**
 * The events the referral indexer reads (docs/prds/REFERRALS.md). Kept OUT of
 * `tokenSaleAbi` deliberately: that export is diffed name-by-name against
 * tests/fixtures/TokenSale.abi.json, which holds functions and errors only, so
 * an event listed there would fail as "declared but not on the contract".
 *
 * Pinned instead against the SOURCE by tests/referral-indexer.test.ts, which
 * reads the `event Contributed(...)` line straight out of ITokenSale.sol. A
 * wrong indexed-ness here does not throw — it silently matches no logs, and the
 * airdrop is then computed over an empty sale.
 */
export const tokenSaleEventsAbi = [
  {
    type: "event",
    name: "Contributed",
    inputs: [
      { name: "contributor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "totalRaised", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Functions + errors. Use this anywhere a revert may need naming. */
export const tokenSaleFullAbi = [...tokenSaleAbi, ...tokenSaleErrorsAbi] as const;

/** Index = SaleState enum value in TokenSale.sol. Reorder silently = wrong UI. */
export const SALE_STATE_LABELS = ["PENDING", "ACTIVE", "PAUSED", "CLOSED", "ABANDONED"] as const;

export const SALE_STATE = {
  PENDING: 0,
  ACTIVE: 1,
  PAUSED: 2,
  CLOSED: 3,
  ABANDONED: 4,
} as const;

/** ERC-20 metadata reads (viem's erc20Abi has balanceOf but no name/symbol). */
export const erc20MetaAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;
