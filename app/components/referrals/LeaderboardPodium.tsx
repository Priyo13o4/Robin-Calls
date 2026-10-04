"use client";

import { displayName, formatEth } from "@/lib/referrals/display";
import { ShimmerBlock } from "@/app/components/site/Skeleton";
import { SocialIcons } from "./SocialIcons";
import { WalletCopy, type LeaderboardRow } from "./LeaderboardTable";

/**
 * The top three, as a podium that stands in front of the table below it.
 *
 * Depth on a near-black canvas is not a drop shadow: nothing is darker
 * than #0a0a0a for one to darken. It comes from an inset top highlight (the
 * light edge), a dark inner right face, and a cast shadow that only reads
 * because it falls on the table card, which is lighter than the page.
 */
export function LeaderboardPodium({
  rows,
  highlightWallet,
}: {
  /** Already ranked; anything past the third entry is ignored. */
  rows: LeaderboardRow[];
  highlightWallet?: string | null;
}) {
  const byRank = new Map(rows.slice(0, 3).map((r) => [r.rank, r]));
  return (
    <div className="relative flex items-end justify-center gap-2 px-2 sm:gap-4">
      {/* Winner's glow, behind everything and never over the text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{
          background:
            "radial-gradient(46% 100% at 50% 100%, rgba(204,255,0,0.10) 0%, rgba(204,255,0,0.03) 42%, transparent 72%)",
        }}
      />
      {[2, 1, 3].map((rank) => {
        const row = byRank.get(rank);
        return (
          <Plinth
            key={rank}
            rank={rank}
            row={row}
            mine={
              row != null &&
              highlightWallet != null &&
              highlightWallet.toLowerCase() === row.wallet.toLowerCase()
            }
          />
        );
      })}
    </div>
  );
}

/** Shimmer skeleton for the podium shown while a board's first page is in flight. */
export function LeaderboardPodiumSkeleton() {
  return (
    <div className="relative flex items-end justify-center gap-2 px-2 sm:gap-4">
      {[2, 1, 3].map((rank) => {
        const shape = SHAPE[rank];
        return (
          <div key={rank} className={`relative z-[1] flex flex-col items-center ${shape.width}`}>
            <ShimmerBlock className="size-11 rounded-full sm:size-12" />
            <ShimmerBlock className="mt-2 h-3.5 w-16 rounded" />
            <ShimmerBlock className="mt-1 h-3 w-12 rounded" />
            <div className="mb-2">
              <ShimmerBlock className="h-2.5 w-14 rounded" />
            </div>
            <div
              className={`relative w-full overflow-hidden rounded-t-lg border border-b-0 border-[#232323] bg-[#141414] ${shape.height}`}
            >
              <ShimmerBlock className="h-full w-full opacity-30" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SHAPE: Record<number, { height: string; width: string }> = {
  1: { height: "h-[104px] sm:h-[132px]", width: "w-[104px] sm:w-[140px]" },
  2: { height: "h-[76px] sm:h-[98px]", width: "w-[96px] sm:w-[124px]" },
  3: { height: "h-[58px] sm:h-[76px]", width: "w-[96px] sm:w-[124px]" },
};

function Plinth({
  rank,
  row,
  mine,
}: {
  rank: number;
  row?: LeaderboardRow;
  mine: boolean;
}) {
  const first = rank === 1;
  const shape = SHAPE[rank];

  if (!row) {
    return (
      <div className={`relative z-[1] flex flex-col items-center ${shape.width}`}>
        <div className="flex size-11 items-center justify-center rounded-full border border-dashed border-[#2a2a2a] bg-[#141414] text-xs font-mono text-[#555] sm:size-12">
          —
        </div>
        <p className="mt-2 w-full truncate text-center font-mono text-[11px] text-[#6f6f6f]">
          Unclaimed
        </p>
        <p className="font-mono text-[11px] tabular-nums text-[#4a4a4a]">
          — <span className="text-[#3a3a3a]">ETH</span>
        </p>
        <div className="mb-2 max-w-full">
          <span className="font-mono text-[10px] text-[#4a4a4a]">—</span>
        </div>
        <div
          className={`relative w-full overflow-hidden rounded-t-lg ${shape.height}`}
          style={{
            background: "linear-gradient(180deg,#191919 0%,#121212 62%,#0b0b0b 100%)",
            boxShadow: [
              "inset 0 1px 0 rgba(255,255,255,0.06)",
              "inset -1px 0 0 rgba(0,0,0,0.6)",
              "inset 1px 0 0 rgba(255,255,255,0.02)",
              "0 22px 34px -20px rgba(0,0,0,0.95)",
            ].join(","),
          }}
        >
          <span
            className="absolute inset-x-0 top-2 text-center font-cinzel text-[26px] font-black leading-none sm:text-[32px] text-[#2c2c2c]"
          >
            {rank}
          </span>
        </div>
      </div>
    );
  }

  const name = displayName(row.nickname, row.emoji, row.wallet);

  return (
    <div className={`relative z-[1] flex flex-col items-center ${shape.width}`}>
      <div
        className={`flex size-11 items-center justify-center rounded-full border text-[17px] sm:size-12 ${
          first
            ? "border-[#ccff00] bg-[#1a1f0a]"
            : mine
              ? "border-[#6c7a2a] bg-[#141414]"
              : "border-[#2a2a2a] bg-[#141414]"
        }`}
      >
        {name.emoji ?? (
          // The address's TAIL, matching the `…e501` suffix on the row below.
          // Its head reads as a rank sitting next to the plinth numeral.
          <span className="font-mono text-[11px] tracking-tight text-[#8a8a8a]">
            {row.wallet.slice(-2).toUpperCase()}
          </span>
        )}
      </div>

      {/* Without a nickname `primary` IS the short address, and the copy
          control below already carries it. */}
      {row.nickname ? (
        <p className="mt-2 w-full truncate text-center text-[12px] text-[#ededea]">
          {name.primary}
          {mine && <span className="ml-1.5 font-mono text-[9px] text-[#ccff00]">YOU</span>}
        </p>
      ) : (
        mine && <p className="mt-2 font-mono text-[9px] text-[#ccff00]">YOU</p>
      )}
      <p className="font-mono text-[11px] tabular-nums text-[#ccff00]">
        {formatEth(row.amountWei)} <span className="text-[#6f7a4a]">ETH</span>
      </p>
      <div className="mb-2 flex max-w-full flex-col items-center gap-1">
        <WalletCopy wallet={row.wallet} short={name.secondary ?? name.primary} />
        <SocialIcons socials={row.socials} />
      </div>

      <div
        className={`relative w-full overflow-hidden rounded-t-lg ${shape.height}`}
        style={{
          background: first
            ? "linear-gradient(180deg,#2b3312 0%,#171a0c 62%,#101207 100%)"
            : "linear-gradient(180deg,#1f1f1f 0%,#141414 62%,#0e0e0e 100%)",
          boxShadow: [
            `inset 0 1px 0 ${first ? "rgba(204,255,0,0.34)" : "rgba(255,255,255,0.10)"}`,
            "inset -1px 0 0 rgba(0,0,0,0.6)",
            "inset 1px 0 0 rgba(255,255,255,0.03)",
            "0 22px 34px -20px rgba(0,0,0,0.95)",
          ].join(","),
        }}
      >
        <span
          className={`absolute inset-x-0 top-2 text-center font-cinzel text-[26px] font-black leading-none sm:text-[32px] ${
            first ? "text-[#ccff00]" : "text-[#3a3a3a]"
          }`}
        >
          {rank}
        </span>
      </div>
    </div>
  );
}
