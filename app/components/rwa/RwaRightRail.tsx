"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Flame,
  Globe,
  Maximize2,
  MoreHorizontal,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import type { PlanView } from "@/lib/swap/types";
import type { FeedRow } from "@/lib/trade/trade-feed";
import type { TokenRecord } from "@/lib/types";
import type { TimeframePeriod, TokenMarketData } from "@/lib/trade/types";
import type { EquityBasisView } from "@/lib/market/equity-basis";
import { getTimeframeMetrics } from "@/lib/trade/types";
import { countText, pctText } from "@/lib/trade/format";
import { toast } from "@/components/ui/use-toast";
import { PriceAlertModal } from "@/app/components/trade/PriceAlertModal";
import { RwaIcon } from "@/app/components/site/RwaPageClient";
import { TerminalAssistant } from "@/app/components/agent/TerminalAssistant";
import type { TerminalAssistantActions } from "@/app/components/agent/TerminalAssistant";
import { RwaMarketBriefCard } from "@/app/components/rwa/RwaMarketBriefCard";
import type { TerminalMarketFreshness } from "@/lib/trade/useTerminalMarket";
import { explorerWebUrl } from "@/lib/config/chain";

function XTwitterIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function truncateAddress(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export interface RwaRightRailProps {
  token: TokenMarketData;
  freshness?: TerminalMarketFreshness;
  lastUpdatedAt?: number | null;
  quote?: PlanView | null;
  transactions?: FeedRow[];
  asset: {
    address: string;
    asset_name: string;
    asset_symbol: string;
    category: string;
  };
  proof: {
    ok: boolean;
    status?: "ok" | "failed" | "unprobeable";
    reason: string;
    evidence: Record<string, unknown>;
  };
  record?: TokenRecord | null;
  tvSymbol?: string | null;
  equityBasisView?: EquityBasisView | null;
  onOpenTrade: (initialMode?: "buy" | "sell") => void;
}

export function RwaRightRail({
  token,
  freshness,
  lastUpdatedAt,
  quote,
  transactions,
  asset,
  proof,
  record = null,
  tvSymbol = null,
  equityBasisView,
  onOpenTrade,
}: RwaRightRailProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframePeriod>("24h");
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [activeAlert, setActiveAlert] = useState<{ target: number; direction: "above" | "below" } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isSecurityExpanded, setIsSecurityExpanded] = useState(true);
  const [canDiscussNews, setCanDiscussNews] = useState(false);
  const [agentActionsReady, setAgentActionsReady] = useState(false);
  const agentActions = useRef<TerminalAssistantActions | null>(null);
  const registerAgentActions = useCallback((actions: TerminalAssistantActions | null) => {
    agentActions.current = actions;
    setAgentActionsReady(Boolean(actions));
    setCanDiscussNews(actions?.canDiscuss ?? false);
  }, []);
  const proofStatus = proof.status ?? (proof.ok ? "ok" : "failed");
  const proofIsValid = proofStatus === "ok";
  const proofUnavailable = proofStatus === "unprobeable";

  const beaconAddr = (proof.evidence?.beacon as string) ?? "0xe10b6f6b275de231345c20d14ab812db62151b00";
  const implAddr = (proof.evidence?.implementation as string) ?? (proof.evidence?.impl as string) ?? "0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2";
  const pairAddress = token.pairAddress && token.pairAddress !== token.address ? token.pairAddress : null;

  // Load saved alert from localStorage on mount
  useEffect(() => {
    try {
      const storedAlerts = localStorage.getItem(`robincalls_alert_${token.address.toLowerCase()}`);
      if (storedAlerts) {
        setActiveAlert(JSON.parse(storedAlerts));
      }
    } catch {
      // Ignore
    }
  }, [token.address]);

  // Price alert monitor
  useEffect(() => {
    if (!activeAlert) return;

    const currentPrice = token.priceUsd;
    const isTriggered =
      (activeAlert.direction === "above" && currentPrice >= activeAlert.target) ||
      (activeAlert.direction === "below" && currentPrice <= activeAlert.target);

    if (isTriggered) {
      toast({
        variant: "warning",
        title: "🔔 Price Alert Triggered!",
        description: `${token.symbol} reached target price of $${activeAlert.target.toFixed(4)} (current: $${currentPrice.toFixed(4)}).`,
      });

      setActiveAlert(null);
      try {
        localStorage.removeItem(`robincalls_alert_${token.address.toLowerCase()}`);
      } catch {
        // Ignore
      }
    }
  }, [activeAlert, token.priceUsd, token.symbol, token.address]);

  const handleSetAlert = (targetPrice: number, direction: "above" | "below") => {
    const alertData = { target: targetPrice, direction };
    setActiveAlert(alertData);
    try {
      localStorage.setItem(`robincalls_alert_${token.address.toLowerCase()}`, JSON.stringify(alertData));
    } catch {
      // Ignore
    }

    toast({
      variant: "success",
      title: "Price Alert Active",
      description: `Tracking ${token.symbol} ${direction} $${targetPrice.toFixed(4)}. We'll alert you!`,
    });
  };

  const handleCopy = (key: string, value: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    }
  };

  const currentMetrics = getTimeframeMetrics(token, selectedTimeframe);
  const activeTxnsTotal = currentMetrics.txns.total || 1;
  const activeBuyTxnPct = Math.min(
    100,
    Math.max(0, Math.round((currentMetrics.txns.buys / activeTxnsTotal) * 100))
  );
  const hasTxnBreakdown = currentMetrics.txns.total > 0
    && [currentMetrics.txns.total, currentMetrics.txns.buys, currentMetrics.txns.sells].every(Number.isFinite);

  const formatUsd = (num: number) => {
    if (!Number.isFinite(num)) return "—";
    if (!num) return "$0";
    if (num >= 1000000) return `$${(num / 1000000).toFixed(num >= 10000000 ? 1 : 2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
    return `$${num.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  };

  return (
    // Phones: `contents` flattens the rail into RwaDetailClient's column; `order` puts identity
    // above the charts and the buy/sell panel right below them (same as TradingRightRail).
    <div className="font-mono text-xs max-lg:contents lg:flex lg:flex-col lg:gap-3">
      {/* 1. Token Header Card: one card on desktop, identity and links split on phones */}
      <div className="max-lg:contents lg:rounded-xl lg:border lg:border-[#242827] lg:bg-[#0e100f] lg:p-3 lg:shadow-md">
        <div className="max-lg:order-first max-lg:rounded-xl max-lg:border max-lg:border-[#242827] max-lg:bg-[#0e100f] max-lg:p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <RwaIcon symbol={asset.asset_symbol} className="size-9" />
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="font-bold text-sm text-white tracking-tight">{asset.asset_name}</h2>
                <span className="rounded bg-[#ccff00]/20 px-1 py-0.2 text-[9px] font-bold text-[#ccff00]">
                  RWA
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[#f0f0f0]">
                <span>{token.pairSymbol || `${asset.asset_symbol} / ${token.quoteToken.symbol}`}</span>
                <span className="text-[#8fbf6a] font-bold uppercase">{asset.category}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[#f0f0f0]">
            <button
              type="button"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: asset.asset_name, url: window.location.href });
                } else {
                  handleCopy("share", window.location.href);
                }
              }}
              title="Share"
              className="rounded p-1 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Share2 className="size-3.5" />
            </button>
            <Link
              href={`/scan/${asset.address}`}
              title="Run Audit Scan"
              className="rounded p-1 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Search className="size-3.5" />
            </Link>
          </div>
        </div>

        {/* Chain & Authenticity status tags */}
        <div className="mt-2.5 flex items-center justify-between text-[10px] border-t border-[#1a1a1a] pt-2">
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded bg-[#161616] px-2 py-0.5 text-[#ccff00] font-medium border border-[#2a2a2a]">
              <span className="size-1.5 rounded-full bg-[#ccff00]" />
              Robinhood Chain (4663)
            </span>
          </div>
          <span
            className={`flex items-center gap-1 rounded px-2 py-0.5 font-bold ${
              proofIsValid
                ? "bg-[#16290f] text-[#ccff00] border border-[#274817]"
                : proofUnavailable
                  ? "bg-[#1a1a1a] text-[#b4b4b4] border border-[#333]"
                  : "bg-[#291310] text-[#e0897a] border border-[#52221b]"
            }`}
          >
            <span className={`size-1.5 rounded-full ${proofIsValid ? "bg-[#ccff00]" : proofUnavailable ? "bg-[#8a8a8a]" : "bg-[#e0897a]"}`} />
            {proofIsValid ? "AUTHENTIC RWA" : proofUnavailable ? "CHECK UNAVAILABLE" : "REVIEW REQUIRED"}
          </span>
        </div>

        </div>

        {/* Quick Links Row */}
        <div className="max-lg:order-2 lg:mt-2 grid grid-cols-2 gap-1.5">
          <a
            href={`${explorerWebUrl}/token/${asset.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md border border-[#222222] bg-[#141414] py-1.5 text-[11px] text-white hover:bg-[#1a1a1a] hover:border-[#333] transition-colors"
          >
            <Globe className="size-3 text-[#f0f0f0]" />
            <span>Explorer</span>
            <ExternalLink className="size-2.5 text-[#f0f0f0]" />
          </a>
          <a
            href={`https://x.com/search?q=%24${asset.asset_symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md border border-[#222222] bg-[#141414] py-1.5 text-[11px] text-white hover:bg-[#1a1a1a] hover:border-[#333] transition-colors"
          >
            <XTwitterIcon className="size-3 text-[#f0f0f0]" />
            <span>Twitter ▾</span>
          </a>
        </div>
      </div>

      {/* 2. Price Row */}
      <div className="grid grid-cols-2 gap-2 max-lg:order-2">
        <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-2.5">
          <div className="text-[10px] text-[#9ca4a0] font-semibold uppercase tracking-wider">ON-CHAIN PRICE</div>
          <div className="text-base font-bold text-[#ccff00] mt-0.5 tracking-tight">
            {token.priceUsd > 0 ? `$${token.priceUsd.toFixed(2)}` : "—"}
          </div>
          <p role="status" className="mt-1 text-[10px] leading-relaxed text-[#c4c8c6]">
            {freshness === "stale" ? "Price update unavailable"
              : freshness === "live" && lastUpdatedAt ? `Updated ${new Date(lastUpdatedAt).toISOString().slice(11, 19)} UTC`
              : token.priceUsd > 0 ? "Saved price · checking…" : "Price unavailable"}
          </p>
        </div>
        <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-2.5">
          <div className="text-[10px] text-[#9ca4a0] font-semibold uppercase tracking-wider">BENCHMARK</div>
          <div className="text-xs font-semibold text-white mt-1 truncate">
            {tvSymbol ? `${tvSymbol} / USD` : `${asset.asset_symbol} Stock`}
          </div>
        </div>
      </div>

      {/* 3. Valuation Row */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#242827] bg-[#0e100f] p-2.5 text-center max-lg:order-2">
        <div>
          <div className="text-[9px] text-[#9ca4a0] font-semibold uppercase">LIQUIDITY</div>
          <div className="text-xs font-bold text-white mt-0.5">
            {formatUsd(token.liquidityUsd)}
          </div>
        </div>
        <div className="border-x border-[#1a1a1a]">
          <div className="text-[9px] text-[#9ca4a0] font-semibold uppercase">FDV</div>
          <div className="text-xs font-bold text-white mt-0.5">
            {formatUsd(token.fdv)}
          </div>
        </div>
        <div>
          <div className="text-[9px] text-[#9ca4a0] font-semibold uppercase">24H VOL</div>
          <div className="text-xs font-bold text-white mt-0.5">
            {formatUsd(token.volume24h)}
          </div>
        </div>
      </div>

      {/* 4. Interactive Timeframe Filter Buttons */}
      <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-2.5 space-y-3 max-lg:order-1">
        <div className="grid grid-cols-4 gap-1 text-center">
          {(
            [
              { id: "5m", label: "5M", val: token.priceChange.m5 },
              { id: "1h", label: "1H", val: token.priceChange.h1 },
              { id: "6h", label: "6H", val: token.priceChange.h6 },
              { id: "24h", label: "24H", val: token.priceChange.h24 },
            ] as const
          ).map((t) => {
            const isSelected = selectedTimeframe === t.id;
            const isPos = !Number.isFinite(t.val) || t.val >= 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTimeframe(t.id)}
                className={`rounded-lg py-1.5 px-1 border transition-all cursor-pointer ${
                  isSelected
                    ? "border-white bg-[#1a1a1a] shadow-sm"
                    : "border-[#1e1e1e] bg-[#101010] hover:border-[#333] hover:bg-[#141414]"
                }`}
              >
                <div className={`text-[10px] ${isSelected ? "text-white font-bold" : "text-[#f0f0f0]"}`}>
                  {t.label}
                </div>
                <div
                  className={`text-[11px] font-bold mt-0.5 ${
                    isPos ? "text-[#8fbf6a]" : "text-[#e0897a]"
                  }`}
                >
                  {pctText(t.val, 1)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Dynamic Metric Rows */}
        <div className="space-y-2.5 pt-1 border-t border-[#1a1a1a]">
          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-white font-semibold">
                TXNS <span className="text-white font-bold">{countText(currentMetrics.txns.total)}</span>
              </span>
              <span className="text-[#8fbf6a]">BUYS {countText(currentMetrics.txns.buys)}</span>
              <span className="text-[#e0897a]">SELLS {countText(currentMetrics.txns.sells)}</span>
            </div>
            <div className={`h-1.5 w-full rounded-full overflow-hidden flex ${hasTxnBreakdown ? "bg-[#a03830]" : "bg-[#262a28]"}`}>
              <div
                className="h-full bg-[#30a050] transition-all duration-300"
                style={{ width: `${hasTxnBreakdown ? activeBuyTxnPct : 0}%` }}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between text-[11px] mb-1">
              <span className="text-white font-semibold">
                VOLUME <span className="text-white font-bold">{formatUsd(currentMetrics.volume.totalUsd)}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons: Buy / Sell & Alert */}
        <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-[#1a1a1a]">
          <button
            type="button"
            onClick={() => onOpenTrade("buy")}
            className="flex items-center justify-center gap-1 rounded-lg bg-[#30a050] hover:bg-[#38b55c] py-2 text-xs font-bold text-white transition-colors cursor-pointer shadow-sm"
          >
            <span>Buy</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenTrade("sell")}
            className="flex items-center justify-center gap-1 rounded-lg bg-[#a03830] hover:bg-[#b54038] py-2 text-xs font-bold text-white transition-colors cursor-pointer shadow-sm"
          >
            <span>Sell</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAlertModalOpen(true)}
            className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs transition-colors cursor-pointer ${
              activeAlert
                ? "border-[#ccff00] bg-[#1a220a] text-[#ccff00] font-bold"
                : "border-[#222222] bg-[#141414] text-[#f0f0f0] hover:text-white hover:border-[#333]"
            }`}
          >
            <Bell className="size-3.5" />
            <span>{activeAlert ? "Active" : "Alerts"}</span>
          </button>
        </div>
      </div>

      {equityBasisView && (() => {
        const referencePrice = equityBasisView.referencePriceUsd;
        const status = {
          unavailable: "UNAVAILABLE",
          halted: "HALTED",
          stale: "STALE",
          live: "LIVE",
          "no-pool": "NO POOL",
          "market-unavailable": "MARKET UNAVAILABLE",
        }[equityBasisView.referenceStatus];
        const premium = equityBasisView.premiumBps;
        const delta = premium == null ? null : `${premium > 0 ? "+" : premium < 0 ? "−" : ""}${(Math.abs(premium) / 100).toFixed(2)}%`;
        return (
          <div className={`rounded-xl border px-3 py-2.5 ${equityBasisView.tone === "warn" ? "border-[#66521a] bg-[#17150d]" : "border-[#242827] bg-[#0e100f]"}`}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#a7aaa5]">Reference price</span>
              <span className={`text-[10px] font-semibold ${equityBasisView.tone === "warn" ? "text-[#d9c96a]" : "text-[#8fbf6a]"}`}>
                {status}{delta && equityBasisView.referenceStatus === "live" ? ` · ${delta} on chain` : ""}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-base font-bold tracking-tight text-white">
                {referencePrice == null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(referencePrice)}
              </span>
              <span className="truncate text-[10px] text-[#a7aaa5]">{asset.asset_symbol} · Robinhood{equityBasisView.referenceTime ? ` · snapshot ${equityBasisView.referenceTime}` : ""}</span>
            </div>
            {(equityBasisView.shareRatio || equityBasisView.pendingCorporateAction) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-[#b4b4b4]">
                {equityBasisView.shareRatio && <span>1 token = {equityBasisView.shareRatio} shares</span>}
                {equityBasisView.pendingCorporateAction && <span className="text-[#d9c96a]">Ratio change pending</span>}
              </div>
            )}
          </div>
        );
      })()}

      {/* News gets its own surface, outside the assistant transcript. */}
      <section className="max-lg:order-1 space-y-2.5">
        <RwaMarketBriefCard
          kind="rwa"
          address={asset.address}
          chainId={4663}
          symbol={asset.asset_symbol}
          name={asset.asset_name}
          canDiscuss={canDiscussNews}
          actionsEnabled={agentActionsReady}
          onConnect={() => agentActions.current?.connect()}
          onAskAgent={(prompt) => agentActions.current?.ask(prompt)}
        />
        <button
          type="button"
          disabled={!agentActionsReady}
          onClick={() => {
            const actions = agentActions.current;
            if (!actions) return;
            if (!actions.canDiscuss) {
              actions.connect();
              return;
            }
            actions.ask(`Review the recent issuer news for ${asset.asset_name} (${asset.asset_symbol}). Summarize the confirmed developments, explain any supported connection to the token's backing or market price, and cite the strongest sources. Be clear when no direct connection is established.`);
          }}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#51429a] bg-gradient-to-r from-[#211b38] via-[#171426] to-[#101014] px-3.5 py-3 text-left text-sm font-semibold text-[#eee8ff] shadow-[0_8px_24px_rgba(73,49,157,0.14)] transition hover:border-[#8b74e8] hover:from-[#292044] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a994ff] disabled:cursor-wait disabled:opacity-60"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#7962d5]/20 text-[#baaaff]">
              <Bot className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block">Ask Robin Knight</span>
              <span className="mt-0.5 block text-[11px] font-normal text-[#b4a9d6]">{canDiscussNews ? "Review these catalysts with the issuer context" : "Connect a key to start the conversation"}</span>
            </span>
          </span>
          <span aria-hidden="true" className="shrink-0 text-base text-[#baaaff]">→</span>
        </button>
      </section>

      {/* 5. Contract Addresses & Infrastructure Section (Relocated to Right Rail) */}
      <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-3 space-y-2 text-xs max-lg:order-2">
        <div className="flex items-center justify-between pb-1 border-b border-[#1a1a1a]">
          <span className="font-bold text-white text-[11px] tracking-wide uppercase">
            Contract Infrastructure
          </span>
          <span className="text-[10px] text-[#f0f0f0]">Robinhood Chain</span>
        </div>

        {/* Token Contract */}
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold">Token Contract</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleCopy("token", asset.address)}
              className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-[11px] text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
              title="Copy token address"
            >
              {copiedKey === "token" ? (
                <Check className="size-3 text-[#ccff00]" />
              ) : (
                <Copy className="size-3 text-[#f0f0f0]" />
              )}
              <span>{truncateAddress(asset.address)}</span>
            </button>
            <Link
              href={`/scan/${asset.address}`}
              className="text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
            >
              HLD <ExternalLink className="size-2.5" />
            </Link>
            <a
              href={`${explorerWebUrl}/token/${asset.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
            >
              EXP <ExternalLink className="size-2.5" />
            </a>
          </div>
        </div>

        {/* Beacon Address */}
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold">Robinhood Beacon</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleCopy("beacon", beaconAddr)}
              className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-[11px] text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
              title="Copy beacon address"
            >
              {copiedKey === "beacon" ? (
                <Check className="size-3 text-[#ccff00]" />
              ) : (
                <Copy className="size-3 text-[#f0f0f0]" />
              )}
              <span>{truncateAddress(beaconAddr)}</span>
            </button>
            <a
              href={`${explorerWebUrl}/address/${beaconAddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
            >
              EXP <ExternalLink className="size-2.5" />
            </a>
          </div>
        </div>

        {/* Implementation Address */}
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold">Stock Implementation</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleCopy("impl", implAddr)}
              className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-[11px] text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
              title="Copy implementation address"
            >
              {copiedKey === "impl" ? (
                <Check className="size-3 text-[#ccff00]" />
              ) : (
                <Copy className="size-3 text-[#f0f0f0]" />
              )}
              <span>{truncateAddress(implAddr)}</span>
            </button>
            <a
              href={`${explorerWebUrl}/address/${implAddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
            >
              EXP <ExternalLink className="size-2.5" />
            </a>
          </div>
        </div>

        {/* Pool Address if present */}
        {pairAddress && (
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold">DEX Pool</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy("pair", pairAddress)}
                className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-[11px] text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
                title="Copy pair address"
              >
                {copiedKey === "pair" ? (
                  <Check className="size-3 text-[#ccff00]" />
                ) : (
                  <Copy className="size-3 text-[#f0f0f0]" />
                )}
                <span>{truncateAddress(pairAddress)}</span>
              </button>
              <a
                href={`${explorerWebUrl}/address/${pairAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
              >
                EXP <ExternalLink className="size-2.5" />
              </a>
            </div>
          </div>
        )}

        {/* Proof reason disclaimer */}
        <div className="pt-2 border-t border-[#1a1a1a] text-[10px] text-[#f0f0f0] leading-relaxed">
          {proof.reason}
        </div>
      </div>

      {/* 6. The Verdict & The Record Section */}
      <div className="rounded-xl border border-[#242827] bg-[#0e100f] overflow-hidden text-xs max-lg:order-2">
        <button
          type="button"
          onClick={() => setIsSecurityExpanded((v) => !v)}
          className="w-full flex items-center justify-between p-3 bg-[#121212] hover:bg-[#161616] transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-[#ccff00]" />
            <span className="font-bold font-cinzel tracking-wider text-white">THE VERDICT</span>
          </div>

          <div className="flex items-center gap-2">
            {record?.stamps && record.stamps.length > 0 ? (
              <span className="rounded bg-[#ccff00]/15 border border-[#ccff00]/30 px-2 py-0.5 text-[10px] font-bold text-[#ccff00]">
                {record.stamps[0].score}/100 · {record.stamps[0].tier}
              </span>
            ) : proofIsValid ? (
              <span className="rounded bg-[#ccff00]/15 border border-[#ccff00]/30 px-2 py-0.5 text-[10px] font-bold text-[#ccff00]">
                VERIFIED BEACON
              </span>
            ) : (
              <span className="rounded bg-[#1a1a1a] border border-[#333] px-2 py-0.5 text-[10px] text-[#f0f0f0]">
                UNSCANNED
              </span>
            )}
            {isSecurityExpanded ? (
              <ChevronUp className="size-3.5 text-[#f0f0f0]" />
            ) : (
              <ChevronDown className="size-3.5 text-[#f0f0f0]" />
            )}
          </div>
        </button>

        {isSecurityExpanded && (
          <div className="p-3.5 space-y-3.5 border-t border-[#1a1a1a] bg-[#0e0e0e]">
            {/* The Record Stamp Card (Screenshot 2 visual aesthetic) */}
            <div className="flex flex-col items-center justify-center py-2">
              {record?.stamps && record.stamps.length > 0 ? (
                <div
                  className="relative flex flex-col items-center justify-center border-2 border-[#8a8a8a]/40 bg-[#121212] p-4 text-center shadow-lg transition-transform hover:rotate-0"
                  style={{ transform: "rotate(-1.5deg)", width: "165px" }}
                >
                  <span className="absolute -top-2.5 bg-[#0e0e0e] px-2 font-mono text-[9px] font-bold tracking-[0.2em] text-[#f0f0f0]">
                    THIS SCAN
                  </span>
                  <div className="font-cinzel text-4xl font-black leading-none text-white">
                    {record.stamps[0].score}
                  </div>
                  <div className="mt-1 font-cinzel text-xs font-semibold tracking-[0.16em] text-[#ccff00]">
                    {record.stamps[0].tier}
                  </div>
                  <div className="mt-2 font-mono text-[9px] tracking-wider text-[#f0f0f0]">
                    #{record.stamps[0].id} · {record.stamps[0].createdAt ? new Date(record.stamps[0].createdAt).toISOString().slice(0, 10) : "DATE UNAVAILABLE"}
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-[#2a2a2a] px-5 py-3 font-cinzel text-xs tracking-[0.2em] text-[#d4d4d4] -rotate-1">
                  FIRST SCAN ON RECORD
                </div>
              )}
            </div>

            {/* Show only recorded evidence; scan summaries do not include individual checks. */}
            <div className="space-y-1.5 pt-1 border-t border-[#1a1a1a]">
              <div className="text-[10px] uppercase tracking-wider text-white font-bold">
                RWA Verification Highlights
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                <div className="col-span-2 flex items-center justify-between rounded bg-[#141414] border border-[#202020] px-2 py-1">
                  <span className="text-[#f0f0f0]">Issuer beacon proof</span>
                  <span className={`font-bold ${proofIsValid ? "text-[#ccff00]" : proofUnavailable ? "text-[#b4b4b4]" : "text-[#e0897a]"}`}>
                    {proofIsValid ? "VERIFIED" : proofUnavailable ? "UNAVAILABLE" : "NOT VERIFIED"}
                  </span>
                </div>
                <div className="col-span-2 flex items-center justify-between rounded bg-[#141414] border border-[#202020] px-2 py-1">
                  <span className="text-[#f0f0f0]">Scanner record</span>
                  <span className="font-bold text-[#b4b4b4]">
                    {record?.stamps && record.stamps.length > 0 ? `${record.totalCount} SCAN${record.totalCount === 1 ? "" : "S"} RECORDED` : "NO SCAN RECORDED"}
                  </span>
                </div>
                <div className="col-span-2 flex items-center justify-between rounded bg-[#141414] border border-[#202020] px-2 py-1">
                  <span className="text-[#f0f0f0]">Benchmark Tracking</span>
                  <span className="font-bold text-[#ccff00]">
                    {tvSymbol ? "ACTIVE" : "NOT RESOLVED"}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[#1a1a1a]">
              <Link
                href={`/scan/${asset.address}`}
                className="flex items-center justify-between text-[11px] text-[#ccff00] hover:underline"
              >
                <span>{record?.stamps && record.stamps.length > 0 ? "Inspect Full Bytecode Audit on /scan" : "Run First Scan on /scan"}</span>
                <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* The assistant supplies its own single title; the phone version opens as a full-height sheet. */}
      <div className="overflow-hidden rounded-xl border border-[#242827] bg-[#0e100f] max-lg:order-2">
        <TerminalAssistant
          token={token}
          record={record}
          kind="rwa"
          freshness={freshness}
          lastUpdatedAt={lastUpdatedAt} quote={quote} transactions={transactions}
          chartTimeframe="1h"
          onActionsReady={registerAgentActions}
        />
      </div>

      {/* Price Alert Dialog */}
      <PriceAlertModal
        isOpen={isAlertModalOpen}
        onClose={() => setIsAlertModalOpen(false)}
        token={token}
        onAlertSet={handleSetAlert}
      />
    </div>
  );
}
