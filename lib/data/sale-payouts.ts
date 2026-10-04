import { sql } from "drizzle-orm";

import { database } from "@/lib/db/client";
import { bigintFromNumericString } from "./numeric";
import { resultRows } from "./rows";

/**
 * The persistence boundary for manual referral payouts (migration 0095,
 * docs/REFERRALS-OPEN-ISSUES.md issue 44).
 *
 * `sale_airdrop_snapshot_rows` records what is OWED. This module owns the table
 * that records what was SENT, and the reconciliation between the two.
 *
 * The thing to hold onto while reading any of it: payouts go out BY HAND from a
 * plain wallet (docs/TOKEN-SALE-INTENT.md §10.9). Nothing here reverts, nothing
 * retries, and no contract will notice a mistake. A missed payment produces no
 * error anywhere in the system, so the reconciliation below is the only thing
 * that can ever find one.
 */

/** The three things a wallet can be owed. Same strings as the check constraint. */
export const PAYOUT_KINDS = ["referrer_eth", "referrer_tokens", "buyer_tokens"] as const;
export type PayoutKind = (typeof PAYOUT_KINDS)[number];

/** Which asset a kind is denominated in. Decides how a payment is verified. */
export function assetOf(kind: PayoutKind): "eth" | "token" {
  return kind === "referrer_eth" ? "eth" : "token";
}

export function isPayoutKind(value: string): value is PayoutKind {
  return (PAYOUT_KINDS as readonly string[]).includes(value);
}

export interface PaymentRecord {
  snapshotId: string;
  walletAddress: string;
  kind: PayoutKind;
  /** Base units. Wei for `referrer_eth`, token base units for the other two. */
  amount: bigint;
  txHash: string | null;
  /** THREE states (§4). null = nobody has looked, or the RPC could not answer. */
  chainVerified: boolean | null;
  verifiedAt: string | null;
  blockNumber: number | null;
  note: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

function mapPayment(r: Record<string, unknown>): PaymentRecord {
  return {
    snapshotId: String(r.snapshot_id),
    walletAddress: String(r.wallet_address),
    kind: String(r.kind) as PayoutKind,
    amount: bigintFromNumericString(String(r.amount)),
    txHash: r.tx_hash == null ? null : String(r.tx_hash),
    // Boolean(null) is false, which would turn "we have not looked" into "this
    // payment failed" — the exact §4 collapse, here with money attached.
    chainVerified: r.chain_verified == null ? null : Boolean(r.chain_verified),
    verifiedAt: r.verified_at == null ? null : String(r.verified_at),
    blockNumber: r.block_number == null ? null : Number(r.block_number),
    note: r.note == null ? null : String(r.note),
    recordedAt: String(r.recorded_at),
    recordedBy: r.recorded_by == null ? null : String(r.recorded_by),
  };
}

const PAYMENT_COLUMNS = sql`snapshot_id, wallet_address, kind, amount, tx_hash,
                            chain_verified, verified_at, block_number, note,
                            recorded_at, recorded_by`;

/* ------------------------------------------------------------------ */
/*  Recording a payment                                                */
/* ------------------------------------------------------------------ */

/** Postgres unique_violation. A concurrent insert of the same leg, not a fault. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

export type RecordPaymentOutcome =
  | { ok: true; payment: PaymentRecord }
  /** `existing` is null when the conflict was raised by the database under a
   *  race rather than found by the read, so there is no row in hand to show. */
  | { ok: false; reason: "already-recorded"; existing: PaymentRecord | null }
  | { ok: false; reason: "no-such-owed-row" }
  | { ok: false; reason: "snapshot-not-final" }
  | { ok: false; reason: "amount-mismatch"; owed: bigint };

/**
 * Record that a payment went out.
 *
 * Refuses on conflict rather than updating. The primary key on
 * (snapshot_id, wallet_address, kind) is the double-payment guard, and an
 * `on conflict do update` would quietly convert the guard into an overwrite:
 * the operator would see a green result on the second send and the ledger would
 * show one payment where two left the wallet. The caller gets the existing row
 * back so the page can say "already paid, here is the hash" instead of an error.
 *
 * FINAL SNAPSHOT ONLY. A rehearsal is a draft whose gates never cleared; paying
 * against one sends real money on numbers the system itself refused to publish.
 *
 * The amount is checked against what is owed. A manual send is typed by a
 * person, and a wrong amount recorded as correct makes the reconciliation agree
 * with itself while the wallet is short. `force` exists because a real payout
 * sometimes legitimately differs (a partial send, a correction), and it makes
 * that an explicit decision with a note attached rather than a silent default.
 */
export async function recordPayment(input: {
  snapshotId: string;
  walletAddress: string;
  kind: PayoutKind;
  amount: bigint;
  txHash: string | null;
  note?: string | null;
  recordedBy?: string | null;
  force?: boolean;
}): Promise<RecordPaymentOutcome> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");

  const wallet = input.walletAddress.toLowerCase();
  const txHash = input.txHash === null ? null : input.txHash.toLowerCase();

  return conn.transaction(async (tx) => {
    const owedRow = resultRows(
      await tx.execute(
        sql`select r.buyer_bonus_tokens, r.referrer_commission_tokens, r.referrer_rebate_wei,
                   h.is_final
            from sale_airdrop_snapshot_rows r
            join sale_airdrop_snapshots h on h.id = r.snapshot_id
            where r.snapshot_id = ${input.snapshotId} and r.wallet_address = ${wallet}`,
      ),
    )[0];
    if (!owedRow) return { ok: false, reason: "no-such-owed-row" } as const;
    if (owedRow.is_final !== true) return { ok: false, reason: "snapshot-not-final" } as const;

    const owed =
      input.kind === "referrer_eth"
        ? bigintFromNumericString(String(owedRow.referrer_rebate_wei))
        : input.kind === "referrer_tokens"
          ? bigintFromNumericString(String(owedRow.referrer_commission_tokens))
          : bigintFromNumericString(String(owedRow.buyer_bonus_tokens));

    if (!input.force && input.amount !== owed) {
      return { ok: false, reason: "amount-mismatch", owed } as const;
    }

    const existing = resultRows(
      await tx.execute(
        sql`select ${PAYMENT_COLUMNS} from sale_referral_payments
            where snapshot_id = ${input.snapshotId}
              and wallet_address = ${wallet}
              and kind = ${input.kind}
            for update`,
      ),
    )[0];

    let supersededNote: string | null = null;
    if (existing) {
      const prior = mapPayment(existing);
      // The ONE case where a second record is not a double payment: the chain
      // was read and says the recorded transaction did not pay this wallet. A
      // payment that provably did not happen is not a payment, so it must not
      // hold the slot forever. Every other state, including an unread verdict,
      // is still refused.
      if (prior.chainVerified !== false) {
        return { ok: false, reason: "already-recorded", existing: prior } as const;
      }
      // The superseded attempt is carried into the note rather than dropped.
      // Deleting the row is the only way past the primary key, and losing the
      // record of a failed send is how the same mistake gets made twice.
      supersededNote = `Replaces a payment the chain contradicted${prior.txHash ? ` (${prior.txHash})` : ""}.`;
      await tx.execute(
        sql`delete from sale_referral_payments
            where snapshot_id = ${input.snapshotId}
              and wallet_address = ${wallet}
              and kind = ${input.kind}`,
      );
    }

    const note = [input.note, supersededNote].filter(Boolean).join(" ") || null;

    // The primary key is the real guard, and it fires on a race the SELECT
    // above cannot see: `for update` takes no lock on zero rows, so two
    // concurrent calls both read "absent" and both insert. Money safety holds
    // either way; this turns the raw 23505 into the sentence the operator needs.
    let inserted;
    try {
      inserted = resultRows(
        await tx.execute(
          sql`insert into sale_referral_payments
                (snapshot_id, wallet_address, kind, amount, tx_hash, note, recorded_by)
              values (${input.snapshotId}, ${wallet}, ${input.kind},
                      ${input.amount.toString()}::numeric, ${txHash},
                      ${note}, ${input.recordedBy ?? null})
              returning ${PAYMENT_COLUMNS}`,
        ),
      )[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { ok: false, reason: "already-recorded", existing: null } as const;
      }
      throw error;
    }
    if (!inserted) throw new Error("Payment insert returned no row");
    return { ok: true, payment: mapPayment(inserted) } as const;
  });
}

/**
 * Attach or replace the transaction hash on a payment that was recorded without
 * one, and clear any verdict that was reached about the old hash.
 *
 * Clearing is the point. A `true` verdict is about one specific transaction, and
 * carrying it onto a different hash would publish a verification that never ran.
 */
export async function setPaymentTxHash(input: {
  snapshotId: string;
  walletAddress: string;
  kind: PayoutKind;
  txHash: string;
}): Promise<boolean> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const rows = resultRows(
    await conn.execute(
      sql`update sale_referral_payments
          set tx_hash = ${input.txHash.toLowerCase()},
              chain_verified = null, verified_at = null, block_number = null
          where snapshot_id = ${input.snapshotId}
            and wallet_address = ${input.walletAddress.toLowerCase()}
            and kind = ${input.kind}
          returning 1 as ok`,
    ),
  );
  return rows.length > 0;
}

/* ------------------------------------------------------------------ */
/*  Verification                                                       */
/* ------------------------------------------------------------------ */

export interface UnverifiedPayment {
  snapshotId: string;
  walletAddress: string;
  kind: PayoutKind;
  amount: bigint;
  txHash: string;
}

export type UnverifiedRead =
  | { kind: "found"; payments: UnverifiedPayment[] }
  | { kind: "unavailable" };

/**
 * Payments that have a transaction hash and no verdict yet.
 *
 * Ordered by tx hash so the caller can group by it and read each transaction
 * ONCE. The efficient way to pay N referrers is a single batched transfer, so
 * one hash routinely covers many rows, and a naive per-row fetch would read the
 * same receipt N times.
 */
export async function readUnverifiedPayments(
  snapshotId: string,
  limit = 500,
): Promise<UnverifiedRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select snapshot_id, wallet_address, kind, amount, tx_hash
            from sale_referral_payments
            where snapshot_id = ${snapshotId}
              and tx_hash is not null
              and chain_verified is null
            order by tx_hash asc, wallet_address asc
            limit ${Math.max(1, limit)}`,
      ),
    );
    return {
      kind: "found",
      payments: rows.map((r) => ({
        snapshotId: String(r.snapshot_id),
        walletAddress: String(r.wallet_address),
        kind: String(r.kind) as PayoutKind,
        amount: bigintFromNumericString(String(r.amount)),
        txHash: String(r.tx_hash),
      })),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export type UnverifiedCountRead = { kind: "found"; count: number } | { kind: "unavailable" };

/**
 * How many payments still have a hash and no verdict.
 *
 * Separate from `readUnverifiedPayments` because that one is CAPPED, and a
 * capped run reporting only what it processed is indistinguishable from a
 * finished one (§8 #18). Three states: an unread count is not zero.
 */
export async function countUnverifiedPayments(snapshotId: string): Promise<UnverifiedCountRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const r = resultRows(
      await conn.execute(
        sql`select count(*) as n from sale_referral_payments
            where snapshot_id = ${snapshotId}
              and tx_hash is not null
              and chain_verified is null`,
      ),
    )[0];
    if (r?.n == null) return { kind: "unavailable" };
    return { kind: "found", count: Number(r.n) };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Store a verdict about one payment.
 *
 * `verified` is boolean here and never null, because writing null is not a
 * verdict, it is the absence of one, and the row already holds that. A caller
 * that could not read the chain must simply NOT CALL THIS. Leaving the row
 * untouched keeps it in the queue; writing `false` would tell the operator the
 * transaction did not pay, on the strength of a dead RPC (§4, §8 #9).
 */
export async function writeVerificationVerdict(input: {
  snapshotId: string;
  walletAddress: string;
  kind: PayoutKind;
  verified: boolean;
  blockNumber: number | null;
  /** The hash the verdict is ABOUT. The write is refused if it has changed. */
  txHash: string;
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  await conn.execute(
    // `tx_hash` is in the WHERE on purpose. A verify pass reads a receipt, then
    // writes; if setPaymentTxHash lands between those two, the write would
    // stamp a verdict about the OLD transaction onto the NEW hash, which is the
    // exact thing that function's verdict-clearing exists to prevent. No rows
    // updated is the correct outcome: the payment stays in the queue.
    sql`update sale_referral_payments
        set chain_verified = ${input.verified},
            verified_at = now(),
            block_number = ${input.blockNumber}
        where snapshot_id = ${input.snapshotId}
          and wallet_address = ${input.walletAddress.toLowerCase()}
          and kind = ${input.kind}
          and tx_hash = ${input.txHash.toLowerCase()}`,
  );
}

/** Clear the verdict on every payment in a run so verification can be re-run. */
export async function clearVerdicts(snapshotId: string): Promise<number> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const rows = resultRows(
    await conn.execute(
      sql`update sale_referral_payments
          set chain_verified = null, verified_at = null, block_number = null
          where snapshot_id = ${snapshotId} and chain_verified is not null
          returning 1 as ok`,
    ),
  );
  return rows.length;
}

/* ------------------------------------------------------------------ */
/*  The operator's view: owed against paid                             */
/* ------------------------------------------------------------------ */

export interface PayoutLine {
  kind: PayoutKind;
  /** Base units. The integer that goes in the wallet. */
  owed: bigint;
  /** Null when no payment has been recorded. Never 0: a payment of zero and no
   *  payment at all are different facts, and only one of them is done. */
  paid: bigint | null;
  txHash: string | null;
  chainVerified: boolean | null;
  note: string | null;
  /**
   * Is this leg still owed?
   *
   * NOT simply `paid === null`. `chainVerified === false` means the receipt
   * exists and shows the wallet did not receive it, which is the STRONGEST
   * evidence of a missed payment the system can produce. Treating a recorded
   * amount as settled regardless of the verdict would drop that wallet out of
   * the export, the totals and the outstanding filter at the exact moment we
   * learned it was never paid (§8 #13: every exclusion is an all-clear).
   *
   * `chainVerified === null` counts as settled on purpose, in the other
   * direction: unread is not unpaid, and a batched ETH send can never be
   * confirmed on this chain. Re-sending against an unread verdict is the
   * expensive mistake, so it stays out of the outstanding set and is surfaced
   * as UNVERIFIED instead.
   */
  stillOwed: boolean;
}

export interface PayoutRow {
  walletAddress: string;
  contributedWei: bigint;
  saleAllocationTokens: bigint;
  referredCount: number;
  referredWei: bigint;
  referrerQualified: boolean;
  buyerBonusEligible: boolean;
  reason: string;
  lines: PayoutLine[];
  /** Does this wallet still have something owed and unpaid? */
  outstanding: boolean;
}

export interface PayoutTotals {
  kind: PayoutKind;
  owed: bigint;
  /** Recorded and NOT contradicted by the chain. */
  recorded: bigint;
  /** Summed over payments whose chain verdict is true. */
  verified: bigint;
  /** Recorded, and the chain says it did not happen. Owed again. */
  contradicted: bigint;
  walletsOwed: number;
  walletsPaid: number;
  walletsContradicted: number;
  /** Owed minus recorded. Zero on a finished run. This is the number that
   *  catches a missed manual payment, because nothing else will. A contradicted
   *  payment adds back into it rather than settling it. */
  outstanding: bigint;
}

export type PayoutLedgerRead =
  | { kind: "found"; snapshotId: string; isFinal: boolean; rows: PayoutRow[]; totals: PayoutTotals[] }
  | { kind: "absent" }
  | { kind: "unavailable" };

/**
 * The whole payout picture for one run: every wallet, what it is owed in each of
 * the three kinds, what has been sent, and the chain's verdict on each payment.
 *
 * UNCAPPED on purpose. This is the list a person works down while sending real
 * money, and a silently truncated one pays a fraction of the sale.
 *
 * Wallets owed nothing in any kind are dropped. Everyone else is kept, including
 * wallets already paid in full, because the page has to be safe to reload and
 * re-sort mid-payout and a disappearing row reads as a lost record.
 */
export async function readPayoutLedger(snapshotId: string): Promise<PayoutLedgerRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const header = resultRows(
      await conn.execute(sql`select id, is_final from sale_airdrop_snapshots where id = ${snapshotId}`),
    )[0];
    if (!header) return { kind: "absent" };

    const rows = resultRows(
      await conn.execute(
        sql`select r.wallet_address, r.contributed_wei, r.sale_allocation_tokens,
                   r.referred_count, r.referred_wei, r.referrer_qualified,
                   r.buyer_bonus_eligible, r.reason,
                   r.buyer_bonus_tokens, r.referrer_commission_tokens, r.referrer_rebate_wei,
                   p_buyer.amount   as paid_buyer,   p_buyer.tx_hash   as tx_buyer,
                   p_buyer.chain_verified as ver_buyer, p_buyer.note as note_buyer,
                   p_rtok.amount    as paid_rtok,    p_rtok.tx_hash    as tx_rtok,
                   p_rtok.chain_verified  as ver_rtok,  p_rtok.note  as note_rtok,
                   p_reth.amount    as paid_reth,    p_reth.tx_hash    as tx_reth,
                   p_reth.chain_verified  as ver_reth,  p_reth.note  as note_reth
            from sale_airdrop_snapshot_rows r
            left join sale_referral_payments p_buyer
              on p_buyer.snapshot_id = r.snapshot_id
             and p_buyer.wallet_address = r.wallet_address
             and p_buyer.kind = 'buyer_tokens'
            left join sale_referral_payments p_rtok
              on p_rtok.snapshot_id = r.snapshot_id
             and p_rtok.wallet_address = r.wallet_address
             and p_rtok.kind = 'referrer_tokens'
            left join sale_referral_payments p_reth
              on p_reth.snapshot_id = r.snapshot_id
             and p_reth.wallet_address = r.wallet_address
             and p_reth.kind = 'referrer_eth'
            where r.snapshot_id = ${snapshotId}
              and (r.buyer_bonus_tokens > 0
                or r.referrer_commission_tokens > 0
                or r.referrer_rebate_wei > 0)
            order by r.wallet_address asc`,
      ),
    );

    const out: PayoutRow[] = rows.map((r) => {
      const line = (
        kind: PayoutKind,
        owedRaw: unknown,
        paidRaw: unknown,
        txRaw: unknown,
        verRaw: unknown,
        noteRaw: unknown,
      ): PayoutLine => ({
        kind,
        owed: bigintFromNumericString(String(owedRaw)),
        // A left join miss is null, and null means no payment row exists. Kept
        // distinct from a recorded amount of 0 (§8 #3).
        paid: paidRaw == null ? null : bigintFromNumericString(String(paidRaw)),
        txHash: txRaw == null ? null : String(txRaw),
        chainVerified: verRaw == null ? null : Boolean(verRaw),
        note: noteRaw == null ? null : String(noteRaw),
        stillOwed:
          bigintFromNumericString(String(owedRaw)) > 0n &&
          (paidRaw == null || (verRaw != null && Boolean(verRaw) === false)),
      });

      const lines = [
        line("buyer_tokens", r.buyer_bonus_tokens, r.paid_buyer, r.tx_buyer, r.ver_buyer, r.note_buyer),
        line("referrer_tokens", r.referrer_commission_tokens, r.paid_rtok, r.tx_rtok, r.ver_rtok, r.note_rtok),
        line("referrer_eth", r.referrer_rebate_wei, r.paid_reth, r.tx_reth, r.ver_reth, r.note_reth),
      ];

      return {
        walletAddress: String(r.wallet_address),
        contributedWei: bigintFromNumericString(String(r.contributed_wei)),
        saleAllocationTokens: bigintFromNumericString(String(r.sale_allocation_tokens)),
        referredCount: Number(r.referred_count),
        referredWei: bigintFromNumericString(String(r.referred_wei)),
        referrerQualified: Boolean(r.referrer_qualified),
        buyerBonusEligible: Boolean(r.buyer_bonus_eligible),
        reason: String(r.reason),
        lines,
        outstanding: lines.some((l) => l.stillOwed),
      };
    });

    const totals: PayoutTotals[] = PAYOUT_KINDS.map((kind) => {
      const lines = out.map((row) => row.lines.find((l) => l.kind === kind)!).filter((l) => l.owed > 0n);
      const owed = lines.reduce((sum, l) => sum + l.owed, 0n);
      // A contradicted payment is NOT recorded progress. Summing it here would
      // subtract it from `outstanding` and report a wallet we know was never
      // paid as settled.
      const recorded = lines.reduce(
        (sum, l) => sum + (l.chainVerified === false ? 0n : (l.paid ?? 0n)),
        0n,
      );
      const verified = lines.reduce((sum, l) => sum + (l.chainVerified === true ? (l.paid ?? 0n) : 0n), 0n);
      const contradicted = lines.reduce(
        (sum, l) => sum + (l.chainVerified === false ? (l.paid ?? 0n) : 0n),
        0n,
      );
      return {
        kind,
        owed,
        recorded,
        verified,
        contradicted,
        walletsOwed: lines.length,
        walletsPaid: lines.filter((l) => l.paid !== null && l.chainVerified !== false).length,
        walletsContradicted: lines.filter((l) => l.chainVerified === false).length,
        outstanding: owed - recorded,
      };
    });

    return { kind: "found", snapshotId, isFinal: header.is_final === true, rows: out, totals };
  } catch {
    return { kind: "unavailable" };
  }
}

export type SnapshotOwedTotalsRead =
  | { kind: "found"; buyerTokens: bigint; referrerTokens: bigint; referrerWei: bigint }
  | { kind: "absent" }
  | { kind: "unavailable" };

/**
 * The totals the SNAPSHOT stored when it ran, not a re-sum of the rows.
 *
 * The point is that they are written independently: comparing them against a
 * fresh sum of the same rows is the one check that can catch a row set that has
 * been edited, truncated, or partially written since the run (§8 #11, and §9's
 * rule that correctness comes from two representations disagreeing).
 */
export async function readSnapshotOwedTotals(snapshotId: string): Promise<SnapshotOwedTotalsRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const r = resultRows(
      await conn.execute(
        sql`select owed_buyer_tokens, owed_referrer_tokens, owed_referrer_wei
            from sale_airdrop_snapshots where id = ${snapshotId}`,
      ),
    )[0];
    if (!r) return { kind: "absent" };
    return {
      kind: "found",
      buyerTokens: bigintFromNumericString(String(r.owed_buyer_tokens)),
      referrerTokens: bigintFromNumericString(String(r.owed_referrer_tokens)),
      referrerWei: bigintFromNumericString(String(r.owed_referrer_wei)),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export type FinalSnapshotIdRead =
  | { kind: "found"; id: string }
  | { kind: "absent" }
  | { kind: "unavailable" };

/** The id of the one final run, if there is one. Three states, never a bare null. */
export async function readFinalSnapshotId(): Promise<FinalSnapshotIdRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const r = resultRows(
      await conn.execute(sql`select id from sale_airdrop_snapshots where is_final limit 1`),
    )[0];
    if (!r) return { kind: "absent" };
    return { kind: "found", id: String(r.id) };
  } catch {
    return { kind: "unavailable" };
  }
}
