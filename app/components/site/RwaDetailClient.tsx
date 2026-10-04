"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  Flame,
  Globe,
  Maximize2,
  Minimize2,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { TokenRecord } from "@/lib/types";
import type { TokenMarketData } from "@/lib/trade/types";
import type { PlanView } from "@/lib/swap/types";
import type { FeedRow } from "@/lib/trade/trade-feed";
import type { EquityBasisView } from "@/lib/market/equity-basis";
import { useTerminalMarket } from "@/lib/trade/useTerminalMarket";
import { TradingTransactionsTable } from "@/app/components/trade/TradingTransactionsTable";
import { TradeOverlayModal } from "@/app/components/trade/TradeOverlayModal";
import { RwaRightRail } from "@/app/components/rwa/RwaRightRail";
import { isUsableRwaPoolAddress, RwaGeckoChart } from "@/app/components/rwa/RwaGeckoChart";
import { RwaIcon } from "@/app/components/site/RwaPageClient";

export interface TrendingRwaItem {
  address: string;
  asset_name: string;
  asset_symbol: string;
  category: string;
  verify_status?: string;
}

export interface RwaDetailClientProps {
  token: TokenMarketData;
  initialMarketUpdatedAt?: number | null;
  asset: {
    address: string;
    asset_name: string;
    asset_symbol: string;
    category: string;
  };
  proof: {
    ok: boolean;
    status?: "ok" | "failed" | "unprobeable";
    transient?: boolean;
    reason: string;
    evidence: Record<string, unknown>;
  };
  record?: TokenRecord | null;
  verdictText?: string;
  tvSymbol?: string | null;
  equityBasisView?: EquityBasisView | null;
  trendingRwas?: TrendingRwaItem[];
  priceUsd?: string;
  liquidityUsd?: string;
  volume24hUsd?: string;
  fdvUsd?: string;
  buys24h?: number | null;
  sells24h?: number | null;
  poolAddress?: string | null;
}

function TradingViewChartWidget({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: symbol,
      interval: "60",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      save_image: false,
      calendar: false,
      hide_volume: false,
      support_host: "https://www.tradingview.com",
    });

    containerRef.current.appendChild(script);
  }, [symbol]);

  return (
    <div className="tradingview-widget-container h-full w-full" ref={containerRef}>
      <div className="tradingview-widget-container__widget h-full w-full" />
    </div>
  );
}

export function RwaDetailClient({
  token: initialToken,
  initialMarketUpdatedAt = null,
  asset,
  proof,
  record = null,
  verdictText = "Archived RobinCalls verdict available.",
  tvSymbol,
  equityBasisView,
  trendingRwas = [],
}: RwaDetailClientProps) {
  const [quoteContext, setQuoteContext] = useState<PlanView | null>(null);
  const [transactionContext, setTransactionContext] = useState<FeedRow[]>([]);
  const { token: currentToken, freshness, lastUpdatedAt } = useTerminalMarket(initialToken.address, initialToken, {
    enabled: !initialToken.isBondingCurve,
    poolSelection: "liquidity",
    initialUpdatedAt: initialMarketUpdatedAt,
  });
  const [isTradeOverlayOpen, setIsTradeOverlayOpen] = useState(false);
  const [tradeOverlayMode, setTradeOverlayMode] = useState<"buy" | "sell">("buy");

  useEffect(() => { setQuoteContext(null); setTransactionContext([]); }, [initialToken.address]);

  const openTrade = (mode: "buy" | "sell" = "buy") => {
    setTradeOverlayMode(mode);
    setIsTradeOverlayOpen(true);
  };

  const displayTrending = trendingRwas.length > 0 ? trendingRwas.slice(0, 6) : [];

  return (
    <div className="min-h-screen bg-[#070707] text-white font-mono">
      {/* 1. Top Ticker Navigation Bar (Matching Night Market Trade Layout) */}
      <div className="border-b border-[#1c1c1c] bg-[#0c0c0c] px-4 py-2 text-xs flex items-center justify-between overflow-x-auto gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <Link
            href="/rwa"
            className="flex items-center gap-1 text-[#f0f0f0] hover:text-[#ccff00] transition-colors pr-3 border-r border-[#222]"
          >
            <ArrowLeft className="size-3.5" />
            <span className="text-[11px]">All RWAs</span>
          </Link>

          <Link
            href="/night-market"
            className="text-[#f0f0f0] hover:text-white transition-colors text-[11px] pr-3 border-r border-[#222]"
          >
            Night Market
          </Link>

          <div className="flex items-center gap-1 text-[#ccff00] font-bold text-[11px]">
            <Flame className="size-3.5" />
            <span>POPULAR RWAS</span>
          </div>

          <div className="flex items-center gap-4">
            {displayTrending.map((r, idx) => (
              <Link
                key={r.address}
                href={`/rwa/${r.address}`}
                className={`flex items-center gap-1.5 rounded-lg border border-[#202424] bg-[#101312] px-2 py-1 transition-colors ${
                  r.address.toLowerCase() === asset.address.toLowerCase()
                    ? "border-[#3a492c] bg-[#151a12] text-[#ccff00] font-bold"
                    : "text-[#f0f0f0] hover:text-white"
                }`}
              >
                <span className="text-[#d4d4d4]">#{idx + 1}</span>
                <span className="text-white font-medium">{r.asset_symbol}</span>
                <span className="text-[10px] text-[#f0f0f0] uppercase">{r.category}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-4 text-[#f0f0f0] text-[11px] shrink-0">
          <div>
            CHAIN: <span className="text-[#ccff00] font-bold">ROBINHOOD (4663)</span>
          </div>
          <span
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
              proof.ok
                ? "bg-[#16290f] text-[#ccff00] border border-[#274817]"
                : "bg-[#291310] text-[#e0897a] border border-[#52221b]"
            }`}
          >
            <span className={`size-1.5 rounded-full ${proof.ok ? "bg-[#ccff00] animate-pulse" : "bg-[#e0897a]"}`} />
            {proof.ok ? "AUTHENTIC RWA" : proof.status === "unprobeable" || proof.transient ? "CHECK UNAVAILABLE" : "REVIEW REQUIRED"}
          </span>
        </div>
      </div>

      {/* 2. Main Workspace Split Layout */}
      <div className="mx-auto max-w-[1700px] p-3 sm:p-4 lg:h-auto lg:overflow-visible xl:h-[calc(100dvh-2.75rem)] xl:overflow-hidden lg:p-5 [@media(max-height:800px)]:h-auto [@media(max-height:800px)]:min-h-[calc(100dvh-2.75rem)] [@media(max-height:800px)]:overflow-y-auto">
        <div className="flex flex-col gap-3 lg:h-auto lg:min-h-0 lg:flex-row xl:h-full [@media(max-height:800px)]:h-auto">
          {/* Left Workspace Column: Dual Side-by-Side Terminals + Bottom Transactions Table */}
          <div className="max-lg:contents flex-1 min-w-0 flex flex-col gap-3 overflow-hidden lg:h-auto lg:min-h-0 xl:h-full [@media(max-height:800px)]:h-auto">
            {/* Dual Terminals: Kept Side-by-Side As Explicitly Required */}
            <div className="shrink-0 grid grid-cols-1 xl:grid-cols-2 gap-3">
              {/* Terminal 1: On-Chain Market Data (GeckoTerminal Token Price Chart) */}
              <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-3 flex flex-col justify-between shadow-md">
                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[#ccff00]" />
                    <span className="font-bold text-xs text-[#ccff00] tracking-wide uppercase">
                      ON-CHAIN DEX · GECKOTERMINAL
                    </span>
                  </div>
                  {isUsableRwaPoolAddress(currentToken.pairAddress, asset.address) && <a
                    href={`https://www.geckoterminal.com/robinhood/pools/${currentToken.pairAddress}?token_address=${asset.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors shrink-0"
                  >
                    <span>GeckoTerminal</span>
                    <ExternalLink className="size-2.5" />
                  </a>}
                </div>

                <RwaGeckoChart
                  tokenAddress={asset.address}
                  symbol={asset.asset_symbol}
                  poolAddress={currentToken.pairAddress || null}
                />
              </div>

              {/* Terminal 2: Real-World Asset Benchmark (TradingView Stock USD Embed) */}
              <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-3 flex flex-col justify-between shadow-md">
                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-[#1a1a1a]">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[#3b82f6]" />
                    <span className="font-bold text-xs text-white tracking-wide uppercase">
                      REAL-WORLD BENCHMARK · TRADINGVIEW
                    </span>
                  </div>
                  {tvSymbol && (
                    <a
                      href={`https://www.tradingview.com/symbols/${tvSymbol.replace(":", "-")}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors shrink-0"
                    >
                      <span>{tvSymbol}</span>
                      <ExternalLink className="size-2.5" />
                    </a>
                  )}
                </div>

                <div className="relative w-full h-[400px] sm:h-[420px] rounded-lg border border-[#1e1e1e] bg-[#080808] overflow-hidden">
                  {tvSymbol ? (
                    <TradingViewChartWidget symbol={tvSymbol} />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                      <p className="text-sm font-bold text-[#8a8a8a] uppercase tracking-wider">
                        NO US-LISTED BENCHMARK RESOLVED
                      </p>
                      <p className="text-xs text-[#555] max-w-sm leading-relaxed">
                        Underlying ticker could not be resolved to an active US stock listing on TradingView. The live on-chain DEX chart remains authoritative.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Transactions Table & Live RPC Activity */}
            <div className="max-lg:order-2 flex-1 min-h-[220px] flex flex-col overflow-hidden">
              <TradingTransactionsTable
                token={currentToken}
                marketSource="rwa"
                record={record}
                onContextRows={setTransactionContext}
                className="flex-1 min-h-0"
              />
            </div>
          </div>

          {/* Right Rail: RWA Info, Relocated Contract Addresses, and AI Assistant */}
          {/* Phones flatten this rail too (see RwaRightRail): its sections interleave with the charts. */}
          <div className="max-lg:contents w-full lg:w-[360px] xl:w-[380px] shrink-0 overflow-y-auto pr-0.5 scrollbar-thin scrollbar-thumb-[#303532] hover:scrollbar-thumb-[#454b47] lg:h-auto lg:min-h-0 xl:h-full [@media(max-height:800px)]:h-auto [@media(max-height:800px)]:max-h-[calc(100dvh-6rem)]">
            <RwaRightRail
              freshness={freshness}
              lastUpdatedAt={lastUpdatedAt} quote={quoteContext} transactions={transactionContext}
              token={currentToken}
              asset={asset}
              proof={proof}
              record={record}
              tvSymbol={tvSymbol}
              equityBasisView={equityBasisView}
              onOpenTrade={openTrade}
            />
          </div>
        </div>
      </div>

      {/* 3. Trade on RobinCalls Overlay Modal (Using the exact ModernTradingCard Swap UI) */}
      <TradeOverlayModal
        onPlanContext={setQuoteContext}
        isOpen={isTradeOverlayOpen}
        onClose={() => { setIsTradeOverlayOpen(false); setQuoteContext(null); }}
        token={currentToken}
        initialMode={tradeOverlayMode}
        canonicalRwaAddresses={proof.ok && asset?.address ? [asset.address] : undefined}
      />
    </div>
  );
}
