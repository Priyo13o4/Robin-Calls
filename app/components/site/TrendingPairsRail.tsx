"use client";

import Link from "next/link";
import { TokenIcon } from "./TokenIcon";
import { explorerWebUrl } from "@/lib/config/chain";
import type { TokenMarketData } from "@/lib/trade/types";

const QUOTE_ICON: Record<string, string> = { USDG: "/brand/usdg.svg" };

function Change({ v }: { v: number }) {
  if (!Number.isFinite(v)) return <span className="text-white/60">—</span>;
  const up = v >= 0;
  return (
    <span className="text-white">
      <span className={up ? "text-[#8fbf6a]" : "text-[#ff5c5c]"}>{up ? "▲" : "▼"}</span> {Math.abs(v).toFixed(1)}%
    </span>
  );
}

function Pair({ t, hidden }: { t: TokenMarketData; hidden: boolean }) {
  const quote = t.quoteToken?.symbol ?? "";
  const quoteIcon = QUOTE_ICON[quote.toUpperCase()];
  return (
    <Link
      href={`/trade/${t.pairAddress || t.address}`}
      tabIndex={hidden ? -1 : undefined}
      className="flex flex-none items-center gap-2.5 px-6 font-mono text-[12px] tracking-[0.08em] text-white hover:text-[#ccff00]"
    >
      <span className="relative flex flex-none items-center">
        <TokenIcon
          address={t.address}
          symbol={t.symbol}
          explorerUrl={explorerWebUrl}
          metadataUri={t.avatarUrl || null}
          className="size-6 overflow-hidden rounded-full border border-[#262626] bg-[#141414] object-cover"
          fallbackClassName="text-white text-[9px]"
        />
        {quoteIcon && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={quoteIcon} alt="" aria-hidden className="-ml-2 size-4 self-end rounded-full border border-[#0a0a0a] bg-[#0a0a0a]" />
        )}
      </span>
      <span className="font-bold">{t.symbol}</span>
      <span className="text-white/70">/ {quote}</span>
      <Change v={t.priceChange.h1} />
    </Link>
  );
}

/** Replaces the old "coming soon" rail. The list comes from lib/trade/trending.ts, picked on the server. */
export function TrendingPairsRail({ pairs, className = "" }: { pairs: TokenMarketData[]; className?: string }) {
  if (pairs.length === 0) return null;
  const row = (hidden: boolean) => (
    <div aria-hidden={hidden} className="flex flex-none items-center">
      <span className="flex flex-none items-center px-6 font-mono text-[11px] font-bold tracking-[0.22em] text-[#ccff00]">
        TRENDING 1H
      </span>
      {pairs.map((t) => (
        <span key={(t.pairAddress || t.address) + String(hidden)} className="flex flex-none items-center">
          <Pair t={t} hidden={hidden} />
          <span className="text-[#ccff00]">//</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`group overflow-hidden border-y border-[#2a2a2a] bg-[#0a0a0a]/85 py-2.5 ${className}`}>
      <div
        className="flex w-max animate-marquee group-hover:[animation-play-state:paused]"
        style={{ animationDuration: `${Math.max(30, pairs.length * 6)}s` }}
      >
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
