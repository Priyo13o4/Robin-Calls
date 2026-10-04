"use client";

import { useEffect, useState } from "react";
import { useLiquidityWatch, utcClock, warnableRemoval } from "@/lib/trade/liquidity-watch";
import {
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Flame,
  Globe,
  Lock,
  MoreHorizontal,
  Rocket,
  Search,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import type { TokenRecord } from "@/lib/types";
import {
  getTimeframeMetrics,
  type TimeframePeriod,
  type TokenMarketData,
} from "@/lib/trade/types";
import { toast } from "@/components/ui/use-toast";
import { buyShare, countText, formatDexPrice, pctText } from "@/lib/trade/format";
import { PriceAlertModal } from "./PriceAlertModal";
import { fetchTradeSecuritySignal, type TradeSecuritySignal } from "./security-signal";
import { explorerWebUrl } from "@/lib/config/chain";
import { isOwnToken } from "@/lib/sale/token";

const CHECK_TONE: Record<string, string> = { FAIL: "text-[#ff8a8a]", WARN: "text-[#eab308]", PASS: "text-[#ccff00]", SKIP: "text-[#bbb]" };

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

export interface TradingRightRailProps {
  token: TokenMarketData;
  record?: TokenRecord | null;
  onOpenTrade: (initialMode?: "buy" | "sell") => void;
}

export function TradingRightRail({ token, record = null, onOpenTrade }: TradingRightRailProps) {
  const ownToken = isOwnToken(token.address);
  // Timeframe filter state (clickable: 5M, 1H, 6H, 24H)
  const [selectedTimeframe, setSelectedTimeframe] = useState<TimeframePeriod>("24h");
  // DexScreener keeps listing a drained pool's old depth for minutes. Only when OUR read of the
  // very pair shown here says it is empty do its figures give way.
  const removal = warnableRemoval(useLiquidityWatch(token.address));
  const drained = removal?.emptied && removal.poolId === token.pairAddress?.toLowerCase() ? removal : null;

  // Functional Price Alert state
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [activeAlert, setActiveAlert] = useState<{ target: number; direction: "above" | "below" } | null>(null);

  // Copy feedback state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Expandable verdict card state
  const [isSecurityExpanded, setIsSecurityExpanded] = useState(true);
  // Real per-check results for the newest scan; keyed by stamp so a new scan re-reads them.
  const stampId = record?.stamps?.[0]?.id ?? null;
  const [checks, setChecks] = useState<{ key: string; signal: TradeSecuritySignal } | null>(null);
  const checksKey = `${token.address.toLowerCase()}:${stampId}`;
  useEffect(() => {
    if (stampId === null) return;
    let live = true;
    void fetchTradeSecuritySignal(token.address).then((signal) => { if (live) setChecks({ key: checksKey, signal }); });
    return () => { live = false; };
  }, [token.address, stampId, checksKey]);
  const checkSignal = checks?.key === checksKey ? checks.signal : null;

  // Load saved alert from localStorage on mount
  useEffect(() => {
    try {
      const storedAlerts = localStorage.getItem(`robincalls_alert_${token.address.toLowerCase()}`);
      if (storedAlerts) {
        setActiveAlert(JSON.parse(storedAlerts));
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [token.address]);

  // Monitor active price alert and trigger browser alert & toast when target reached
  useEffect(() => {
    if (!activeAlert) return;

    const currentPrice = token.priceUsd;
    const isTriggered =
      (activeAlert.direction === "above" && currentPrice >= activeAlert.target) ||
      (activeAlert.direction === "below" && currentPrice <= activeAlert.target);

    if (isTriggered) {
      // RobinCalls custom UI toast only (no browser window.alert)
      toast({
        variant: "warning",
        title: "🔔 Price Alert Triggered!",
        description: `${token.symbol} reached target price of $${activeAlert.target.toFixed(6)} (current: $${currentPrice.toFixed(6)}).`,
      });

      // Clear active alert after triggering so it doesn't loop
      setActiveAlert(null);
      try {
        localStorage.removeItem(`robincalls_alert_${token.address.toLowerCase()}`);
      } catch {
        // Ignore
      }
    }
  }, [activeAlert, token.priceUsd, token.symbol, token.address, token.avatarUrl]);

  // Set alert
  const handleSetAlert = (targetPrice: number, direction: "above" | "below") => {
    const alertData = { target: targetPrice, direction };
    setActiveAlert(alertData);
    try {
      localStorage.setItem(
        `robincalls_alert_${token.address.toLowerCase()}`,
        JSON.stringify(alertData)
      );
    } catch {
      // Ignore
    }

    // Request notification permission if available
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    }

    toast({
      variant: "success",
      title: "Price Alert Set",
      description: `We will alert you when ${token.symbol} crosses $${targetPrice.toFixed(6)}.`,
    });
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast({
        variant: "default",
        title: "Copied to clipboard",
        description: truncateAddress(text),
      });
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2000);
    } catch {
      // Degrade gracefully
    }
  };

  // Get active metrics for the selected timeframe (5m, 1h, 6h, 24h)
  const currentMetrics = getTimeframeMetrics(token, selectedTimeframe);

  const activeBuyPct = buyShare(currentMetrics.txns.buys, currentMetrics.txns.sells);
  const activeBuyVolPct = buyShare(currentMetrics.volume.buyUsd, currentMetrics.volume.sellUsd);
  const activeBuyerPct = buyShare(currentMetrics.traders.buyers, currentMetrics.traders.sellers);

  const formatUsd = (num: number) => {
    if (!Number.isFinite(num)) return "—";
    if (num >= 1000000) return `$${(num / 1000000).toFixed(num >= 10000000 ? 1 : 2)}M`;
    if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
    return `$${num.toLocaleString("en-US")}`;
  };

  return (
    // Phones: `contents` flattens the rail into TradePageClient's column, and the `order`
    // classes place identity above the chart and the buy/sell panel right below it.
    <div className="w-full font-mono max-lg:contents lg:space-y-3">
      {/* 1. Profile Header Card: one card on desktop, identity and artwork split on phones */}
      <div className="max-lg:contents lg:rounded-xl lg:border lg:border-[#242827] lg:bg-[#0e100f] lg:p-3 lg:shadow-lg">
        <div className="max-lg:order-first max-lg:rounded-xl max-lg:border max-lg:border-[#242827] max-lg:bg-[#0e100f] max-lg:p-3">
        <div className="flex items-start justify-between gap-2">
          {/* Token Identification */}
          <div className="flex items-center gap-2.5 min-w-0">
            {token.avatarUrl ? (
              <img
                src={token.avatarUrl}
                alt={token.name}
                className="size-9 rounded-full border border-[#262626] bg-[#141414] object-cover shrink-0"
              />
            ) : (
              <div className="size-9 rounded-full bg-[#161616] border border-[#262626] flex items-center justify-center text-phi-sm shrink-0">
                🪙
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-white text-phi-sm truncate max-w-[140px]">
                  {token.name}
                </span>
                {token.rank && (
                  <span className="rounded bg-[#ccff00]/15 border border-[#ccff00]/40 px-1.5 py-0.2 text-phi-2xs font-bold text-[#ccff00]">
                    #{token.rank}
                  </span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-phi-xs text-[#f0f0f0]">
                <span className="truncate">{token.pairSymbol || `${token.symbol} / ${token.quoteToken.symbol}`}</span>
                <span>·</span>
                <span>{token.age}</span>
              </div>
            </div>
          </div>

          {/* Action icons on top right */}
          <div className="flex items-center gap-1 text-[#f0f0f0]">
            <button
              type="button"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: token.name, url: window.location.href });
                } else {
                  handleCopy("share", window.location.href);
                }
              }}
              title="Share"
              className="rounded p-1 hover:bg-white/10 hover:text-white transition-colors"
            >
              <Share2 className="size-3.5" />
            </button>
            <button
              type="button"
              title="Options"
              className="rounded p-1 hover:bg-white/10 hover:text-white transition-colors"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Chain & Venue tags */}
        <div className="mt-2.5 flex items-center justify-between text-phi-2xs border-t border-[#1a1a1a] pt-2">
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1 rounded bg-[#161616] px-2 py-0.5 text-[#ccff00] font-medium border border-[#2a2a2a]">
              <span className="size-1.5 rounded-full bg-[#ccff00]" />
              Robinhood &gt;
            </span>
            <span className="rounded bg-[#201018] border border-[#441a2a] px-2 py-0.5 text-[#e089a8] font-medium">
              {token.venue}
            </span>
          </div>
          <span className="text-[#f0f0f0]">Age {token.age}</span>
        </div>
        </div>

        <div className="max-lg:order-2 max-lg:rounded-xl max-lg:border max-lg:border-[#242827] max-lg:bg-[#0e100f] max-lg:p-3">
        {/* Visual Artwork Banner (Matching DexScreener live aesthetic) */}
        <div className="relative lg:mt-2.5 h-24 w-full rounded-lg border border-[#1e2e22] overflow-hidden flex items-center justify-center bg-[#070b09]">
          {token.headerUrl ? (
            <img
              src={token.headerUrl}
              alt={`${token.name} Banner`}
              className="absolute inset-0 size-full object-cover opacity-85"
            />
          ) : token.avatarUrl ? (
            <div className="relative size-full flex items-center justify-center bg-[#0c140f]">
              <img
                src={token.avatarUrl}
                alt={`${token.name} Banner`}
                className="absolute inset-0 size-full object-cover opacity-35 blur-[2px] scale-110"
              />
              <img
                src={token.avatarUrl}
                alt={token.name}
                className="relative size-12 rounded-full border border-[#22502c] shadow-[0_0_25px_rgba(204,255,0,0.3)] object-cover"
              />
            </div>
          ) : (
            <div className="relative flex flex-col items-center justify-center">
              <div className="size-12 rounded-full bg-[#0a2814] border border-[#22502c] shadow-[0_0_25px_rgba(204,255,0,0.25)] flex items-center justify-center text-phi-xl">
                🪐
              </div>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0c0c0c]/80 via-transparent to-transparent pointer-events-none" />
        </div>

        {/* Social Links Row */}
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {token.socials.website ? (
            <a
              href={token.socials.website}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-md border border-[#222222] bg-[#141414] py-1.5 text-phi-xs text-white hover:bg-[#1a1a1a] hover:border-[#333] transition-colors"
            >
              <Globe className="size-3 text-[#f0f0f0]" />
              <span>Website</span>
            </a>
          ) : (
            <div className="flex items-center justify-center gap-1.5 rounded-md border border-[#1a1a1a] bg-[#101010] py-1.5 text-phi-xs text-[#888] cursor-not-allowed select-none">
              <Globe className="size-3 text-[#666]" />
              <span>Website</span>
            </div>
          )}
          {token.socials.twitter ? (
            <a
              href={token.socials.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-md border border-[#222222] bg-[#141414] py-1.5 text-phi-xs text-white hover:bg-[#1a1a1a] hover:border-[#333] transition-colors"
            >
              <XTwitterIcon className="size-3 text-[#f0f0f0]" />
              <span>Twitter ▾</span>
            </a>
          ) : (
            <div className="flex items-center justify-center gap-1.5 rounded-md border border-[#1a1a1a] bg-[#101010] py-1.5 text-phi-xs text-[#888] cursor-not-allowed select-none">
              <XTwitterIcon className="size-3 text-[#666]" />
              <span>Twitter</span>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 2. Price Row (Two Cards Matching Screenshot 1) */}
      <div className="grid grid-cols-2 gap-2 max-lg:order-2">
        <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-2.5">
          <div className="text-phi-2xs text-[#9ca4a0] font-semibold uppercase tracking-wider">PRICE USD</div>
          <div className="text-phi-md font-bold text-white mt-0.5 tracking-tight">
            {formatDexPrice(token.priceUsd)}
          </div>
        </div>
        <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-2.5">
          <div className="text-phi-2xs text-[#9ca4a0] font-semibold uppercase tracking-wider">PRICE</div>
          <div className="text-phi-xs font-semibold text-[#f0f0f0] mt-1 truncate">
            {token.priceQuote != null && token.priceQuote > 0
              ? `${formatDexPrice(token.priceQuote, { prefix: "" })} ${token.quoteToken.symbol}`
              : "—"}
          </div>
        </div>
      </div>

      {/* 3. Valuation Row (Three Columns Matching Screenshot 1) */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[#242827] bg-[#0e100f] p-2.5 text-center max-lg:order-2">
        <div>
          <div className="text-phi-2xs text-[#9ca4a0] font-semibold uppercase">LIQUIDITY</div>
          <div className={`text-phi-xs font-bold mt-0.5 ${drained ? "text-[#ff6b57]" : "text-white"}`}>
            {drained ? "Removed" : formatUsd(token.liquidityUsd)}
          </div>
        </div>
        <div className="border-x border-[#1a1a1a]">
          <div className="text-phi-2xs text-[#9ca4a0] font-semibold uppercase">FDV</div>
          <div className="text-phi-xs font-bold text-white mt-0.5">
            {drained ? "—" : formatUsd(token.fdv)}
          </div>
        </div>
        <div>
          <div className="text-phi-2xs text-[#9ca4a0] font-semibold uppercase">MKT CAP</div>
          <div className="text-phi-xs font-bold text-white mt-0.5">
            {drained ? "—" : formatUsd(token.marketCap)}
          </div>
        </div>
        {drained && (
          <p className="col-span-3 mt-1 border-t border-[#1a1a1a] pt-1.5 text-left text-phi-2xs leading-4 text-[#f0a494]">
            This pool&apos;s liquidity was removed{drained.atMs === null ? "" : ` at ${utcClock(drained.atMs)}`}. DexScreener still lists ${Math.round(token.liquidityUsd / 1000)}K of liquidity, which is out of date, so the value figures are hidden.
          </p>
        )}
      </div>

      {/* 4. Interactive Timeframe Filter Buttons (Clickable 5M, 1H, 6H, 24H) */}
      <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-2.5 space-y-3 max-lg:order-1">
        {/* The 4 Timeframe Buttons */}
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
                <div className={`text-phi-2xs ${isSelected ? "text-white font-bold" : "text-[#f0f0f0]"}`}>
                  {t.label}
                </div>
                <div
                  className={`text-phi-xs font-bold mt-0.5 ${
                    isPos ? "text-[#8fbf6a]" : "text-[#e0897a]"
                  }`}
                >
                  {pctText(t.val)}
                </div>
              </button>
            );
          })}
        </div>

        {/* Dynamic Metric Rows (Updated by selected timeframe!) */}
        <div className="space-y-2.5 pt-1 border-t border-[#1a1a1a]">
          <MetricRow label="TXNS" total={countText(currentMetrics.txns.total)}
            buyLabel="BUYS" buy={countText(currentMetrics.txns.buys)}
            sellLabel="SELLS" sell={countText(currentMetrics.txns.sells)} buyPct={activeBuyPct} />
          <MetricRow label="VOLUME" total={formatUsd(currentMetrics.volume.totalUsd)}
            buyLabel="BUY VOL" buy={formatUsd(currentMetrics.volume.buyUsd)}
            sellLabel="SELL VOL" sell={formatUsd(currentMetrics.volume.sellUsd)} buyPct={activeBuyVolPct} />
          {/* DexScreener reports no trader counts; the row shows only when something measured them. */}
          {Number.isFinite(currentMetrics.traders.total) && (
            <MetricRow label="TRADERS" total={countText(currentMetrics.traders.total)}
              buyLabel="BUYERS" buy={countText(currentMetrics.traders.buyers)}
              sellLabel="SELLERS" sell={countText(currentMetrics.traders.sellers)} buyPct={activeBuyerPct} />
          )}
        </div>

        {/* Action Buttons: Buy, Sell, Alerts (Matching Screenshot 4) */}
        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#1a1a1a]">
          <button
            type="button"
            onClick={() => onOpenTrade("buy")}
            className="flex items-center justify-center rounded-lg bg-[#30a050] py-2 text-phi-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 cursor-pointer"
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => onOpenTrade("sell")}
            className="flex items-center justify-center rounded-lg bg-[#b53a30] py-2 text-phi-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 cursor-pointer"
          >
            Sell
          </button>
          <button
            type="button"
            onClick={() => setIsAlertModalOpen(true)}
            className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-phi-xs transition-colors cursor-pointer ${
              activeAlert
                ? "border-[#ccff00] bg-[#1a220a] text-[#ccff00] font-bold"
                : "border-[#222222] bg-[#141414] text-[#f0f0f0] hover:text-white hover:border-[#333]"
            }`}
          >
            <Bell className="size-3.5" />
            <span>{activeAlert ? "Alert" : "Alerts"}</span>
          </button>
        </div>
      </div>

      {/* 5. Address & Liquidity Section (Exact Match to Screenshot 2) */}
      <div className="rounded-xl border border-[#242827] bg-[#0e100f] p-3 space-y-2 text-phi-xs max-lg:order-2">
        <div className="flex justify-between text-white font-medium">
          <span>Pair created</span>
          <span className="text-[#f0f0f0] font-medium">{token.age} ago</span>
        </div>

        <div className="flex justify-between text-white font-medium">
          <span>Pooled {token.symbol}</span>
          <span className="text-white font-bold">
            {drained ? "Removed" : <>{Number.isFinite(token.pooled.baseAmount) ? token.pooled.baseAmount.toLocaleString("en-US") : "—"}{" "}
            <span className="text-[#d4d4d4] font-normal">{Number.isFinite(token.pooled.baseUsd) ? `$${Math.round(token.pooled.baseUsd / 1000)}K` : ""}</span></>}
          </span>
        </div>

        <div className="flex justify-between text-white font-medium">
          <span>Pooled {token.quoteToken.symbol}</span>
          <span className="text-white font-bold">
            {drained ? "Removed" : <>{Number.isFinite(token.pooled.quoteAmount) ? token.pooled.quoteAmount.toLocaleString("en-US") : "—"}{" "}
            <span className="text-[#d4d4d4] font-normal">{Number.isFinite(token.pooled.quoteUsd) ? `$${Math.round(token.pooled.quoteUsd / 1000)}K` : ""}</span></>}
          </span>
        </div>

        {/* Address Lines with copy buttons and EXP / HLD links */}
        <div className="pt-2 border-t border-[#1a1a1a] space-y-1.5">
          {/* Pair Address */}
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold">Pair</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy("pair", token.pairAddress)}
                className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-phi-xs text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
                title="Copy pair address"
              >
                {copiedKey === "pair" ? (
                  <Check className="size-3 text-[#ccff00]" />
                ) : (
                  <Copy className="size-3 text-[#f0f0f0]" />
                )}
                <span>{truncateAddress(token.pairAddress)}</span>
              </button>
              <a
                href={`${explorerWebUrl}/address/${token.pairAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-phi-2xs text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
              >
                EXP <ExternalLink className="size-2.5" />
              </a>
            </div>
          </div>

          {/* Base Token Address */}
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold">{token.symbol}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy("token", token.address)}
                className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-phi-xs text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
                title="Copy token address"
              >
                {copiedKey === "token" ? (
                  <Check className="size-3 text-[#ccff00]" />
                ) : (
                  <Copy className="size-3 text-[#f0f0f0]" />
                )}
                <span>{truncateAddress(token.address)}</span>
              </button>
              <Link
                href={`/scan/${token.address}`}
                className="text-phi-2xs text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
              >
                HLD <ExternalLink className="size-2.5" />
              </Link>
              <a
                href={`${explorerWebUrl}/token/${token.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-phi-2xs text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
              >
                EXP <ExternalLink className="size-2.5" />
              </a>
            </div>
          </div>

          {/* Quote Token Address */}
          <div className="flex items-center justify-between">
            <span className="text-white font-semibold">{token.quoteToken.symbol}</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleCopy("quote", token.quoteToken.address)}
                className="flex items-center gap-1 rounded bg-[#161616] border border-[#262626] px-2 py-0.5 font-mono text-phi-xs text-white hover:bg-[#202020] hover:border-[#444] transition-colors"
                title="Copy quote token address"
              >
                {copiedKey === "quote" ? (
                  <Check className="size-3 text-[#ccff00]" />
                ) : (
                  <Copy className="size-3 text-[#f0f0f0]" />
                )}
                <span>{truncateAddress(token.quoteToken.address)}</span>
              </button>
              <Link
                href={`/scan/${token.quoteToken.address}`}
                className="text-phi-2xs text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
              >
                HLD <ExternalLink className="size-2.5" />
              </Link>
              <a
                href={`${explorerWebUrl}/token/${token.quoteToken.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-phi-2xs text-[#f0f0f0] hover:text-[#ccff00] transition-colors flex items-center gap-0.5"
              >
                EXP <ExternalLink className="size-2.5" />
              </a>
            </div>
          </div>
        </div>

        {/* Search on Twitter and Other Pairs buttons */}
        <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-[#1a1a1a]">
          <a
            href={`https://x.com/search?q=%24${token.symbol}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 rounded-md border border-[#222222] bg-[#141414] py-1.5 text-phi-2xs text-white font-medium hover:bg-[#1a1a1a] transition-colors"
          >
            <XTwitterIcon className="size-3 text-[#f0f0f0]" />
            <span>Search on Twitter</span>
          </a>
          <Link
            href={`/night-market?q=${token.symbol}`}
            className="flex items-center justify-center gap-1 rounded-md border border-[#222222] bg-[#141414] py-1.5 text-phi-2xs text-white font-medium hover:bg-[#1a1a1a] transition-colors"
          >
            <Search className="size-3 text-[#f0f0f0]" />
            <span>Other pairs</span>
          </Link>
        </div>
      </div>

      {/* 6. The Verdict & The Record Section */}
      <div className="rounded-xl border border-[#242827] bg-[#0e100f] overflow-hidden text-phi-xs max-lg:order-2">
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
              <span className="rounded bg-[#ccff00]/15 border border-[#ccff00]/30 px-2 py-0.5 text-phi-2xs font-bold text-[#ccff00]">
                {ownToken ? "NOT SCORED" : `${record.stamps[0].score}/100 · ${record.stamps[0].tier}`}
              </span>
            ) : (
              <span className="rounded bg-[#1a1a1a] border border-[#333] px-2 py-0.5 text-phi-2xs text-[#f0f0f0]">
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
                  <span className="absolute -top-2.5 bg-[#0e0e0e] px-2 font-mono text-phi-2xs font-bold tracking-[0.2em] text-[#f0f0f0]">
                    THIS SCAN
                  </span>
                  <div className="font-cinzel text-4xl font-black leading-none text-white">
                    {ownToken ? "OURS" : record.stamps[0].score}
                  </div>
                  <div className="mt-1 font-cinzel text-phi-xs font-semibold tracking-[0.16em] text-[#ccff00]">
                    {ownToken ? "NOT SCORED" : record.stamps[0].tier}
                  </div>
                  <div className="mt-2 font-mono text-phi-2xs tracking-wider text-[#f0f0f0]">
                    #{record.stamps[0].id} · {record.stamps[0].createdAt ? new Date(record.stamps[0].createdAt).toISOString().slice(0, 10) : "—"}
                  </div>
                </div>
              ) : (
                <div className="border-2 border-dashed border-[#2a2a2a] px-5 py-3 font-cinzel text-phi-xs tracking-[0.2em] text-[#d4d4d4] -rotate-1">
                  FIRST SCAN ON RECORD
                </div>
              )}
            </div>

            {/* Check Highlights: Only shown when a scan is recorded */}
            {record?.stamps && record.stamps.length > 0 ? (
              <div className="space-y-1.5 pt-1 border-t border-[#1a1a1a]">
                <div className="text-phi-2xs uppercase tracking-wider text-white font-bold">
                  Audit Highlights
                </div>
                {!checkSignal ? (
                  <p className="text-phi-2xs text-[#bbb]">Loading this scan&apos;s results...</p>
                ) : checkSignal.kind !== "verdict" ? (
                  <p className="text-phi-2xs text-[#ffc2c2]">This scan&apos;s check results could not be loaded. Open the full verdict to see them.</p>
                ) : (
                  <div className="space-y-1.5 text-phi-2xs">
                    {[
                      ...(checkSignal.honeypot ? [{ id: "honeypot", name: "Honeypot", status: checkSignal.honeypot.status.toUpperCase(), reason: checkSignal.honeypot.reason }] : []),
                      ...(checkSignal.highlights ?? []),
                    ].map((c) => (
                      <div key={c.id} title={c.reason} className="flex items-center justify-between gap-2 rounded bg-[#141414] border border-[#202020] px-2 py-1">
                        <span className="truncate text-[#f0f0f0]">{c.name}</span>
                        <span className={`shrink-0 font-bold ${CHECK_TONE[c.status] ?? "text-[#bbb]"}`}>{c.status}</span>
                      </div>
                    ))}
                    <p className="text-[#999]">Failed and warning checks from this scan, plus LP custody. Every other check is in the full verdict.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="pt-2 text-center text-phi-xs text-[#f0f0f0] border-t border-[#1a1a1a]">
                No scan on record yet. Run a scan to verify contract safety & exit simulation.
              </div>
            )}

            <div className="pt-2 border-t border-[#1a1a1a]">
              <Link
                href={`/scan/${token.address}`}
                className="flex items-center justify-between text-phi-xs text-[#ccff00] hover:underline"
              >
                <span>{record?.stamps && record.stamps.length > 0 ? "Inspect Full Verdict on /scan" : "Run First Scan on /scan"}</span>
                <ExternalLink className="size-3" />
              </Link>
            </div>
          </div>
        )}
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

/** Label over value in three justified columns, so a long figure never wraps into its neighbour. */
function MetricRow({ label, total, buyLabel, buy, sellLabel, sell, buyPct }: {
  label: string; total: string; buyLabel: string; buy: string; sellLabel: string; sell: string; buyPct: number | null;
}) {
  return (
    <div>
      <div className="mb-1.5 grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <div className="text-phi-2xs tracking-[0.08em] text-[#8c928c]">{label}</div>
          <div className="truncate text-phi-sm font-bold tabular-nums text-white">{total}</div>
        </div>
        <div className="min-w-0 text-center">
          <div className="text-phi-2xs tracking-[0.08em] text-[#8fbf6a]/80">{buyLabel}</div>
          <div className="truncate text-phi-sm tabular-nums text-[#8fbf6a]">{buy}</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-phi-2xs tracking-[0.08em] text-[#e0897a]/80">{sellLabel}</div>
          <div className="truncate text-phi-sm tabular-nums text-[#e0897a]">{sell}</div>
        </div>
      </div>
      <div className={`flex h-1.5 w-full overflow-hidden rounded-full ${buyPct === null ? "bg-[#2a2d2b]" : "bg-[#a03830]"}`}>
        {buyPct !== null && <div className="h-full bg-[#30a050] transition-all duration-300" style={{ width: `${buyPct}%` }} />}
      </div>
    </div>
  );
}
