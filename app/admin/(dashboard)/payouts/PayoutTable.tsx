"use client";

import { useMemo, useState } from "react";
import { formatUnits } from "viem";

import { toast, ONE_SHOT_MS } from "@/components/ui/use-toast";
import { Badge } from "../../components/ui";
import { ActionForm } from "@/app/admin/components/ActionForm";
import { clearVerdictsAction, recordPaymentAction, setTxHashAction, verifyPaymentsAction } from "./actions";
import { exportOutstandingAction } from "./export";

/**
 * The payout desk's table.
 *
 * Amounts arrive as base-unit STRINGS, never numbers. A token amount at 18
 * decimals is far past what float64 round-trips, and this is the value a person
 * pastes into a wallet (§8 #3 is the same class one layer down).
 */

export interface SerializedPayoutLine {
  kind: string;
  owed: string;
  /** null means no payment row exists. Distinct from "0". */
  paid: string | null;
  txHash: string | null;
  /** Three states. null is "we could not tell", not "unpaid". */
  chainVerified: boolean | null;
  note: string | null;
  /** Still owed. A contradicted payment is owed again, not settled. */
  stillOwed: boolean;
}

export interface SerializedPayoutRow {
  walletAddress: string;
  contributedWei: string;
  saleAllocationTokens: string;
  referredCount: number;
  referredWei: string;
  referrerQualified: boolean;
  buyerBonusEligible: boolean;
  reason: string;
  outstanding: boolean;
  lines: SerializedPayoutLine[];
}

export interface SerializedPayoutTotals {
  kind: string;
  owed: string;
  recorded: string;
  verified: string;
  contradicted: string;
  walletsOwed: number;
  walletsPaid: number;
  walletsContradicted: number;
  outstanding: string;
}

const KIND_LABEL: Record<string, string> = {
  buyer_tokens: "Buyer bonus",
  referrer_tokens: "Referrer tokens",
  referrer_eth: "Referrer ETH",
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Base units to a readable figure.
 *
 * Display only, and every caller prints the integer beside it. A rounded figure
 * is how a manual send is off by dust in a way nobody notices.
 *
 * `decimals` is null when the token's own `decimals()` could not be read. That
 * prints a dash rather than a figure scaled by an assumed 18, because a wrong
 * magnitude next to a send amount is worse than no magnitude (§4). ETH is 18 by
 * definition and never passes null.
 */
function human(baseUnits: string, decimals: number | null): string {
  if (decimals === null) return "—";
  try {
    return Number(formatUnits(BigInt(baseUnits), decimals)).toLocaleString("en-US", {
      maximumFractionDigits: 6,
    });
  } catch {
    return "?";
  }
}

function VerdictBadge({ line }: { line: SerializedPayoutLine }) {
  if (line.paid === null) return <Badge tone="neutral">NOT SENT</Badge>;
  if (line.chainVerified === true) return <Badge tone="success">CONFIRMED</Badge>;
  if (line.chainVerified === false) return <Badge tone="danger">CONTRADICTED</Badge>;
  // The third state, and the one worth spelling out: recorded as sent, and the
  // chain has not confirmed it either way.
  return <Badge tone="warning">UNVERIFIED</Badge>;
}

export function PayoutTable({
  snapshotId,
  isFinal,
  rows,
  totals,
  tokenDecimals,
}: {
  snapshotId: string;
  isFinal: boolean;
  rows: SerializedPayoutRow[];
  totals: SerializedPayoutTotals[];
  /** Read from the token. Null means the read faulted, never an assumed 18. */
  tokenDecimals: number | null;
}) {
  // ETH is 18 by definition; the token's is measured.
  const decimalsFor = (kind: string) => (kind === "referrer_eth" ? 18 : tokenDecimals);
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(
    () => (outstandingOnly ? rows.filter((r) => r.outstanding) : rows),
    [rows, outstandingOnly],
  );

  async function onExport() {
    if (busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("snapshotId", snapshotId);
      const res = await exportOutstandingAction(fd);
      if (!res.ok) {
        toast({ variant: "destructive", title: "Export", description: res.error, duration: ONE_SHOT_MS });
        return;
      }
      const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ variant: "success", title: "Export", description: `Downloaded ${res.filename}.`, duration: ONE_SHOT_MS });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border border-[#2a2a2a] bg-[#141414] p-3">
        <label className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a]">
          <input
            type="checkbox"
            checked={outstandingOnly}
            onChange={(e) => setOutstandingOnly(e.target.checked)}
          />
          OUTSTANDING ONLY
        </label>
        <div className="flex-1" />
        <button
          type="button"
          disabled={busy}
          onClick={onExport}
          className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#ededea] hover:border-[#8a8a8a] disabled:opacity-50"
        >
          EXPORT OUTSTANDING
        </button>
        <ActionForm action={verifyPaymentsAction} title="Verify">
          <input type="hidden" name="snapshotId" value={snapshotId} />
          <button
            type="submit"
            className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#ededea] hover:border-[#8a8a8a]"
          >
            VERIFY AGAINST CHAIN
          </button>
        </ActionForm>
        <ActionForm action={clearVerdictsAction} title="Clear verdicts">
          <input type="hidden" name="snapshotId" value={snapshotId} />
          <button
            type="submit"
            className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#8a8a8a]"
          >
            CLEAR VERDICTS
          </button>
        </ActionForm>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {totals.map((t) => (
          <div key={t.kind} className="border border-[#2a2a2a] bg-[#141414] p-3">
            <div className="font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]">
              {(KIND_LABEL[t.kind] ?? t.kind).toUpperCase()}
            </div>
            <div className="mt-2 text-sm text-[#ededea]">
              {t.walletsPaid} / {t.walletsOwed} legs recorded
            </div>
            <div className="mt-1 font-mono text-[11px] text-[#8a8a8a]">
              owed {human(t.owed, decimalsFor(t.kind))} · sent {human(t.recorded, decimalsFor(t.kind))} · confirmed {human(t.verified, decimalsFor(t.kind))}
            </div>
            {t.walletsContradicted > 0 && (
              <div className="mt-1 font-mono text-[11px] text-[#e0897a]">
                {t.walletsContradicted} contradicted, {human(t.contradicted, decimalsFor(t.kind))} back in the outstanding
                total
              </div>
            )}
            <div className={`mt-1 font-mono text-[11px] ${t.outstanding === "0" ? "text-[#6a8a4a]" : "text-[#d9c96a]"}`}>
              outstanding {t.outstanding} base units
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {shown.map((row) => (
          <div key={row.walletAddress} className="border border-[#2a2a2a] bg-[#141414]">
            <button
              type="button"
              onClick={() => setOpen(open === row.walletAddress ? null : row.walletAddress)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#181818]"
            >
              <span className="font-mono text-xs text-[#ededea]">{short(row.walletAddress)}</span>
              {row.outstanding ? <Badge tone="warning">OUTSTANDING</Badge> : <Badge tone="success">ALL RECORDED</Badge>}
              <span className="flex-1" />
              <span className="font-mono text-[11px] text-[#8a8a8a]">
                {row.referrerQualified ? `${row.referredCount} referred · ${human(row.referredWei, 18)} ETH` : "buyer only"}
              </span>
            </button>

            {open === row.walletAddress && (
              <div className="space-y-3 border-t border-[#2a2a2a] px-4 py-3">
                <p className="font-mono text-[11px] leading-relaxed text-[#8a8a8a]">{row.walletAddress}</p>
                <p className="text-xs leading-relaxed text-[#a0a09a]">{row.reason}</p>

                {row.lines
                  .filter((l) => l.owed !== "0")
                  .map((line) => (
                    <div key={line.kind} className="border border-[#2a2a2a] bg-[#101010] p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] tracking-[0.14em] text-[#ededea]">
                          {(KIND_LABEL[line.kind] ?? line.kind).toUpperCase()}
                        </span>
                        <VerdictBadge line={line} />
                        <span className="flex-1" />
                        <span className="font-mono text-[11px] text-[#8a8a8a]">
                          {human(line.owed, decimalsFor(line.kind))} {line.kind === "referrer_eth" ? "ETH" : "tokens"}
                        </span>
                      </div>

                      {/* The integer, always, next to the human figure. This is
                          the value that goes in the wallet. */}
                      <p className="mt-1 break-all font-mono text-[11px] text-[#4a4a4a]">{line.owed} base units</p>

                      {line.txHash && (
                        <p className="mt-1 break-all font-mono text-[11px] text-[#6a6a6a]">{line.txHash}</p>
                      )}
                      {line.note && <p className="mt-1 text-[11px] text-[#8a6d1f]">{line.note}</p>}

                      {line.stillOwed ? (
                        <ActionForm
                          action={recordPaymentAction}
                          title="Record payment"
                          className="mt-3 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="snapshotId" value={snapshotId} />
                          <input type="hidden" name="wallet" value={row.walletAddress} />
                          <input type="hidden" name="kind" value={line.kind} />
                          <label className="flex flex-col gap-1">
                            <span className="font-mono text-[10px] tracking-[0.14em] text-[#4a4a4a]">AMOUNT (BASE UNITS)</span>
                            <input
                              name="amount"
                              defaultValue={line.owed}
                              className="w-56 border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-[#ededea]"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-mono text-[10px] tracking-[0.14em] text-[#4a4a4a]">TX HASH</span>
                            <input
                              name="txHash"
                              placeholder="0x…"
                              className="w-80 border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-[#ededea]"
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="font-mono text-[10px] tracking-[0.14em] text-[#4a4a4a]">NOTE</span>
                            <input
                              name="note"
                              className="w-48 border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-[#ededea]"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 pb-1.5 font-mono text-[10px] tracking-[0.14em] text-[#8a6d1f]">
                            <input type="checkbox" name="force" />
                            RECORD ANYWAY
                          </label>
                          {line.chainVerified === false && (
                            <p className="w-full font-mono text-[10px] text-[#e0897a]">
                              The chain contradicted the last payment recorded here, so recording a
                              new one replaces it. The failed hash is kept in the note.
                            </p>
                          )}
                          <button
                            type="submit"
                            disabled={!isFinal}
                            className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#ededea] hover:border-[#8a8a8a] disabled:opacity-50"
                          >
                            RECORD
                          </button>
                        </ActionForm>
                      ) : (
                        <ActionForm
                          action={setTxHashAction}
                          title="Update hash"
                          className="mt-3 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="snapshotId" value={snapshotId} />
                          <input type="hidden" name="wallet" value={row.walletAddress} />
                          <input type="hidden" name="kind" value={line.kind} />
                          <span className="pb-1.5 font-mono text-[11px] text-[#8a8a8a]">
                            recorded {line.paid} base units
                          </span>
                          <label className="flex flex-col gap-1">
                            <span className="font-mono text-[10px] tracking-[0.14em] text-[#4a4a4a]">CORRECT THE HASH</span>
                            <input
                              name="txHash"
                              placeholder="0x…"
                              className="w-80 border border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1 font-mono text-[11px] text-[#ededea]"
                            />
                          </label>
                          <button
                            type="submit"
                            className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#8a8a8a]"
                          >
                            UPDATE
                          </button>
                        </ActionForm>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
