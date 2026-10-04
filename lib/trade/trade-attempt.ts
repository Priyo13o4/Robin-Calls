/**
 * Trade attempt validation, lifecycle tracking, and confirmation classification helpers.
 *
 * Implements audit A04/A05 invariants:
 * - Pure functions binding trade attempts to account, chain 4663, pair, amount, and slippage.
 * - Plan freshness (expiresAt) and plan-request identity verification.
 * - Repeated approval detection and attempt bounding.
 * - Receipt outcome classification covering success, revert, replacement, and cancellation.
 */

export interface TradeAttemptTarget {
  attemptId: number;
  account: string;
  chainId: number;
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
  slippage: number | "auto";
  tokenAddressProp?: string;
}

export interface TradeAttemptCurrent {
  attemptId: number;
  account: string | null;
  chainId: number | null;
  isConnected: boolean;
  tokenInAddress: string;
  tokenOutAddress: string;
  amount: string;
  slippage: number | "auto";
  tokenAddressProp?: string;
}

export interface AttemptValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies that the current state matches the target attempt state across all bound parameters.
 * Any mismatch (changed account, changed chain, disconnect, changed tokens, changed amount, changed slippage)
 * invalidates the attempt before any subsequent wallet action is dispatched.
 */
export function isAttemptValid(
  target: TradeAttemptTarget,
  current: TradeAttemptCurrent
): AttemptValidationResult {
  if (current.attemptId !== target.attemptId) {
    return { valid: false, reason: "Attempt ID changed" };
  }

  if (!current.isConnected) {
    return { valid: false, reason: "Wallet disconnected" };
  }

  if (!current.account) {
    return { valid: false, reason: "No wallet account connected" };
  }

  if (current.account.toLowerCase() !== target.account.toLowerCase()) {
    return { valid: false, reason: "Wallet account changed" };
  }

  if (current.chainId !== target.chainId || current.chainId !== 4663) {
    return { valid: false, reason: "Chain ID mismatch or not Robinhood Chain 4663" };
  }

  if (current.tokenInAddress.toLowerCase() !== target.tokenInAddress.toLowerCase()) {
    return { valid: false, reason: "Pay token changed" };
  }

  if (current.tokenOutAddress.toLowerCase() !== target.tokenOutAddress.toLowerCase()) {
    return { valid: false, reason: "Receive token changed" };
  }

  if (current.amount !== target.amount) {
    return { valid: false, reason: "Amount changed" };
  }

  if (current.slippage !== target.slippage) {
    return { valid: false, reason: "Slippage changed" };
  }

  const currentProp = (current.tokenAddressProp ?? "").toLowerCase();
  const targetProp = (target.tokenAddressProp ?? "").toLowerCase();
  if (currentProp !== targetProp) {
    return { valid: false, reason: "Target tokenAddress prop changed" };
  }

  return { valid: true };
}

/** A read-only preview can use the zero-address quote account before wallet connection. */
export function isQuoteAttemptCurrent(target: TradeAttemptTarget, current: TradeAttemptCurrent): AttemptValidationResult {
  const zeroAddress = "0x0000000000000000000000000000000000000000";
  if (target.account.toLowerCase() === zeroAddress && !current.isConnected && !current.account) {
    return isAttemptValid(target, { ...current, account: zeroAddress, chainId: 4663, isConnected: true });
  }
  return isAttemptValid(target, current);
}

export function isPlanExpired(
  plan?: { expiresAt?: number } | null,
  nowMs: number = Date.now()
): boolean {
  if (
    !plan ||
    typeof plan !== "object" ||
    typeof plan.expiresAt !== "number" ||
    !Number.isFinite(plan.expiresAt) ||
    plan.expiresAt <= 0
  ) {
    return true;
  }
  return nowMs >= plan.expiresAt;
}

/**
 * Checks whether an in-flight transaction broadcast exists to prevent duplicate execution.
 */
export function isPendingBroadcastActive(
  pending: { hash?: string; kind?: string } | null | undefined
): boolean {
  return Boolean(pending && pending.hash);
}


export interface PlanMatchParams {
  plan: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  };
  request: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  };
}

/**
 * Validates that the returned plan corresponds to the requested token pair and amount.
 */
export function doesPlanMatchRequest({ plan, request }: PlanMatchParams): boolean {
  return (
    plan.tokenIn.toLowerCase() === request.tokenIn.toLowerCase() &&
    plan.tokenOut.toLowerCase() === request.tokenOut.toLowerCase() &&
    plan.amountIn === request.amountIn
  );
}

/**
 * Formats a canonical key for tracking token approval targets.
 * Supports optional amount so zero-reset approvals (e.g. approve(0) then approve(target))
 * are not falsely flagged as repeated loops.
 */
export function makeApprovalKey(token: string, spender: string, amount?: string): string {
  const base = `${token.toLowerCase()}:${spender.toLowerCase()}`;
  return amount !== undefined ? `${base}:${amount}` : base;
}

/**
 * Detects whether an approval has already been executed for this token/spender/amount in the current attempt.
 */
export function isApprovalRepeated(
  token: string,
  spender: string,
  approvedKeys: ReadonlySet<string>,
  amount?: string
): boolean {
  return approvedKeys.has(makeApprovalKey(token, spender, amount));
}

export type ReceiptOutcome =
  | { status: "success"; hash: `0x${string}` }
  | { status: "reverted"; reason: string }
  | { status: "cancelled"; reason: string };

export interface ReceiptClassificationInput {
  receipt: { status: "success" | "reverted" | string; transactionHash?: `0x${string}` };
  replacement?: {
    reason: "cancelled" | "replaced" | "repriced" | string;
    transactionReceipt: { status: "success" | "reverted" | string };
    transaction?: { hash: `0x${string}` };
  } | null;
  originalHash: `0x${string}`;
}

/**
 * Classifies the outcome of a transaction receipt, taking into account viem replacement events.
 * A reverted receipt or cancelled replacement must NEVER produce a success status.
 */
export function classifyReceiptOutcome(
  input: ReceiptClassificationInput
): ReceiptOutcome {
  if (input.replacement) {
    if (input.replacement.reason === "cancelled") {
      return { status: "cancelled", reason: "Transaction was cancelled in wallet" };
    }
    if (input.replacement.transactionReceipt.status !== "success") {
      return { status: "reverted", reason: "Replacement transaction reverted on chain" };
    }
    const finalHash = input.replacement.transaction?.hash ?? input.originalHash;
    return { status: "success", hash: finalHash };
  }

  if (input.receipt.status !== "success") {
    return { status: "reverted", reason: "Transaction reverted on chain" };
  }

  const finalHash = (input.receipt.transactionHash as `0x${string}`) ?? input.originalHash;
  return { status: "success", hash: finalHash };
}

/**
 * Resolves the transaction hash to retain when waitForTransactionReceipt times out or errors.
 * If a replacement transaction occurred, its replacement hash is retained rather than reverting
 * to the superseded original hash.
 */
export function resolvePendingHashOnTimeout(
  originalHash: `0x${string}`,
  replacementHash?: `0x${string}` | null
): `0x${string}` {
  return replacementHash ?? originalHash;
}
