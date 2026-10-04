import { decodeErrorResult, formatEther, type Address } from "viem";
import { SALE_STATE_LABELS, tokenSaleFullAbi } from "./abi";
import { describeTransportFailure, logFailure, type Failure } from "@/lib/wallet/failure";

/**
 * Turns a reverted sale call into a sentence an operator can act on.
 *
 * Two failure shapes are NOT the same and must never collapse into one
 * message (§4). A revert is the contract answering "no, and here is why"; a
 * transport fault is us failing to ask. `describeSaleRevert` returns null for
 * anything it could not decode as a contract revert, and the caller says
 * "couldn't reach the chain" rather than inventing a rejection.
 *
 * The dictionary below fails toward NAMING, never toward silence: an error with
 * no sentence still prints its own Solidity name and arguments, which is ugly
 * but true. That direction is deliberate — a missing entry degrades to a worse
 * sentence, never to a wrong one.
 */

const eth = (v: unknown) => (typeof v === "bigint" ? `${formatEther(v)} ETH` : "an unknown amount");
const units = (v: unknown) => (typeof v === "bigint" ? v.toString() : "an unknown amount");
const addr = (v: unknown) => (typeof v === "string" ? v : "an unknown address");

/** Unix seconds are contract vocabulary; the reader gets a date. */
const whenSeconds = (v: unknown) =>
  typeof v === "bigint" || typeof v === "number"
    ? new Date(Number(v) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "a date the contract did not give";

const stateName = (v: unknown) =>
  typeof v === "number" || typeof v === "bigint"
    ? (SALE_STATE_LABELS[Number(v)] ?? `state ${v}`)
    : "an unknown state";

/**
 * One sentence per error. Written for the person clicking the button, not for
 * the person who wrote the contract — §10's rule that published prose says who
 * and what, never how the code got there.
 */
const SENTENCES: Record<string, (args: readonly unknown[]) => string> = {
  // ---- lifecycle ----
  WrongState: (a) =>
    `The sale is ${stateName(a[0])}, and this action is not allowed from there.`,
  // Raw uint256 token units are 25-digit integers with no decimals to scale
  // them by, so printing them tells the reader nothing. The exact pair is in
  // the console; the sentence carries the remedy instead.
  Underfunded: () =>
    "The contract does not hold enough tokens yet. Send it the exact sale amount, then start again.",
  Overfunded: () =>
    "The contract holds more tokens than the sale promises. The extra cannot be taken back out once the sale opens, so this contract has to be abandoned and redeployed.",
  ZeroTokensForSale: () => "The sale was deployed with a pool of zero tokens.",

  // ---- contributing ----
  ZeroContribution: () => "A contribution of zero does nothing.",
  NotStepMultiple: (a) =>
    `Contributions go in whole multiples of ${eth(a[1])}. ${eth(a[0])} is not one.`,
  BelowMinimumContribution: (a) =>
    `A first contribution has to be at least ${eth(a[1])}, and ${eth(a[0])} is under that. Later top-ups have no minimum.`,
  // Four rules share this revert, so the sentence names all four. Naming only
  // the multiple sends an operator who typed a 2 ETH step hunting the wrong
  // field (§10: rewrite the wording, never the claim).
  InvalidContributionLimits: (a) =>
    `Those limits were refused. The step has to be above zero and no more than 1 ETH, and the minimum first contribution has to be a whole multiple of the step, at least as large as it, and no more than 100 ETH. You sent a minimum of ${eth(a[0])} and a step of ${eth(a[1])}.`,

  // ---- claiming ----
  AlreadyClaimed: () => "This wallet has already claimed its tokens.",
  NothingToClaim: () => "This wallet has no allocation to claim.",
  AlreadyRefunded: () => "This wallet has already taken its refund.",
  NothingToRefund: () => "This wallet contributed nothing, so there is nothing to refund.",

  // ---- treasury ----
  NothingToWithdraw: () => "There is nothing here to withdraw.",
  ProceedsAlreadyWithdrawn: () => "The raise has already been paid out. It only pays out once.",
  SaleWasNotEmpty: () =>
    "This sale raised ETH, so the tokens belong to its contributors and cannot be withdrawn.",
  CannotRecoverSaleToken: () =>
    "The sale token cannot be recovered this way. It is spoken for by the contributors' allocations.",
  EthTransferFailed: () => "The recipient refused the ETH, so nothing was sent.",

  // ---- fee addresses ----
  FeeAddressRequired: () => "Each fee address must be non-zero.",
  InvalidFeeAddressId: (a) => `There is no fee address ${a[0]}. It has to be 1, 2, or 3.`,

  // ---- burning what nobody claimed ----
  BurnTooEarly: (a) =>
    `The unclaimed tokens cannot be burned yet. The window opens on ${whenSeconds(a[0])}.`,
  AlreadyBurned: () => "The unclaimed tokens have already been burned. That only happens once.",
  SaleTokensBurned: () =>
    "The tokens left in this sale were burned, so there is nothing here to hand out. Claiming closed when the burn ran.",

  // ---- stray ETH ----
  NoStray: () => "There is no stray ETH here to claim.",
  StrayAlreadySwept: () =>
    "The stray pot was swept, so individual balances are closed. Anything sent since then can only be collected by the owner.",

  // ---- inherited from OpenZeppelin ----
  OwnableUnauthorizedAccount: () =>
    "The connected wallet is not the sale's owner, so it cannot run owner actions. Connect the owner wallet.",
  OwnableInvalidOwner: (a) => `${addr(a[0])} cannot be made the owner.`,
  RenounceOwnershipDisabled: () =>
    "Renouncing ownership is disabled on this contract. Ownership must be transferred to another address instead.",
  ReentrancyGuardReentrantCall: () => "The contract rejected the call because it tried to re-enter mid-transaction.",
  SafeERC20FailedOperation: (a) => `The token at ${addr(a[0])} rejected the transfer.`,
  ZeroAddress: () => "That is the zero address, which this call will not accept.",
};

/** Names the dictionary deliberately has no sentence for. Empty, and the test
 *  keeps it that way — an entry here is a decision, not an oversight. */
export const SALE_ERRORS_WITHOUT_SENTENCE: Record<string, string> = {};

export interface SaleRevert {
  /** The Solidity error name, e.g. "Overfunded". */
  name: string;
  /** Decoded arguments, in declaration order. */
  args: readonly unknown[];
  /** The sentence to show. Always populated — falls back to name + args. */
  sentence: string;
}

/**
 * Fallback for a decoded error with no sentence. Keeps the error NAME, which is
 * short and means something ("Overfunded"), and drops the decoded arguments,
 * which are raw uint256s and addresses. Still fails toward naming rather than
 * silence: a missing entry degrades to a plainer sentence, never a wrong one.
 */
function rawSentence(name: string, args: readonly unknown[]): string {
  void args; // in the console with the error, never on screen
  return `The sale contract refused this action, reporting ${name}. There is no plain description for that case yet.`;
}

export function sentenceFor(name: string, args: readonly unknown[]): string {
  const f = SENTENCES[name];
  if (!f) return rawSentence(name, args);
  try {
    return f(args);
  } catch {
    // A malformed argument list must not throw inside error handling — that
    // replaces a legible rejection with a blank screen.
    return rawSentence(name, args);
  }
}

/**
 * Pulls revert data out of a viem error and decodes it against the sale ABI.
 *
 * Walks `.cause` rather than reading one level: viem nests the raw revert
 * several classes deep (CallExecutionError → RawContractError), and the depth
 * differs between `call`, `simulateContract` and `estimateGas`. A single-level
 * read silently stops matching whenever that nesting changes.
 *
 * Returns null when nothing decodable was found — that is "we could not tell",
 * and the caller must NOT render it as a rejection.
 */
export function describeSaleRevert(err: unknown): SaleRevert | null {
  for (const data of revertDataCandidates(err)) {
    try {
      const decoded = decodeErrorResult({ abi: tokenSaleFullAbi, data });
      const args = (decoded.args ?? []) as readonly unknown[];
      return { name: decoded.errorName, args, sentence: sentenceFor(decoded.errorName, args) };
    } catch {
      // Not one of ours (or not decodable against this ABI) — keep walking the
      // chain; a later candidate may be the real revert payload.
    }
  }
  // viem sometimes hands back an already-decoded ContractFunctionRevertedError
  // instead of raw bytes, so the name/args path is checked as well.
  const named = namedRevert(err);
  if (named) return { ...named, sentence: sentenceFor(named.name, named.args) };
  return null;
}

/** Every `0x…` payload hanging off the cause chain, outermost first. */
function* revertDataCandidates(err: unknown): Generator<`0x${string}`> {
  let cur: unknown = err;
  for (let i = 0; i < 12 && cur; i++) {
    if (typeof cur !== "object" || cur === null) return;
    const o = cur as { data?: unknown; cause?: unknown };
    const d = o.data;
    if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) {
      yield d as `0x${string}`;
    } else if (d && typeof d === "object") {
      const inner = (d as { data?: unknown }).data;
      if (typeof inner === "string" && inner.startsWith("0x") && inner.length >= 10) {
        yield inner as `0x${string}`;
      }
    }
    cur = o.cause;
  }
}

function namedRevert(err: unknown): { name: string; args: readonly unknown[] } | null {
  let cur: unknown = err;
  for (let i = 0; i < 12 && cur; i++) {
    if (typeof cur !== "object" || cur === null) return null;
    const o = cur as { data?: unknown; cause?: unknown };
    const d = o.data as { errorName?: unknown; args?: unknown } | undefined;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      return { name: d.errorName, args: (Array.isArray(d.args) ? d.args : []) as readonly unknown[] };
    }
    cur = o.cause;
  }
  return null;
}

/**
 * The one sentence a caller shows after a failed action. A decoded revert wins;
 * a user rejection is named as itself; anything else is reported as a failure
 * to REACH the chain, never as a rejection by it.
 */
export function explainSaleFailure(err: unknown): Failure {
  logFailure("sale", err);
  const revert = describeSaleRevert(err);
  // A decoded revert HERE came from the wallet or the node refusing before the
  // send; a revert that actually landed arrives as a receipt with status
  // "reverted", which the caller handles separately and pins. So this branch is
  // closed: nothing was broadcast.
  if (revert) return { sentence: revert.sentence, settled: true };
  // NOT viem's shortMessage: it carries URLs, provider versions and hex, none
  // of which a reader can act on. describeTransportFailure classifies instead.
  return describeTransportFailure(
    err,
    "The action did not go through, and the chain did not say why.",
  );
}

export const _saleErrorInternals = { SENTENCES, rawSentence };

export type SaleErrorName = keyof typeof SENTENCES;

export const SALE_ERROR_NAMES: readonly string[] = Object.keys(SENTENCES);

export type { Address };
