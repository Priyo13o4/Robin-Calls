"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onScanAnnounced } from "@/lib/trade/scan-signal";
import { ArrowLeft, ExternalLink, Flame, Shield, Sparkles, TrendingUp, Zap } from "lucide-react";
import { type TokenMarketData, formatCompactUsd } from "@/lib/trade/types";
import type { TokenRecord } from "@/lib/types";
import type { PlanView } from "@/lib/swap/types";
import type { FeedRow } from "@/lib/trade/trade-feed";
import { useTerminalMarket } from "@/lib/trade/useTerminalMarket";
import { TerminalAssistant } from "@/app/components/agent/TerminalAssistant";
import { DexScreenerEmbed } from "@/app/components/trade/DexScreenerEmbed";
import { TradingRightRail } from "@/app/components/trade/TradingRightRail";
import { LiquidityPullBanner } from "@/app/components/trade/LiquidityPullBanner";
import { TradingTransactionsTable } from "@/app/components/trade/TradingTransactionsTable";
import { TradeOverlayModal } from "@/app/components/trade/TradeOverlayModal";

export interface TradePageClientProps {
  token: TokenMarketData;
  trendingTokens?: TokenMarketData[];
  record?: TokenRecord | null;
}

const RECORD_RECHECK_MS = 30_000;

export function TradePageClient({
  token: initialToken,
  trendingTokens = [],
  record = null,
}: TradePageClientProps) {
  const [quoteContext, setQuoteContext] = useState<PlanView | null>(null);
  const [transactionContext, setTransactionContext] = useState<FeedRow[]>([]);
  const { token: currentToken, freshness, lastUpdatedAt } = useTerminalMarket(initialToken.address, initialToken, { enabled: !initialToken.isBondingCurve, poolSelection: "liquidity" });
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [overlayMode, setOverlayMode] = useState<"buy" | "sell">("buy");

  // A scan finished elsewhere: re-read the server props in place (the live feed keeps its state).
  const router = useRouter();
  const unscanned = !record?.stamps?.length;
  useEffect(() => onScanAnnounced(initialToken.address, () => router.refresh()), [initialToken.address, router]);
  useEffect(() => {
    // Another device or a missed notice: recheck on return to the tab, only while nothing is on record.
    if (!unscanned) return;
    let checkedAt = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== "visible" || Date.now() - checkedAt < RECORD_RECHECK_MS) return;
      checkedAt = Date.now();
      router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [unscanned, router]);

  useEffect(() => { setQuoteContext(null); setTransactionContext([]); }, [initialToken.address]);

  const openTrade = (initialMode: "buy" | "sell" = "buy") => {
    setOverlayMode(initialMode);
    setIsOverlayOpen(true);
  };

  // Use real trending tokens passed from SSR/feed, falling back to currentToken
  const trendingList = trendingTokens && trendingTokens.length > 0
    ? trendingTokens.slice(0, 5)
    : [currentToken];

  return (
    <div className="min-h-screen bg-[#070707] text-[#ededea] font-mono">
      {/* Top Trending Ticker Bar (Matching Screenshot 2 & 3) */}
      <div className="border-b border-[#1c1c1c] bg-[#0c0c0c] px-4 py-2 text-phi-xs flex items-center justify-between overflow-x-auto gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/night-market"
            className="flex items-center gap-1 text-[#f0f0f0] hover:text-[#ccff00] transition-colors pr-3 border-r border-[#222]"
          >
            <ArrowLeft className="size-3.5" />
            <span className="text-phi-xs">Night Market</span>
          </Link>

          <div className="flex items-center gap-1 text-[#ccff00] font-bold text-phi-xs">
            <Flame className="size-3.5" />
            <span title="Most active in the last hour">TRENDING 1H</span>
          </div>

          <div className="flex items-center gap-4">
            {trendingList.map((t, idx) => (
              <Link
                key={t.address}
                href={`/trade/${t.address}`}
                className={`flex items-center gap-1.5 rounded-lg border border-[#202424] bg-[#101312] px-2 py-1 transition-colors ${
                  t.address.toLowerCase() === currentToken.address.toLowerCase()
                    ? "border-[#3a492c] bg-[#151a12] text-[#ccff00] font-bold"
                    : "text-[#f0f0f0] hover:text-white"
                }`}
              >
                <span className="text-[#888888]">#{idx + 1}</span>
                <span>{t.symbol}</span>
                {Number.isFinite(t.priceChange.h1) && (
                  <span className={t.priceChange.h1 >= 0 ? "text-[#8fbf6a]" : "text-[#e0897a]"} title="Price change, last hour">
                    {t.priceChange.h1 >= 0 ? "+" : ""}{t.priceChange.h1.toFixed(0)}% 1h
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-4 text-[#f0f0f0] text-phi-xs shrink-0">
          <div>24H VOLUME: <span className="text-white font-bold">{currentToken.volume24h > 0 ? formatCompactUsd(currentToken.volume24h) : "—"}</span></div>
          <div>CHAIN: <span className="text-[#ccff00] font-bold">ROBINHOOD (4663)</span></div>
        </div>
      </div>

      {/* Main Workspace Split Layout: Reduced side panel width, expanded transaction table */}
      <div className="mx-auto max-w-[1600px] p-3 sm:p-4 lg:p-5">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Left Area: Fixed Chart & Transaction Bar on Desktop */}
          {/* lg: exactly one screen below the top bar (84 px) and above the bottom padding (20 px).
              Chart and transactions split it 3:2, so both resize with the window and neither is clipped. */}
          <div className="max-lg:contents flex-1 min-w-0 flex flex-col gap-3 lg:h-[calc(100dvh-104px)] overflow-hidden">
            <LiquidityPullBanner token={currentToken.address} symbol={currentToken.symbol} />
            <div className="shrink-0 lg:shrink lg:flex-[3] lg:min-h-[300px] lg:flex lg:flex-col">
              <DexScreenerEmbed token={currentToken} />
            </div>

            <div className="max-lg:order-2 flex-1 min-h-[220px] max-h-[380px] lg:max-h-none lg:flex-[2] lg:min-h-[200px] flex flex-col overflow-hidden">
              <TradingTransactionsTable token={currentToken} record={record} onContextRows={setTransactionContext} className="flex-1 min-h-0" />
            </div>
          </div>

          {/* Right Rail: Movable / Scrollable Side Panel with Reduced Width */}
          {/* Phones flatten this rail too (see TradingRightRail): its sections interleave with the chart. */}
          <div className="max-lg:contents w-full lg:w-[350px] xl:w-[365px] shrink-0 no-scrollbar overflow-y-auto lg:max-h-[calc(100dvh-104px)] pr-0.5">
            <TradingRightRail token={currentToken} record={record} onOpenTrade={openTrade} />
            <div className="max-lg:order-2 lg:mt-3 rounded-xl border border-[#242827] bg-[#0e100f] overflow-hidden">
              <TerminalAssistant token={currentToken} record={record} freshness={freshness} lastUpdatedAt={lastUpdatedAt} quote={quoteContext} transactions={transactionContext} />
            </div>
          </div>
        </div>
      </div>

      {/* Trade Overlay Modal (Screenshot 4) */}
      <TradeOverlayModal
        onPlanContext={setQuoteContext}
        isOpen={isOverlayOpen}
        onClose={() => { setIsOverlayOpen(false); setQuoteContext(null); }}
        token={currentToken}
        initialMode={overlayMode}
      />
    </div>
  );
}
