"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

import { NoirShell, PageHeader } from "@/app/components/site/NoirShell";
import { PageBackdrop } from "@/app/components/site/PageBackdrop";
import { LeaderboardTable } from "@/app/components/referrals/LeaderboardTable";
import { LeaderboardPodium, LeaderboardPodiumSkeleton } from "@/app/components/referrals/LeaderboardPodium";
import { ShimmerBlock } from "@/app/components/site/Skeleton";
import { useLeaderboard } from "@/lib/referrals/useLeaderboard";
import { useWallet } from "@/lib/wallet/useWallet";
import { getSaleChain } from "@/lib/config/chain";
import { allocationQuote, type SaleSnapshot } from "@/lib/sale/reads";
import { useSaleData } from "@/lib/sale/useSaleData";
import { fmtTokens } from "@/lib/sale/projection";
import { formatEth } from "@/lib/referrals/display";

/** Rows shown per board. The API caps at 100; this is the display limit. */
const MAX_ROWS = 50;

/**
 * The two boards.
 *
 * Both are summed from our copy of the sale's contribution logs, so both carry
 * the same caveat and it is stated on the page rather than assumed: a
 * contribution made in the last minute is real and may not be counted yet. That
 * line is what stops a contributor reading a missing row as a missing
 * contribution.
 *
 * THE STATS RAIL IS NOT SUMMED FROM THE ROWS. The API returns a top-N slice, so
 * adding those up and printing "total raised" would publish a fraction as the
 * whole (§9, coverage before conclusion). Every total on the right comes from
 * the contract's own counters; the only rail figure taken from the board is the
 * largest contribution, which a descending rank makes safe at any limit.
 */
export function LeaderboardClient({
  contract,
  snapshot,
  chainId,
  initialBoard = "contributions",
}: {
  contract: string;
  snapshot: SaleSnapshot | null;
  chainId?: number;
  /** Which tab the incoming link asked for, resolved server-side. */
  initialBoard?: "contributions" | "referrals";
}) {
  const chain = getSaleChain(chainId);
  const [board, setBoard] = useState<"contributions" | "referrals">(initialBoard);
  const { status, rows, mirrorUpdatedAt } = useLeaderboard(board, MAX_ROWS);
  const wallet = useWallet();

  const { sale } = useSaleData({
    chain,
    contract,
    walletAddress: null,
    snapshot,
  });

  const dec = sale?.tokenMeta?.decimals;
  const pool = sale?.tokensForSale;
  const raised = sale?.totalRaised;
  const heads = sale?.contributorCount;

  /**
   * What a row's contribution is worth in tokens if the sale closed now. Null
   * whenever any input is unread — an unpriced allocation renders "—", never a
   * zero that reads as "this wallet gets nothing".
   */
  const allocationOf = useMemo(() => {
    if (pool === undefined || raised === undefined || dec === undefined) return undefined;
    return (amountWei: string) => {
      let contributed: bigint;
      try {
        contributed = BigInt(amountWei);
      } catch {
        return null;
      }
      const q = allocationQuote({ extra: 0n, contributed, totalRaised: raised, tokensForSale: pool });
      return q === null ? null : fmtTokens(q.tokens, dec);
    };
  }, [pool, raised, dec]);

  const averageWei =
    raised !== undefined && heads !== undefined && heads > 0n ? raised / heads : null;

  return (
    <NoirShell>
      <PageBackdrop src="/backgrounds/leaderboard-bg.webp" />

      <div className="relative z-[2]">
        <PageHeader
          eyebrow={`TOKEN SALE · ${chain.name.toUpperCase()}`}
          title="Leaderboard"
          subline="Who put in the most, and who brought in the most people. Every number is added up from the sale contract's own record."
        />

        {sale?.state === 4 && (
          <div className="mx-auto mb-6 max-w-6xl px-4 sm:px-6">
            <div className="rounded-xl border border-[#ff4444]/30 bg-[#241414] px-4 py-3 text-sm text-[#ff9999]">
              <span className="font-bold text-[#ff4444]">SALE ABANDONED · REFUNDS OPEN.</span>{" "}
              The sale was abandoned and refunds are open. Below is what each contributor committed over the life of the sale; refunded wallets are marked.
            </div>
          </div>
        )}

        <div className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <div className="flex gap-2">
            <Tab active={board === "contributions"} onClick={() => setBoard("contributions")}>
              CONTRIBUTORS
            </Tab>
            <Tab active={board === "referrals"} onClick={() => setBoard("referrals")}>
              REFERRERS
            </Tab>
          </div>

          <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* ── LEFT: podium standing in front of the ranked table ── */}
            {/* min-w-0: a grid item defaults to min-width:auto, so the table's
                own min-width would widen the whole column instead of scrolling
                inside it, and html{overflow-x:hidden} then clips it silently. */}
            <section className="min-w-0">
              <div className="relative z-[1] -mb-8 sm:-mb-10">
                {status === "loading" ? (
                  <LeaderboardPodiumSkeleton />
                ) : (
                  <LeaderboardPodium rows={rows} highlightWallet={wallet.address} />
                )}
              </div>

              <div
                className="relative rounded-2xl border border-[#1f1f1f] bg-[#141414]"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}
              >
                <div className="flex items-baseline justify-between gap-3 px-4 pb-3 pt-10 sm:px-5 sm:pt-12">
                  <h2 className="font-mono text-[11px] tracking-[0.22em] text-[#a0a09a]">
                    {board === "referrals" ? "TOP REFERRERS" : "TOP CONTRIBUTORS"}
                  </h2>
                </div>

                <p className="px-4 pb-4 text-[12px] leading-relaxed text-[#a0a09a] sm:px-5">
                  {board === "contributions"
                    ? "Wallets that put in the same amount rank by who got there first."
                    : "Only buyers who added a code before their first contribution count."}
                </p>

                {/* Recessed, so the row bubbles have something to sit ON: the
                    card is #141414 and the bubbles #1a1a1a, which is too close
                    to separate without a darker ground between them. */}
                <div className="noir-well mx-3 mb-3 rounded-xl py-3 sm:mx-4 sm:mb-4">
                  <LeaderboardTable
                    board={board}
                    rows={rows}
                    highlightWallet={wallet.address}
                    allocationOf={board === "contributions" ? allocationOf : undefined}
                    loading={status === "loading"}
                    emptyMessage={
                      status === "error"
                        ? "We could not load the board just now. This is a display problem, not a missing contribution. Please try again in a moment."
                        : "Nobody is on this board yet."
                    }
                  />
                </div>

                {mirrorUpdatedAt !== null && Date.now() - Date.parse(mirrorUpdatedAt) > 120_000 && (
                  <p className="border-t border-[#1f1f1f] px-4 py-3 text-[11px] text-[#d9c96a] sm:px-5">
                    These numbers are from {mirrorAgeLabel(mirrorUpdatedAt)}. A contribution from the
                    last few minutes may not be counted yet.
                  </p>
                )}
              </div>
            </section>

            {/* ── RIGHT: totals, every one of them counted by the contract ── */}
            <aside className="min-w-0 lg:sticky lg:top-24">
              <div
                className="rounded-2xl border border-[#1f1f1f] bg-[#141414]"
                style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)" }}
              >
                <h2 className="border-b border-[#1f1f1f] px-5 py-3 font-mono text-[11px] tracking-[0.22em] text-[#a0a09a]">
                  SALE TOTALS
                </h2>
                <div className="divide-y divide-[#1f1f1f]">
                  <RailStat
                    label="TOTAL CONTRIBUTORS"
                    value={heads === undefined ? "—" : Number(heads).toLocaleString("en-US")}
                    loading={heads === undefined}
                  />
                  <RailStat
                    label={sale?.state === 4 ? "TOTAL RAISED (LIFETIME)" : "TOTAL RAISED"}
                    value={raised === undefined ? "—" : formatEth(raised)}
                    unit={raised === undefined ? undefined : "ETH"}
                    accent
                    loading={raised === undefined}
                  />
                  <RailStat
                    label="AVERAGE CONTRIBUTION"
                    value={averageWei === null ? "—" : formatEth(averageWei)}
                    unit={averageWei === null ? undefined : "ETH"}
                    loading={heads === undefined || raised === undefined}
                  />
                  <RailStat
                    label="LARGEST CONTRIBUTION"
                    value={
                      board === "contributions" && rows[0] ? formatEth(rows[0].amountWei) : "—"
                    }
                    unit={board === "contributions" && rows[0] ? "ETH" : undefined}
                    loading={status === "loading"}
                    hint={
                      board === "contributions" && rows[0]
                        ? `${rows[0].wallet.slice(0, 6)}…${rows[0].wallet.slice(-4)}`
                        : "shown on the contributors board"
                    }
                  />
                </div>
              </div>

              <p className="mt-4 rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] px-4 py-3 text-[11px] leading-relaxed text-[#a0a09a]">
                The four totals above are read straight from the sale contract, so they cover
                every contributor, not only the wallets ranked here.
                {pool !== undefined && dec !== undefined && (
                  <>
                    {" "}
                    Estimated allocations divide the {fmtTokens(pool, dec)}{" "}
                    token pool at today&apos;s raise; they move with every contribution until the
                    sale closes.
                  </>
                )}
              </p>

              <Link
                href="/token-sale"
                className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light mt-4 flex w-full cursor-pointer items-center justify-center gap-2 border-[#EDEDEA] bg-[#EDEDEA] py-3 font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#0A0A0A] no-underline transition-colors"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back to the Sale
              </Link>
            </aside>
          </div>
        </div>
      </div>
    </NoirShell>
  );
}

/** "3 minutes ago" shaped labels for the mirror freshness note. */
function mirrorAgeLabel(updatedAtIso: string): string {
  const t = Date.parse(updatedAtIso);
  if (!Number.isFinite(t)) return "an earlier check";
  const mins = Math.max(1, Math.round((Date.now() - t) / 60_000));
  return mins === 1 ? "a minute ago" : `${mins} minutes ago`;
}

function RailStat({
  label,
  value,
  unit,
  hint,
  accent = false,
  loading = false,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <p className="font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a]">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        {loading ? (
          <ShimmerBlock className="h-7 w-28 rounded" />
        ) : (
          <>
            <span
              className={`font-cinzel text-[26px] font-black leading-none tabular-nums ${
                accent ? "text-[#ccff00]" : "text-[#ededea]"
              }`}
            >
              {value}
            </span>
            {unit && <span className="font-mono text-[11px] text-[#8a8a8a]">{unit}</span>}
          </>
        )}
      </div>
      {hint && (
        <p className="mt-1.5 font-mono text-[10px] tracking-[0.12em] text-[#6f6f6f]">{hint}</p>
      )}
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-5 py-2 font-mono text-[11px] tracking-[0.16em] transition-colors ${
        active
          ? "border-[#ccff00] bg-[#1a1f0a] text-[#ccff00]"
          : "border-[#2a2a2a] text-[#a0a09a] hover:border-[#4a4a4a] hover:text-[#ededea]"
      }`}
    >
      {children}
    </button>
  );
}
