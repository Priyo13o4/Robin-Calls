import { encodeEventTopics, getAddress, type PublicClient } from "viem";

import { tokenSaleEventsAbi } from "@/lib/sale/abi";

/**
 * Verifying a browser-submitted transaction hash against the chain.
 *
 * The browser supplies a POINTER, never a claim. Everything that follows is
 * read here, independently: receipt, status, the Contributed log, the log's
 * contributor. Two rules with force beyond style:
 *
 *  - the contributor is read from the EVENT, never `tx.from`. The envelope
 *    is destroyed by relayers, batchers and smart wallets (§8 #19 — one
 *    relayer is recorded as the launcher of 7,670 tokens on this chain).
 *    `Contributed.contributor` is protocol state. This is also what blocks
 *    "paste someone else's hash".
 *
 *  - three outcomes, never two. `unknown` (a transient fault, a node that
 *    has not seen the tx yet, or an unparseable log shape) keeps the claim
 *    pending; only a definitive chain answer refuses it. Receipt fetch
 *    faults default to unknown, deliberately: a wrong unknown costs a
 *    retry, a wrong definitive is a false refusal.
 */

export interface VerifiedContribution {
  /** The log's contributor, lowercased. Never `tx.from`. */
  walletAddress: string;
  amountWei: bigint;
  /** The contract's running total at the moment of this log. */
  totalRaisedWei: bigint | null;
  blockNumber: number;
  /** The Contributed log's own index in its receipt. */
  logIndex: number;
}

export type ContributionVerification =
  | { kind: "verified"; contribution: VerifiedContribution }
  /** A definitive chain answer that this is not this wallet's contribution. */
  | { kind: "refused"; reason: string }
  /** Could not measure. The claim must stay pending — never written refused. */
  | { kind: "unknown" };

export interface RawLog {
  address: string;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  logIndex?: number | bigint | null;
}

/** The Contributed signature topic, computed once per process. */
export const CONTRIBUTED_TOPIC0: `0x${string}` = (
  encodeEventTopics({ abi: tokenSaleEventsAbi, eventName: "Contributed" }) as `0x${string}`[]
)[0];

export type MatchContributionResult =
  | {
      kind: "matched";
      logIndex: number;
      contributor: string;
      amountWei: bigint;
      totalRaisedWei: bigint | null;
    }
  | { kind: "unparseable" }
  | { kind: "not-found" };

/**
 * The Contributed log from this sale naming this wallet, out of a receipt's
 * log set.
 *
 * Exported for tests. Pure: it decides nothing, it only recognises.
 *
 * Hand-decoded rather than `decodeEventLog` so an unrecognised shape is a
 * miss, not a throw: an unparseable log shape yields `unparseable` (mapped to
 * `unknown` one layer up so the reconciler retries), whereas an absence of any
 * matching Contributed log yields `not-found` (§8 #16: a recognition failure
 * must not be laundered into a negative answer).
 */
export function matchContributionLog(args: {
  logs: readonly RawLog[];
  saleAddress: string;
  claimingWallet: string;
}): MatchContributionResult {
  const sale = args.saleAddress.toLowerCase();
  const claimant = args.claimingWallet.toLowerCase();
  let hasUnparseableSaleLog = false;

  for (let i = 0; i < args.logs.length; i++) {
    const log = args.logs[i];
    if (log.address.toLowerCase() !== sale) continue;
    if (log.topics[0] !== CONTRIBUTED_TOPIC0) continue;
    // contributor is the one indexed topic; amount and totalRaised are two
    // 32-byte words of data. Anything else is not a Contributed log we know
    // how to read.
    if (log.topics.length !== 2 || log.data.length !== 2 + 128) {
      hasUnparseableSaleLog = true;
      continue;
    }
    try {
      const contributor = getAddress(`0x${log.topics[1].slice(26)}`) as string;
      // THE gate: the event's contributor must be the claiming wallet.
      // Reading anything else (tx.from, receipt.from) would let any
      // relayer's client claim any contribution (§8 #19).
      if (contributor.toLowerCase() !== claimant) continue;
      const body = log.data.slice(2);
      return {
        kind: "matched",
        logIndex: Number(log.logIndex ?? i),
        contributor: contributor.toLowerCase(),
        amountWei: BigInt(`0x${body.slice(0, 64)}`),
        totalRaisedWei: BigInt(`0x${body.slice(64, 128)}`),
      };
    } catch {
      hasUnparseableSaleLog = true;
      continue;
    }
  }

  if (hasUnparseableSaleLog) {
    return { kind: "unparseable" };
  }
  return { kind: "not-found" };
}

/** viem's "the node answered, and has no such transaction" errors. Anything
 *  else (timeouts, 429s, unknown shapes) is NOT an absence. */
export function isTxNotFoundError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 8; depth++) {
    const name = (e as { name?: unknown }).name;
    if (name === "TransactionReceiptNotFoundError" || name === "TransactionNotFoundError") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * True only when a node that is demonstrably answering (it served the head)
 * says it has neither a receipt nor a transaction for this hash. Any read
 * fault returns false: an absence is only ever concluded from an answer (§4).
 */
export async function transactionAbsent(client: PublicClient, txHash: `0x${string}`): Promise<boolean> {
  try {
    await client.getBlockNumber();
  } catch {
    return false;
  }
  const absent = async (read: () => Promise<unknown>) => {
    try {
      await read();
      return false;
    } catch (error) {
      return isTxNotFoundError(error);
    }
  };
  return (
    (await absent(() => client.getTransactionReceipt({ hash: txHash }))) &&
    (await absent(() => client.getTransaction({ hash: txHash })))
  );
}

/**
 * The full check for one claim: receipt → status → log → contributor.
 *
 * Every refusal is a chain answer, not an inference. A receipt with status
 * !== success reverted; a successful receipt with no matching log is not a
 * contribution by this wallet to this sale — the log set of a mined receipt
 * cannot change, so both are safe to persist.
 *
 * Returns the block's own timestamp too, for the mirror row. A missing
 * timestamp does not unmake the contribution: eligibility compares block
 * numbers, never clocks, and the reconciler's pass fills timestamps later.
 */
export async function verifyContributionClaim(args: {
  client: PublicClient;
  txHash: `0x${string}`;
  saleAddress: string;
  claimingWallet: string;
}): Promise<{ outcome: ContributionVerification; blockTimestamp: string | null }> {
  let receipt;
  try {
    receipt = await args.client.getTransactionReceipt({ hash: args.txHash });
  } catch {
    // Includes "receipt not found": the browser saw the receipt seconds ago
    // and our node can lag it. Not a refusal — the claim retries.
    return { outcome: { kind: "unknown" }, blockTimestamp: null };
  }

  if (receipt.status !== "success") {
    return { outcome: { kind: "refused", reason: "The transaction reverted on chain." }, blockTimestamp: null };
  }

  const matched = matchContributionLog({
    logs: receipt.logs,
    saleAddress: args.saleAddress,
    claimingWallet: args.claimingWallet,
  });
  if (matched.kind === "unparseable") {
    return { outcome: { kind: "unknown" }, blockTimestamp: null };
  }
  if (matched.kind === "not-found") {
    return {
      outcome: {
        kind: "refused",
        reason: "That transaction is not a contribution by this wallet to this sale.",
      },
      blockTimestamp: null,
    };
  }

  let blockTimestamp: string | null = null;
  try {
    const block = await args.client.getBlock({ blockNumber: receipt.blockNumber });
    blockTimestamp = new Date(Number(block.timestamp) * 1000).toISOString();
  } catch {
    // See the docstring: absence is fillable, not disqualifying.
  }

  return {
    outcome: {
      kind: "verified",
      contribution: {
        walletAddress: matched.contributor,
        amountWei: matched.amountWei,
        totalRaisedWei: matched.totalRaisedWei,
        blockNumber: Number(receipt.blockNumber),
        logIndex: matched.logIndex,
      },
    },
    blockTimestamp,
  };
}
