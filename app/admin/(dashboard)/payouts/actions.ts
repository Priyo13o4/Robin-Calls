"use server";

import { revalidatePath } from "next/cache";
import { isAddress, isHash } from "viem";

import { requireAdmin } from "@/lib/auth/guard";
import { toResult, type ActionResult } from "@/lib/admin/action-result";
import { resolveSaleAddress } from "@/lib/sale/address";
import { upsertSiteConfigKeys } from "@/lib/data/site-config";
import { PAYOUT_WALLET_KEY, verifyPayments } from "@/lib/referrals/payout-verify";
import {
  clearVerdicts,
  isPayoutKind,
  recordPayment,
  setPaymentTxHash,
  type PayoutKind,
} from "@/lib/data/sale-payouts";

/**
 * Operator actions behind /admin/payouts.
 *
 * Every one of these is about real money leaving a wallet by hand, so the
 * failure messages are written to be read under pressure mid-payout: they say
 * what the system believes, not what went wrong internally.
 *
 * `requireAdmin()` is called in each action rather than relied on from the
 * layout. proxy.ts only checks that a cookie is present; the authoritative role
 * check is per action (CLAUDE.md §6), and a server action is reachable without
 * ever rendering the page that links to it.
 */

const ADMIN_PATH = "/admin/payouts";

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function parseKind(raw: string): PayoutKind {
  if (!isPayoutKind(raw)) throw new Error(`"${raw}" is not one of the three payout kinds.`);
  return raw;
}

function parseBaseUnits(raw: string): bigint {
  if (!/^\d+$/.test(raw)) {
    // Base units only. A decimal here is the operator typing "0.05" for an ETH
    // rebate, which would record 0 wei against a real payment and make the
    // reconciliation agree with itself while the wallet is short.
    throw new Error("Amount must be a whole number in base units (wei, or token base units). No decimal point.");
  }
  return BigInt(raw);
}

/** Record that a payment went out. Refuses a second one for the same leg. */
export async function recordPaymentAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    const session = await requireAdmin();
    const snapshotId = field(formData, "snapshotId");
    const wallet = field(formData, "wallet").toLowerCase();
    const kind = parseKind(field(formData, "kind"));
    const amount = parseBaseUnits(field(formData, "amount"));
    const rawTx = field(formData, "txHash").toLowerCase();
    const note = field(formData, "note") || null;
    const force = field(formData, "force") === "on";

    if (!isAddress(wallet)) throw new Error("That is not a wallet address.");
    // A hash is optional so a send can be logged before it confirms, but a
    // malformed one is refused: it would sit in the verification queue forever
    // and read as an unverified payment rather than as a typo.
    if (rawTx && !isHash(rawTx)) throw new Error("That transaction hash is not a 32-byte hex hash.");

    const actor =
      (session.user as { username?: string; email?: string }).username ?? session.user.email ?? "admin";

    const outcome = await recordPayment({
      snapshotId,
      walletAddress: wallet,
      kind,
      amount,
      txHash: rawTx || null,
      note,
      recordedBy: actor,
      force,
    });

    if (!outcome.ok) {
      if (outcome.reason === "already-recorded") {
        throw new Error(
          `This leg is already recorded${outcome.existing?.txHash ? ` against ${outcome.existing.txHash}` : ""}. Nothing was written. If the first record is wrong, correct that row instead of adding a second.`,
        );
      }
      if (outcome.reason === "amount-mismatch") {
        throw new Error(
          `That amount does not match what this wallet is owed (${outcome.owed} base units). Tick "record anyway" and leave a note if the difference is deliberate.`,
        );
      }
      if (outcome.reason === "snapshot-not-final") {
        throw new Error("That run is not the final snapshot. Payments are only recorded against the final one.");
      }
      throw new Error("That wallet has no row in this snapshot, so there is nothing owed to pay.");
    }

    revalidatePath(ADMIN_PATH);
    return `Recorded ${amount} base units to ${wallet}.`;
  });
}

/** Attach or correct the transaction hash on an already-recorded payment. */
export async function setTxHashAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await requireAdmin();
    const snapshotId = field(formData, "snapshotId");
    const wallet = field(formData, "wallet").toLowerCase();
    const kind = parseKind(field(formData, "kind"));
    const txHash = field(formData, "txHash").toLowerCase();

    if (!isHash(txHash)) throw new Error("That transaction hash is not a 32-byte hex hash.");

    const updated = await setPaymentTxHash({ snapshotId, walletAddress: wallet, kind, txHash });
    if (!updated) throw new Error("No payment is recorded for that wallet and kind, so there is no hash to set.");

    revalidatePath(ADMIN_PATH);
    // Say the verdict was cleared. An operator who does not know that will read
    // the row's blank verdict as verification having failed.
    return "Hash updated. Any previous chain verdict was cleared, because it was about the old transaction.";
  });
}

/** Read the chain and settle every payment that has a hash and no verdict. */
export async function verifyPaymentsAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await requireAdmin();
    const snapshotId = field(formData, "snapshotId");

    const sale = await resolveSaleAddress();
    if (sale.kind === "unconfigured") throw new Error("No sale address is configured, so nothing can be verified.");
    if (sale.kind !== "address") throw new Error("Could not read the sale address, so nothing was verified.");

    const outcome = await verifyPayments({
      snapshotId,
      saleAddress: sale.address,
      chainId: sale.chainId,
    });

    revalidatePath(ADMIN_PATH);

    if (outcome.checked === 0) return "Nothing to verify. Every recorded payment already has a verdict.";

    // Report all three counts, always. Reporting only successes would let a run
    // that could not read a single transaction read as a clean pass. And report
    // what is LEFT: a run is capped, and without this the message after the
    // first pass is identical to the message after the last one (§8 #18).
    const parts = [
      `Read ${outcome.transactionsRead} transaction(s) covering ${outcome.checked} payment(s).`,
      `${outcome.verified} confirmed, ${outcome.failed} contradicted, ${outcome.undetermined} still unsettled.`,
      outcome.remaining > 0
        ? `${outcome.remaining} payment(s) still have no verdict. Run this again.`
        : "Nothing is left without a verdict.",
    ];
    if (outcome.notes.length > 0) parts.push(outcome.notes.slice(0, 3).join(" "));
    return parts.join(" ");
  });
}

/**
 * Set the wallet the rewards are sent FROM.
 *
 * Verification refuses to confirm anything until this is set, on purpose:
 * without a sender to match, "did this wallet receive at least this much" is
 * satisfied by any inbound transfer, including the wallet's own sale claim.
 */
export async function setPayoutWalletAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    const session = await requireAdmin();
    const wallet = field(formData, "payoutWallet").toLowerCase();
    if (!isAddress(wallet)) throw new Error("That is not a wallet address.");
    const actor =
      (session.user as { username?: string; email?: string }).username ?? session.user.email ?? "admin";
    await upsertSiteConfigKeys([{ key: PAYOUT_WALLET_KEY, value: wallet, updatedBy: actor }]);
    revalidatePath(ADMIN_PATH);
    // Changing the payer invalidates verdicts reached under the old one, so say
    // so rather than leaving stale confirmations looking current.
    return `Payout wallet set to ${wallet}. Verdicts already reached are not re-checked; clear them if the payer changed mid-run.`;
  });
}

/** Drop every verdict in a run so verification can be taken again from scratch. */
export async function clearVerdictsAction(formData: FormData): Promise<ActionResult> {
  return toResult(async () => {
    await requireAdmin();
    const snapshotId = field(formData, "snapshotId");
    const cleared = await clearVerdicts(snapshotId);
    revalidatePath(ADMIN_PATH);
    return `Cleared ${cleared} verdict(s). The payments themselves are untouched.`;
  });
}
