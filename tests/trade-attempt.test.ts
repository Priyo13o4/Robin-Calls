import test from "node:test";
import assert from "node:assert/strict";
import {
  isAttemptValid,
  isQuoteAttemptCurrent,
  isPlanExpired,
  doesPlanMatchRequest,
  makeApprovalKey,
  isApprovalRepeated,
  classifyReceiptOutcome,
  resolvePendingHashOnTimeout,
  isPendingBroadcastActive,
  type TradeAttemptTarget,
  type TradeAttemptCurrent,
} from "../lib/trade/trade-attempt";

const ACCOUNT_A = "0x1111111111111111111111111111111111111111";
const ACCOUNT_B = "0x2222222222222222222222222222222222222222";
const TOKEN_IN = "0x0000000000000000000000000000000000000000"; // NATIVE
const TOKEN_OUT = "0x3333333333333333333333333333333333333333";
const SPENDER = "0x4444444444444444444444444444444444444444";
const HASH_1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
const HASH_2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;

const baseTarget: TradeAttemptTarget = {
  attemptId: 1,
  account: ACCOUNT_A,
  chainId: 4663,
  tokenInAddress: TOKEN_IN,
  tokenOutAddress: TOKEN_OUT,
  amount: "1.5",
  slippage: 0.5,
  tokenAddressProp: TOKEN_OUT,
};

const baseCurrent: TradeAttemptCurrent = {
  attemptId: 1,
  account: ACCOUNT_A,
  chainId: 4663,
  isConnected: true,
  tokenInAddress: TOKEN_IN,
  tokenOutAddress: TOKEN_OUT,
  amount: "1.5",
  slippage: 0.5,
  tokenAddressProp: TOKEN_OUT,
};

test("read-only quote preview accepts a disconnected wallet but still rejects stale inputs", () => {
  const target = { ...baseTarget, account: TOKEN_IN };
  const current = { ...baseCurrent, account: null, chainId: null, isConnected: false };
  assert.equal(isQuoteAttemptCurrent(target, current).valid, true);
  assert.equal(isAttemptValid(target, current).valid, false);
  assert.equal(isQuoteAttemptCurrent(target, { ...current, amount: "2" }).valid, false);
  assert.equal(isQuoteAttemptCurrent(target, { ...current, account: ACCOUNT_A, isConnected: true, chainId: 4663 }).valid, false);
});

test("isAttemptValid: returns valid when all state bindings match", () => {
  const result = isAttemptValid(baseTarget, baseCurrent);
  assert.equal(result.valid, true);
});

test("isAttemptValid: invalidates when attemptId increments", () => {
  const result = isAttemptValid(baseTarget, { ...baseCurrent, attemptId: 2 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Attempt ID changed");
});

test("isAttemptValid: invalidates when wallet disconnects", () => {
  const res1 = isAttemptValid(baseTarget, { ...baseCurrent, isConnected: false });
  assert.equal(res1.valid, false);
  assert.equal(res1.reason, "Wallet disconnected");

  const res2 = isAttemptValid(baseTarget, { ...baseCurrent, account: null });
  assert.equal(res2.valid, false);
  assert.equal(res2.reason, "No wallet account connected");
});

test("isAttemptValid: invalidates when wallet account changes", () => {
  const result = isAttemptValid(baseTarget, { ...baseCurrent, account: ACCOUNT_B });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Wallet account changed");
});

test("isAttemptValid: case-insensitive account comparison", () => {
  const result = isAttemptValid(baseTarget, {
    ...baseCurrent,
    account: ACCOUNT_A.toUpperCase(),
  });
  assert.equal(result.valid, true);
});

test("isAttemptValid: invalidates when chainId changes or is not 4663", () => {
  const res1 = isAttemptValid(baseTarget, { ...baseCurrent, chainId: 1 });
  assert.equal(res1.valid, false);

  const res2 = isAttemptValid({ ...baseTarget, chainId: 1 }, { ...baseCurrent, chainId: 1 });
  assert.equal(res2.valid, false);
});

test("isAttemptValid: invalidates when tokenIn or tokenOut changes", () => {
  const resIn = isAttemptValid(baseTarget, {
    ...baseCurrent,
    tokenInAddress: "0x5555555555555555555555555555555555555555",
  });
  assert.equal(resIn.valid, false);
  assert.equal(resIn.reason, "Pay token changed");

  const resOut = isAttemptValid(baseTarget, {
    ...baseCurrent,
    tokenOutAddress: "0x6666666666666666666666666666666666666666",
  });
  assert.equal(resOut.valid, false);
  assert.equal(resOut.reason, "Receive token changed");
});

test("isAttemptValid: invalidates when amount or slippage changes", () => {
  const resAmt = isAttemptValid(baseTarget, { ...baseCurrent, amount: "2.0" });
  assert.equal(resAmt.valid, false);
  assert.equal(resAmt.reason, "Amount changed");

  const resSlip = isAttemptValid(baseTarget, { ...baseCurrent, slippage: "auto" });
  assert.equal(resSlip.valid, false);
  assert.equal(resSlip.reason, "Slippage changed");
});

test("isAttemptValid: invalidates when target tokenAddress prop changes", () => {
  const result = isAttemptValid(baseTarget, {
    ...baseCurrent,
    tokenAddressProp: "0x7777777777777777777777777777777777777777",
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Target tokenAddress prop changed");
});

test("isPlanExpired: correctly detects quote freshness and expiration, failing closed on missing/malformed", () => {
  const now = 1_700_000_000_000;
  assert.equal(isPlanExpired({ expiresAt: now + 5000 }, now), false);
  assert.equal(isPlanExpired({ expiresAt: now }, now), true);
  assert.equal(isPlanExpired({ expiresAt: now - 1000 }, now), true);
  // Missing, null, undefined, or malformed must fail closed (return true)
  assert.equal(isPlanExpired({}, now), true);
  assert.equal(isPlanExpired(null, now), true);
  assert.equal(isPlanExpired(undefined, now), true);
  assert.equal(isPlanExpired({ expiresAt: NaN }, now), true);
  assert.equal(isPlanExpired({ expiresAt: 0 }, now), true);
  assert.equal(isPlanExpired({ expiresAt: -500 }, now), true);
  assert.equal(isPlanExpired({ expiresAt: Infinity }, now), true);
  assert.equal(isPlanExpired({ expiresAt: -Infinity }, now), true);
  assert.equal(isPlanExpired({ expiresAt: "1700000000000" as unknown as number }, now), true);
});

test("isPendingBroadcastActive: accurately identifies active in-flight broadcasts to block duplicates", () => {
  assert.equal(isPendingBroadcastActive(null), false);
  assert.equal(isPendingBroadcastActive(undefined), false);
  assert.equal(isPendingBroadcastActive({ hash: "" }), false);
  assert.equal(isPendingBroadcastActive({ hash: HASH_1, kind: "swap" }), true);
  assert.equal(isPendingBroadcastActive({ hash: HASH_2, kind: "approve" }), true);
});

test("doesPlanMatchRequest: checks tokenIn, tokenOut, and amountIn identity", () => {
  const req = {
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    amountIn: "1000000000000000000",
  };

  assert.equal(
    doesPlanMatchRequest({
      plan: { tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "1000000000000000000" },
      request: req,
    }),
    true
  );

  assert.equal(
    doesPlanMatchRequest({
      plan: { tokenIn: "0x9999999999999999999999999999999999999999", tokenOut: TOKEN_OUT, amountIn: "1000000000000000000" },
      request: req,
    }),
    false
  );

  assert.equal(
    doesPlanMatchRequest({
      plan: { tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: "2000000000000000000" },
      request: req,
    }),
    false
  );
});

test("isApprovalRepeated: tracks approval keys and detects repeated approval loops", () => {
  const approved = new Set<string>();
  const key = makeApprovalKey(TOKEN_OUT, SPENDER);

  assert.equal(isApprovalRepeated(TOKEN_OUT, SPENDER, approved), false);
  approved.add(key);
  assert.equal(isApprovalRepeated(TOKEN_OUT, SPENDER, approved), true);
  // Case-insensitive
  assert.equal(isApprovalRepeated(TOKEN_OUT.toUpperCase(), SPENDER.toLowerCase(), approved), true);
});

test("isApprovalRepeated: supports amount-aware approval keys for zero-reset sequences", () => {
  const approved = new Set<string>();
  const zeroKey = makeApprovalKey(TOKEN_OUT, SPENDER, "0");
  const targetKey = makeApprovalKey(TOKEN_OUT, SPENDER, "1000000");

  assert.notEqual(zeroKey, targetKey);
  // Step 1: approve(0)
  assert.equal(isApprovalRepeated(TOKEN_OUT, SPENDER, approved, "0"), false);
  approved.add(zeroKey);
  assert.equal(isApprovalRepeated(TOKEN_OUT, SPENDER, approved, "0"), true);

  // Step 2: approve(1000000) is NOT flagged as repeated despite same token/spender
  assert.equal(isApprovalRepeated(TOKEN_OUT, SPENDER, approved, "1000000"), false);
  approved.add(targetKey);
  assert.equal(isApprovalRepeated(TOKEN_OUT, SPENDER, approved, "1000000"), true);
});

test("classifyReceiptOutcome: standard success and reverted receipts", () => {
  const successOutcome = classifyReceiptOutcome({
    receipt: { status: "success", transactionHash: HASH_1 },
    originalHash: HASH_1,
  });
  assert.deepEqual(successOutcome, { status: "success", hash: HASH_1 });

  const revertedOutcome = classifyReceiptOutcome({
    receipt: { status: "reverted", transactionHash: HASH_1 },
    originalHash: HASH_1,
  });
  assert.equal(revertedOutcome.status, "reverted");
});

test("classifyReceiptOutcome: viem onReplaced replacement and cancellation", () => {
  // Cancelled in wallet
  const cancelledOutcome = classifyReceiptOutcome({
    receipt: { status: "success" },
    replacement: {
      reason: "cancelled",
      transactionReceipt: { status: "success" },
      transaction: { hash: HASH_2 },
    },
    originalHash: HASH_1,
  });
  assert.equal(cancelledOutcome.status, "cancelled");

  // Replaced but replacement reverted
  const revertedReplacement = classifyReceiptOutcome({
    receipt: { status: "success" },
    replacement: {
      reason: "replaced",
      transactionReceipt: { status: "reverted" },
      transaction: { hash: HASH_2 },
    },
    originalHash: HASH_1,
  });
  assert.equal(revertedReplacement.status, "reverted");

  // Repriced (speed-up) and succeeded with replacement hash
  const repricedSuccess = classifyReceiptOutcome({
    receipt: { status: "success" },
    replacement: {
      reason: "repriced",
      transactionReceipt: { status: "success" },
      transaction: { hash: HASH_2 },
    },
    originalHash: HASH_1,
  });
  assert.deepEqual(repricedSuccess, { status: "success", hash: HASH_2 });
});

test("resolvePendingHashOnTimeout: retains replacement hash when available, falls back to original", () => {
  // If replacement hash is available, retain it
  assert.equal(resolvePendingHashOnTimeout(HASH_1, HASH_2), HASH_2);

  // If no replacement occurred, retain original hash
  assert.equal(resolvePendingHashOnTimeout(HASH_1, null), HASH_1);
  assert.equal(resolvePendingHashOnTimeout(HASH_1, undefined), HASH_1);
});
