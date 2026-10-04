import { isAddress, parseAbi, parseEventLogs, type Address, type Hash } from "viem";

import { saleReader } from "@/lib/referrals/census";
import { tokenSaleAbi } from "@/lib/sale/abi";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import {
  assetOf,
  countUnverifiedPayments,
  readUnverifiedPayments,
  writeVerificationVerdict,
  type UnverifiedPayment,
} from "@/lib/data/sale-payouts";

/**
 * Checking that a manual payout actually happened.
 *
 * Payouts go out by hand (docs/prds/TOKEN-SALE-INTENT.md §10.9), so the ledger is a
 * record of what a person SAYS they sent. This is the only thing that compares
 * that claim against the chain.
 *
 * TWO DESIGN DECISIONS WORTH THE COMMENT, both about efficiency AND correctness.
 *
 * 1. Work is grouped BY TRANSACTION, not by payment row. The efficient way to
 *    pay N referrers is one batched transfer, so one hash routinely covers many
 *    rows; reading per row would fetch the same receipt N times. It is also the
 *    only grouping that gets the right answer: a wallet owed both a buyer bonus
 *    and a referrer commission is usually paid in ONE transfer of the combined
 *    amount, and checking each row against its own amount would fail an
 *    exact-match test on a payment that was perfectly correct. The unit of truth
 *    is (transaction, wallet, asset), summed.
 *
 * 2. A `true` requires the payout wallet to be the SENDER. Without that, the
 *    check is "did this wallet ever receive at least this much of the sale
 *    token", which any inbound transfer satisfies: paste the hash of the
 *    wallet's own `claim()` and its 5,000-token sale allocation verifies a
 *    100-token bonus that was never sent. The payout wallet is configured, not
 *    inferred, and when it is unset every payment stays unverified and says so.
 *
 * 3. `false` is written ONLY from positive evidence. Three outcomes, not two
 *    (§4, and issue 29 is this exact collapse with money attached):
 *      true  = the receipt shows this wallet received at least what we recorded
 *      false = the receipt exists and shows it did not
 *      null  = we could not tell, so the row stays in the queue
 *    An unread node, a transaction not yet mined, and an ETH send routed through
 *    a contract all land in `null`. Rendering any of them as `false` would tell
 *    the operator to send money a second time.
 */

const erc20TransferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

/**
 * The wallet the rewards are sent FROM. `site_config`, so it can be set without
 * a redeploy and changed if the payout wallet is rotated mid-run.
 *
 * No default and no env fallback. A guessed sender would be worse than none:
 * it would verify against an address nobody checked (§8 #11, §8 #20).
 */
export const PAYOUT_WALLET_KEY = "token_sale_payout_wallet";

export interface VerifyOutcome {
  /** Payment rows considered. */
  checked: number;
  /** Rows we wrote `true` against. */
  verified: number;
  /** Rows we wrote `false` against, from a receipt that disagreed. */
  failed: number;
  /** Rows left in the queue because the chain could not settle them. */
  undetermined: number;
  /** Distinct transactions read. One read each, however many rows they cover. */
  transactionsRead: number;
  /** Plain-words account of anything left undetermined, for the operator. */
  notes: string[];
  /**
   * Payments still waiting on a verdict AFTER this run, beyond the ones it
   * looked at. A run is capped, and a capped run that reports only what it did
   * is indistinguishable from a finished one (§8 #18).
   */
  remaining: number;
}

/**
 * Verify every payment in a run that has a transaction hash and no verdict.
 *
 * The token address is read from the SALE CONTRACT rather than from config: it
 * is the token the contract will actually pay out in, and a configured address
 * that has drifted would verify transfers of the wrong asset (§8 #11).
 */
export async function verifyPayments(args: {
  snapshotId: string;
  saleAddress: string;
  chainId: number;
  /** Bounds one run. The page can call again; a payout list is not a stream. */
  limit?: number;
}): Promise<VerifyOutcome> {
  const outcome: VerifyOutcome = {
    checked: 0,
    verified: 0,
    failed: 0,
    undetermined: 0,
    transactionsRead: 0,
    notes: [],
    remaining: 0,
  };

  // Read before anything else: without it no payment can be confirmed, and
  // running the reads first would spend RPC calls to reach the same answer.
  const configured = await readSiteConfigKeys([PAYOUT_WALLET_KEY]);
  const rawPayer = configured[PAYOUT_WALLET_KEY]?.trim().toLowerCase();
  const payer = rawPayer && isAddress(rawPayer) ? rawPayer : null;

  const pending = await readUnverifiedPayments(args.snapshotId, args.limit ?? 500);
  if (pending.kind !== "found") {
    outcome.notes.push("Could not read the payment ledger, so nothing was checked.");
    return outcome;
  }
  if (pending.payments.length === 0) return outcome;
  outcome.checked = pending.payments.length;

  if (!payer) {
    // Not a fault, and not a verdict. Nothing is written, so every payment
    // stays in the queue and the operator is told exactly what to set.
    outcome.undetermined = pending.payments.length;
    outcome.notes.push(
      `No payout wallet is configured, so no payment can be confirmed. Set ${PAYOUT_WALLET_KEY} to the address the rewards are sent from. Without it, any transfer anyone ever made to a wallet would verify its payout.`,
    );
    return outcome;
  }

  const client = saleReader(args.chainId);

  let token: Address;
  try {
    token = (await client.readContract({
      address: args.saleAddress as Address,
      abi: tokenSaleAbi,
      functionName: "token",
    })) as Address;
  } catch {
    // Without the token address every ERC20 leg is unverifiable, and guessing it
    // would verify transfers of some other asset as if they were payouts.
    outcome.undetermined = pending.payments.length;
    outcome.notes.push("Could not read which token the sale pays out in, so no payment could be checked.");
    return outcome;
  }
  const tokenLower = token.toLowerCase();

  // Group by transaction: one read per hash, however many rows it covers.
  const byTx = new Map<string, UnverifiedPayment[]>();
  for (const p of pending.payments) {
    const list = byTx.get(p.txHash);
    if (list) list.push(p);
    else byTx.set(p.txHash, [p]);
  }

  for (const [txHash, payments] of byTx) {
    const settled = await verifyOneTransaction({ client, txHash, tokenLower, payments, payer });
    outcome.transactionsRead += settled.read ? 1 : 0;
    if (settled.note) outcome.notes.push(settled.note);

    for (const [payment, verdict] of settled.verdicts) {
      if (verdict === null) {
        outcome.undetermined += 1;
        continue;
      }
      await writeVerificationVerdict({
        snapshotId: payment.snapshotId,
        walletAddress: payment.walletAddress,
        kind: payment.kind,
        verified: verdict,
        blockNumber: settled.blockNumber,
        txHash: payment.txHash,
      });
      if (verdict) outcome.verified += 1;
      else outcome.failed += 1;
    }
  }

  // Measured after the writes, so it counts what is genuinely left rather than
  // subtracting an assumption. A capped run that cannot say "there is more"
  // reads identically to a finished one.
  const left = await countUnverifiedPayments(args.snapshotId);
  outcome.remaining = left.kind === "found" ? left.count : 0;
  if (left.kind !== "found") {
    outcome.notes.push("Could not count how many payments are still unverified, so this run cannot say whether it finished.");
  }

  return outcome;
}

interface SettledTransaction {
  /** Did we actually get a receipt? Distinguishes a read from a fault. */
  read: boolean;
  blockNumber: number | null;
  verdicts: Map<UnverifiedPayment, boolean | null>;
  note: string | null;
}

async function verifyOneTransaction(args: {
  client: ReturnType<typeof saleReader>;
  txHash: string;
  tokenLower: string;
  payments: UnverifiedPayment[];
  /** Lowercased. The only address whose sends count as a payout. */
  payer: string;
}): Promise<SettledTransaction> {
  const undetermined = (note: string): SettledTransaction => ({
    read: false,
    blockNumber: null,
    verdicts: new Map(args.payments.map((p) => [p, null])),
    note,
  });

  let receipt;
  let transaction;
  try {
    [receipt, transaction] = await Promise.all([
      args.client.getTransactionReceipt({ hash: args.txHash as Hash }),
      args.client.getTransaction({ hash: args.txHash as Hash }),
    ]);
  } catch {
    // Deliberately NOT split into transient and "not found". A transaction that
    // is still pending, one on another chain, and one the node could not serve
    // are all the same answer here: we do not know yet. Only a receipt we can
    // read is allowed to settle a payment either way.
    return undetermined(
      `${args.txHash} could not be read, so its ${args.payments.length} payment(s) stay unverified. It may still be pending, or on another chain.`,
    );
  }

  const blockNumber = receipt.blockNumber === undefined ? null : Number(receipt.blockNumber);

  // Wrong sender. Not a payout, whatever it moved, and not evidence that the
  // payout failed either: the operator simply pasted the wrong hash. Left
  // unsettled with a sentence naming both addresses.
  const from = transaction.from.toLowerCase();
  if (from !== args.payer) {
    return undetermined(
      `${args.txHash} was sent by ${from}, not by the configured payout wallet ${args.payer}, so it cannot confirm a payout. Check the hash.`,
    );
  }

  if (receipt.status === "reverted") {
    // Determinate, and the one case where `false` is unambiguous: the
    // transaction landed and moved nothing.
    return {
      read: true,
      blockNumber,
      verdicts: new Map(args.payments.map((p) => [p, false])),
      note: `${args.txHash} reverted, so nothing it was recorded against was paid.`,
    };
  }

  // Every ERC20 transfer in this receipt, of the sale token only, summed per
  // recipient. `parseEventLogs` skips anything that does not decode, so an
  // unrelated event in the same transaction cannot be read as a transfer.
  const received = new Map<string, bigint>();
  const logs = parseEventLogs({ abi: erc20TransferAbi, logs: receipt.logs, eventName: "Transfer" });
  for (const log of logs) {
    if (log.address.toLowerCase() !== args.tokenLower) continue;
    const to = log.args.to.toLowerCase();
    received.set(to, (received.get(to) ?? 0n) + log.args.value);
  }

  const txTo = transaction.to === null || transaction.to === undefined ? null : transaction.to.toLowerCase();
  const txValue = transaction.value;

  // Sum per (wallet, asset). A wallet owed two token legs is normally paid in
  // one transfer, so the comparison has to be against the combined amount.
  const expected = new Map<string, { token: bigint; eth: bigint }>();
  for (const p of args.payments) {
    const current = expected.get(p.walletAddress) ?? { token: 0n, eth: 0n };
    if (assetOf(p.kind) === "token") current.token += p.amount;
    else current.eth += p.amount;
    expected.set(p.walletAddress, current);
  }

  const verdicts = new Map<UnverifiedPayment, boolean | null>();
  // A Set, not an array: verifyEth's sentence is the same for every leg in a
  // batch, and one copy per payment produced a multi-kilobyte toast.
  const notes = new Set<string>();

  for (const p of args.payments) {
    const want = expected.get(p.walletAddress)!;
    verdicts.set(
      p,
      assetOf(p.kind) === "token"
        ? // An ERC20 transfer always emits, so a receipt with no transfer to this
          // wallet is positive evidence that it was not paid in this transaction.
          (received.get(p.walletAddress) ?? 0n) >= want.token
        : verifyEth({ txTo, txValue, wallet: p.walletAddress, want: want.eth, notes, txHash: args.txHash }),
    );
  }

  return { read: true, blockNumber, verdicts, note: notes.size > 0 ? [...notes].join(" ") : null };
}

/**
 * Was this wallet paid ETH by this transaction?
 *
 * A plain wallet-to-wallet send is fully checkable: the transaction's own `to`
 * and `value` are the payment. Anything routed through a contract is NOT, and
 * this is the case worth understanding before trusting the result.
 *
 * ETH moved by a contract (a disperse-style batch, a Safe execution) produces no
 * log. It is only visible in an execution trace, and no provider here serves
 * traces. A balance diff at N-1 and N would answer it (Alchemy is a full
 * archive; KNOWN-PROBLEMS L165), and is not built. Until it is, the honest answer
 * for a batched ETH payout is "we cannot tell", and it must stay `null`: writing `false` would tell the operator a
 * correct payment never happened, and the fix for that is a second send.
 */
function verifyEth(args: {
  txTo: string | null;
  txValue: bigint;
  wallet: string;
  want: bigint;
  notes: Set<string>;
  txHash: string;
}): boolean | null {
  if (args.txTo === args.wallet) return args.txValue >= args.want;
  args.notes.add(
    `${args.txHash} did not send ETH straight to ${args.wallet}, so its ETH leg cannot be checked from the receipt. Batched ETH transfers leave no log, and none of our providers serves the execution trace that would show them.`,
  );
  return null;
}
