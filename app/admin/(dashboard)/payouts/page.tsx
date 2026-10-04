import { AdminHeading } from "../../components/AdminShell";
import { ActionForm } from "@/app/admin/components/ActionForm";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import { PAYOUT_WALLET_KEY } from "@/lib/referrals/payout-verify";
import { setPayoutWalletAction } from "./actions";
import { resolveSaleAddress } from "@/lib/sale/address";
import { readSaleSnapshot } from "@/lib/sale/server";
import { saleReader } from "@/lib/referrals/census";
import { EmptyState, InfoBox, InfoPanel, SectionLabel, StatTile } from "../../components/ui";
import {
  readFinalSnapshotId,
  readPayoutLedger,
  readSnapshotOwedTotals,
  type PayoutRow,
  type PayoutTotals,
} from "@/lib/data/sale-payouts";
import { PayoutTable, type SerializedPayoutRow, type SerializedPayoutTotals } from "./PayoutTable";

export const dynamic = "force-dynamic";

/**
 * The manual payout desk (docs/prds/REFERRALS-OPEN-ISSUES.md issue 44e).
 *
 * Referral rewards are sent BY HAND from a plain wallet, so this page is not a
 * dashboard over an automated process. It is the process. Everything it shows
 * is written for someone with a wallet open in the next tab.
 *
 * FINAL SNAPSHOT ONLY, and the page resolves that itself rather than taking an
 * id. A rehearsal is a draft whose gates never cleared, and paying out of one
 * sends real money against numbers the system refused to publish.
 */
export default async function PayoutsPage() {
  const finalId = await readFinalSnapshotId();

  if (finalId.kind === "unavailable") {
    return (
      <>
        <AdminHeading title="Growth · Referral Payouts" sub="Owed against paid, for the final snapshot." />
        <InfoBox tone="warning">
          Could not reach the database to find the final snapshot. This is a read failure, not an
          answer: there may well be one, and nothing here should be read as saying no payouts are due.
        </InfoBox>
      </>
    );
  }

  if (finalId.kind === "absent") {
    return (
      <>
        <AdminHeading title="Growth · Referral Payouts" sub="Owed against paid, for the final snapshot." />
        <InfoBox>
          No final snapshot exists yet. Run the close snapshot from the job endpoint first. Until one
          is marked final there is nothing anybody is owed.
        </InfoBox>
      </>
    );
  }

  const [ledger, stored] = await Promise.all([
    readPayoutLedger(finalId.id),
    readSnapshotOwedTotals(finalId.id),
  ]);

  if (ledger.kind !== "found") {
    return (
      <>
        <AdminHeading title="Growth · Referral Payouts" sub={`Snapshot ${finalId.id}`} />
        <InfoBox tone="warning">
          {ledger.kind === "absent"
            ? "The final snapshot id resolved but the run itself could not be found."
            : "Could not read the payout ledger. Nothing here is an answer about what is owed."}
        </InfoBox>
      </>
    );
  }

  const totalsByKind = Object.fromEntries(ledger.totals.map((t) => [t.kind, t]));
  const outstandingWallets = ledger.rows.filter((r) => r.outstanding).length;
  const contradictedLegs = ledger.totals.reduce((n, t) => n + t.walletsContradicted, 0);
  const payoutWallet = (await readSiteConfigKeys([PAYOUT_WALLET_KEY]))[PAYOUT_WALLET_KEY] ?? null;

  // The token's own decimals, read from the token. Hardcoding 18 would be a
  // literal standing in for a measurement (§8 #11), and the figure it produces
  // sits next to a number a person is about to send. Null when the read
  // faulted, and the table then prints base units only rather than a figure
  // scaled by a guess.
  const sale = await resolveSaleAddress();
  let tokenDecimals: number | null = null;
  if (sale.kind === "address") {
    const view = await readSaleSnapshot(sale.address, { client: saleReader(sale.chainId) });
    tokenDecimals = view?.view.tokenMeta?.decimals ?? null;
  }

  // The page ships every row it renders to the browser, `reason` prose and all.
  // Uncapped is right for the EXPORT, which is built server side and is the
  // thing money is sent from; it is not right for a client component that
  // mounts every row. The cap is named, reported, and applied to the display
  // only (§8 #18: a cap that is not reported reads as a complete list).
  const RENDER_CAP = 500;
  const rendered = ledger.rows.slice(0, RENDER_CAP);

  // The snapshot wrote its own totals when it ran. Re-summing the rows here and
  // comparing is the one check that can catch a row set edited, truncated or
  // partially written since (§9: correctness is two representations disagreeing).
  const drift =
    stored.kind === "found"
      ? [
          { label: "buyer bonus tokens", stored: stored.buyerTokens, summed: totalsByKind.buyer_tokens?.owed ?? 0n },
          { label: "referrer commission tokens", stored: stored.referrerTokens, summed: totalsByKind.referrer_tokens?.owed ?? 0n },
          { label: "referrer ETH rebate (wei)", stored: stored.referrerWei, summed: totalsByKind.referrer_eth?.owed ?? 0n },
        ].filter((d) => d.stored !== d.summed)
      : [];

  return (
    <>
      <AdminHeading
        title="Growth · Referral Payouts"
        sub={`Snapshot ${ledger.snapshotId}. Every wallet owed something, what has been sent, and what the chain says about each send.`}
      />

      {!ledger.isFinal && (
        <InfoBox tone="danger">
          This run is not marked final. Payments cannot be recorded against it, and nothing below
          should be paid.
        </InfoBox>
      )}

      {stored.kind === "unavailable" && (
        <InfoBox tone="warning">
          Could not read the totals the snapshot stored, so the owed figures below are unchecked
          against a second source. They are still the row sums; they are just not corroborated.
        </InfoBox>
      )}

      {drift.length > 0 && (
        <InfoBox tone="danger">
          The totals this snapshot recorded when it ran do not match the sum of its own rows:{" "}
          {drift.map((d) => `${d.label} stored ${d.stored}, rows add to ${d.summed}`).join("; ")}. Do
          not pay from this list until that is explained. One of the two numbers is wrong and there
          is no way from here to tell which.
        </InfoBox>
      )}

      <InfoPanel title="HOW TO WORK THIS PAGE">
        <p>
          Export the outstanding set, send it, then paste each transaction hash back in. Amounts are
          <span className="text-[#ededea]"> base units</span>: wei for ETH, token base units for
          tokens. The human figure next to each is for sanity only. Paste the integer.
        </p>
        <p>
          A wallet owed both a buyer bonus and a referrer commission can be paid in one token
          transfer, and the export sums them for exactly that reason. Record both legs against the
          same hash and verification will settle them together.
        </p>
        <p>
          The verdict column has three states.{" "}
          <span className="text-[#ededea]">Confirmed</span> means the receipt shows the wallet
          received at least what was recorded. <span className="text-[#ededea]">Contradicted</span>{" "}
          means the receipt exists and shows it did not.{" "}
          <span className="text-[#ededea]">Unverified</span> means we could not tell, which is not
          the same as unpaid. A batched ETH send leaves no log and none of our providers serves the trace
          that would show it, so those stay unverified and must be checked by eye.
        </p>
        <p className="text-[#4a4a4a]">
          This page is safe to reload, re-sort and re-export mid-payout. A second record for the same
          leg is refused by the database, not by a handler.
        </p>
      </InfoPanel>

      {!payoutWallet && (
        <InfoBox tone="warning">
          No payout wallet is set, so no payment can be confirmed against the chain. Until it is set,
          verification has no sender to match and would accept any transfer anyone ever made to a
          wallet as proof its reward was paid. Set it below before sending anything.
        </InfoBox>
      )}

      {contradictedLegs > 0 && (
        <InfoBox tone="danger">
          {contradictedLegs} recorded payment(s) are contradicted by the chain: the transaction
          landed and the wallet did not receive it. Those wallets are counted as still owed and are
          back in the export. Recording a new payment against one of them replaces the failed
          record.
        </InfoBox>
      )}

      <ActionForm
        action={setPayoutWalletAction}
        title="Payout wallet"
        className="mb-6 flex flex-wrap items-end gap-2 border border-[#2a2a2a] bg-[#141414] p-3"
      >
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.14em] text-[#4a4a4a]">
            PAYOUT WALLET (THE ADDRESS REWARDS ARE SENT FROM)
          </span>
          <input
            name="payoutWallet"
            defaultValue={payoutWallet ?? ""}
            placeholder="0x…"
            className="w-96 border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-[#ededea]"
          />
        </label>
        <button
          type="submit"
          className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#ededea] hover:border-[#8a8a8a]"
        >
          SAVE
        </button>
      </ActionForm>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="WALLETS OWED" value={ledger.rows.length} />
        <StatTile
          label="STILL OUTSTANDING"
          value={outstandingWallets}
          tone={outstandingWallets > 0 ? "warning" : "success"}
          hint="Wallets with at least one leg owed and no payment recorded."
        />
        <StatTile
          label="LEGS RECORDED"
          value={ledger.totals.reduce((n, t) => n + t.walletsPaid, 0)}
          hint={`of ${ledger.totals.reduce((n, t) => n + t.walletsOwed, 0)} owed`}
        />
        <StatTile
          label="LEGS CONTRADICTED"
          value={contradictedLegs}
          tone={contradictedLegs > 0 ? "danger" : "neutral"}
          hint="The chain says the recorded transaction did not pay. Owed again."
        />
      </div>

      <SectionLabel count={ledger.rows.length}>PAYOUT LIST</SectionLabel>
      {ledger.rows.length > RENDER_CAP && (
        <InfoBox tone="warning">
          Showing the first {RENDER_CAP} of {ledger.rows.length} wallets. The export is built from
          the whole list, not from what is on screen, so work from the CSV rather than from this
          page when the run is this large.
        </InfoBox>
      )}
      {ledger.rows.length === 0 ? (
        <EmptyState>
          Nobody is owed anything in this snapshot. Every wallet either used no code or brought in
          nobody who qualified.
        </EmptyState>
      ) : (
        <PayoutTable
          snapshotId={ledger.snapshotId}
          isFinal={ledger.isFinal}
          rows={serialize(rendered)}
          totals={serializeTotals(ledger.totals)}
          tokenDecimals={tokenDecimals}
        />
      )}
    </>
  );
}

/** bigint does not cross the server/client boundary. Base-unit strings do, and
 *  they are what the operator pastes anyway. */
function serialize(rows: PayoutRow[]): SerializedPayoutRow[] {
  return rows.map((r) => ({
    walletAddress: r.walletAddress,
    contributedWei: r.contributedWei.toString(),
    saleAllocationTokens: r.saleAllocationTokens.toString(),
    referredCount: r.referredCount,
    referredWei: r.referredWei.toString(),
    referrerQualified: r.referrerQualified,
    buyerBonusEligible: r.buyerBonusEligible,
    reason: r.reason,
    outstanding: r.outstanding,
    lines: r.lines.map((l) => ({
      kind: l.kind,
      owed: l.owed.toString(),
      // null stays null. Collapsing it to "0" would render "no payment recorded"
      // as "we paid them nothing", which is the state the operator acts on.
      paid: l.paid === null ? null : l.paid.toString(),
      txHash: l.txHash,
      chainVerified: l.chainVerified,
      note: l.note,
      stillOwed: l.stillOwed,
    })),
  }));
}

function serializeTotals(totals: PayoutTotals[]): SerializedPayoutTotals[] {
  return totals.map((t) => ({
    kind: t.kind,
    owed: t.owed.toString(),
    recorded: t.recorded.toString(),
    verified: t.verified.toString(),
    contradicted: t.contradicted.toString(),
    walletsOwed: t.walletsOwed,
    walletsPaid: t.walletsPaid,
    walletsContradicted: t.walletsContradicted,
    outstanding: t.outstanding.toString(),
  }));
}
