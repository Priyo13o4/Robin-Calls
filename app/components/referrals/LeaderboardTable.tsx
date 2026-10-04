"use client";

import type { Social } from "@/lib/referrals/socials";
import { SocialIcons } from "./SocialIcons";
import { displayName, formatEth } from "@/lib/referrals/display";
import { useCopy } from "@/app/components/site/CopyAddressChip";
import { ShimmerBlock } from "@/app/components/site/Skeleton";

export interface LeaderboardRow {
  rank: number;
  wallet: string;
  nickname: string | null;
  emoji: string | null;
  socials?: Social[];
  amountWei: string;
  count: number;
  refunded?: boolean;
}

/**
 * One board, two meanings for the same two columns:
 *
 *   contributions — amount is what they put in, count is how many sends
 *   referrals     — amount is what their people put in, count is how many people
 *
 * The header names the meaning rather than leaving the reader to infer it from
 * context they may not have arrived with.
 *
 * Rows are separate cards, not table rows, so each wallet reads as its own
 * entry. They stay column-aligned because the header and every card share ONE
 * grid template — a per-row layout would let the amounts drift out of line the
 * moment a nickname got long.
 */
export function LeaderboardTable({
  board,
  rows,
  highlightWallet,
  compact = false,
  emptyMessage,
  allocationOf,
  loading = false,
}: {
  board: "contributions" | "referrals";
  rows: LeaderboardRow[];
  /** Rendered with the accent border so a connected wallet can find itself. */
  highlightWallet?: string | null;
  compact?: boolean;
  emptyMessage: string;
  /**
   * Wei → estimated token allocation, or null when the chain reads it prices
   * against have not landed. Only ever supplied for the contributions board:
   * on the referrals board the amount is other people's money and buys the
   * referrer no tokens, so an allocation column there would be a false claim.
   */
  allocationOf?: (amountWei: string) => string | null;
  loading?: boolean;
}) {
  const amountLabel = board === "referrals" ? "BROUGHT IN" : "CONTRIBUTED";
  const countLabel = board === "referrals" ? "PEOPLE" : "SENDS";
  const showAllocation = allocationOf !== undefined && !compact;

  // Phones get rank / wallet / amount only. The secondary columns return at
  // `sm`; showing all five below that needs a 520px track, which either drags
  // sideways or (without min-w-0 above) widens the page until the viewport
  // clips it.
  const cols = compact
    ? "grid-cols-[2.25rem_minmax(0,1fr)_6rem]"
    : showAllocation
      ? "grid-cols-[2.25rem_minmax(0,1fr)_6.5rem] sm:grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_7rem_3.5rem]"
      : "grid-cols-[2.25rem_minmax(0,1fr)_6.5rem] sm:grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_3.5rem]";
  const secondary = "hidden text-right sm:block";

  if (loading) {
    const rowCount = compact ? 5 : 8;
    return (
      <div className="overflow-x-auto">
        <div className={compact ? "min-w-[260px]" : "min-w-[260px] sm:min-w-[520px]"}>
          <div
            className={`grid ${cols} items-center gap-3 px-4 pb-2 font-mono text-[11px] font-semibold tracking-[0.16em] text-white`}
          >
            <span>#</span>
            <span>WALLET</span>
            <span className="text-right">{amountLabel}</span>
            {showAllocation && <span className={secondary}>EST. ALLOCATION</span>}
            {!compact && <span className={secondary}>{countLabel}</span>}
          </div>

          <ul className="flex list-none flex-col gap-1.5 p-0">
            {Array.from({ length: rowCount }).map((_, i) => (
              <li
                key={i}
                className={`noir-card grid ${cols} items-center gap-3 rounded-xl border border-[#232323] bg-[#1a1a1a] px-4 py-3`}
              >
                <ShimmerBlock className="h-3 w-4 rounded" />
                <div className="flex items-center gap-2">
                  <ShimmerBlock className="size-4 rounded-full flex-none" />
                  <ShimmerBlock className="h-3 w-28 sm:w-36 rounded" />
                </div>
                <div className="flex justify-end">
                  <ShimmerBlock className="h-3 w-16 rounded" />
                </div>
                {showAllocation && (
                  <div className="hidden justify-end sm:flex">
                    <ShimmerBlock className="h-3 w-20 rounded" />
                  </div>
                )}
                {!compact && (
                  <div className="hidden justify-end sm:flex">
                    <ShimmerBlock className="h-3 w-8 rounded" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    if (!emptyMessage) return null;
    return (
      <p className="noir-well rounded-2xl border border-[#1f1f1f] px-4 py-6 text-center text-[12px] text-[#a0a09a]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className={compact ? "min-w-[260px]" : "min-w-[260px] sm:min-w-[520px]"}>
        <div
          className={`grid ${cols} items-center gap-3 px-4 pb-2 font-mono text-[11px] font-semibold tracking-[0.16em] text-white`}
        >
          <span>#</span>
          <span>WALLET</span>
          <span className="text-right">{amountLabel}</span>
          {showAllocation && <span className={secondary}>EST. ALLOCATION</span>}
          {!compact && <span className={secondary}>{countLabel}</span>}
        </div>

        <ul className="flex list-none flex-col gap-1.5 p-0">
          {rows.map((row) => {
            const name = displayName(row.nickname, row.emoji, row.wallet);
            const mine =
              highlightWallet != null && highlightWallet.toLowerCase() === row.wallet.toLowerCase();
            const top3 = row.rank <= 3;
            return (
              <li
                key={row.wallet}
                className={`noir-card grid ${cols} items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  mine
                    ? "border-[#4d5c1a] bg-[#1a1f0a]"
                    : "border-[#232323] bg-[#1a1a1a] hover:border-[#333] hover:bg-[#1f1f1f]"
                }`}
              >
                <span
                  className={`font-mono text-[12px] tabular-nums ${
                    top3 ? "text-[#ccff00]" : "text-[#6f6f6f]"
                  }`}
                >
                  {String(row.rank).padStart(2, "0")}
                </span>

                {/* Stacked on phones, one line from `sm`. The address is
                    shrink-0 and always shown (lib/referrals/display.ts: hiding
                    it is how a borrowed name reads as the person), so sharing a
                    narrow row with it truncated the nickname to a letter. */}
                <span className="flex min-w-0 flex-col items-start sm:flex-row sm:items-baseline sm:gap-2">
                  {(name.emoji || row.nickname) && (
                    <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                      {name.emoji && <span className="text-[14px]">{name.emoji}</span>}
                      {row.nickname && (
                        <span className="truncate text-[13px] text-[#ededea]">{name.primary}</span>
                      )}
                    </span>
                  )}
                  <span className="flex items-baseline gap-2">
                    <WalletCopy wallet={row.wallet} short={name.secondary ?? name.primary} />
                    {mine && (
                      <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-[#ccff00]">
                        YOU
                      </span>
                    )}
                    <SocialIcons socials={row.socials} />
                    {row.refunded && (
                      <span className="shrink-0 rounded border border-[#ff4444]/30 bg-[#2a1a1a] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] text-[#ff6666]">
                        REFUNDED
                      </span>
                    )}
                  </span>
                </span>

                <span className="text-right font-mono text-[13px] tabular-nums text-[#ededea]">
                  {formatEth(row.amountWei)} <span className="text-[#6f6f6f]">ETH</span>
                </span>

                {showAllocation && (
                  <span className={`${secondary} font-mono text-[13px] tabular-nums text-[#a0a09a]`}>
                    {allocationOf(row.amountWei) ?? "—"}
                  </span>
                )}

                {!compact && (
                  <span className={`${secondary} font-mono text-[13px] tabular-nums text-[#a0a09a]`}>
                    {board === "contributions" && row.count === 0 ? "—" : row.count}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * The short address, click to copy the FULL one.
 *
 * Copying the truncated form would defeat the point: these boards are read to
 * work out whether several rows are one person, and `0x1234…cdef` cannot be
 * pasted into an explorer or matched against another row.
 */
export function WalletCopy({ wallet, short }: { wallet: string; short: string }) {
  const { copied, copy } = useCopy(wallet);
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : `Copy ${wallet}`}
      aria-label={copied ? "Address copied" : `Copy address ${wallet}`}
      className="group/copy inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-[#6f6f6f] transition-colors hover:text-[#ccff00]"
    >
      {copied ? <span className="text-[#ccff00]">COPIED</span> : short}
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="size-3 opacity-0 transition-opacity group-hover/copy:opacity-100"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </svg>
    </button>
  );
}
