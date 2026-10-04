"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  ExternalLink,
  Flame,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Zap,
} from "lucide-react";
import { NoirShell, PageHeader } from "./NoirShell";
import { CopyAddressChip } from "./CopyAddressChip";
import { RwaIcon } from "./RwaIcon";
import { SmartImage } from "./SmartImage";
import { cdnUrl } from "@/lib/config/cdn";
import { formatCompactUsd, formatTokenPrice } from "@/lib/trade/types";
import type { RwaMarketRow } from "@/app/api/rwa/feed/route";

export type InfraItem = {
  address: string;
  label: string;
  category: string;
};

export interface RwaTerminalClientProps {
  initialTokens: RwaMarketRow[];
  infrastructure: InfraItem[];
}

type SortField =
  | "rank"
  | "symbol"
  | "name"
  | "price"
  | "m5"
  | "h1"
  | "h6"
  | "h24"
  | "volume"
  | "liquidity"
  | "txns";

type SortDirection = "asc" | "desc";

type VolumeFilter = "all" | "10k" | "100k" | "1m";
type LiquidityFilter = "all" | "50k" | "500k" | "1m";

function renderChangeIndicator(val: number | null | undefined) {
  if (val === null || val === undefined || isNaN(val)) {
    return <span className="text-[#666666] font-mono">—</span>;
  }
  const isUp = val >= 0;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 font-mono text-[13px] font-medium ${
        isUp ? "text-[#00ff6a]" : "text-[#ff2e4d]"
      }`}
    >
      <span className="text-[9px] leading-none">{isUp ? "▲" : "▼"}</span>
      <span>{Math.abs(val).toFixed(2)}%</span>
    </span>
  );
}

export function RwaTerminalClient({
  initialTokens = [],
  infrastructure = [],
}: RwaTerminalClientProps) {
  const router = useRouter();

  const [tokens, setTokens] = useState<RwaMarketRow[]>(initialTokens);
  const [activeCategory, setActiveCategory] = useState<"all" | "stock" | "etf" | "gainers">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [authenticOnly, setAuthenticOnly] = useState(false);
  const [volumeFilter, setVolumeFilter] = useState<VolumeFilter>("all");
  const [liquidityFilter, setLiquidityFilter] = useState<LiquidityFilter>("all");
  const [sortField, setSortField] = useState<SortField>("volume");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Poll /api/rwa/feed every 30s when window is visible
  const fetchFeed = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch("/api/rwa/feed");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.tokens) && data.tokens.length > 0) {
        setTokens(data.tokens);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch {
      // Best-effort refresh — keep displayed state
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    const tick = () => {
      if (document.visibilityState === "visible") {
        fetchFeed();
      }
    };

    timer = setInterval(tick, 30_000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fetchFeed]);

  // Aggregate Market Stats
  const marketStats = useMemo(() => {
    let totalVol = 0;
    let totalLiq = 0;
    let activePools = 0;
    let stockCount = 0;
    let etfCount = 0;
    let topGainer: { symbol: string; change: number } | null = null;

    for (const t of tokens) {
      if (t.category === "etf") etfCount++;
      else stockCount++;

      const vol = t.volume24hUsd ?? 0;
      const liq = t.liquidityUsd ?? 0;
      totalVol += vol;
      totalLiq += liq;
      if (vol > 0 || liq > 0) activePools++;

      const h24 = t.changeH24 ?? 0;
      if (h24 > 0 && (!topGainer || h24 > topGainer.change)) {
        topGainer = { symbol: t.asset_symbol, change: h24 };
      }
    }

    return {
      totalTokens: tokens.length,
      stockCount,
      etfCount,
      activePools,
      totalVol,
      totalLiq,
      topGainer,
    };
  }, [tokens]);

  // Filter logic
  const filteredTokens = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return tokens.filter((token) => {
      // Category tab filter
      if (activeCategory === "stock" && token.category === "etf") return false;
      if (activeCategory === "etf" && token.category !== "etf") return false;
      if (activeCategory === "gainers" && (token.changeH24 ?? 0) <= 0) return false;

      // Authentic filter
      if (authenticOnly && !token.trusted) return false;

      // Volume threshold
      const vol = token.volume24hUsd ?? 0;
      if (volumeFilter === "10k" && vol < 10_000) return false;
      if (volumeFilter === "100k" && vol < 100_000) return false;
      if (volumeFilter === "1m" && vol < 1_000_000) return false;

      // Liquidity threshold
      const liq = token.liquidityUsd ?? 0;
      if (liquidityFilter === "50k" && liq < 50_000) return false;
      if (liquidityFilter === "500k" && liq < 500_000) return false;
      if (liquidityFilter === "1m" && liq < 1_000_000) return false;

      // Text search query
      if (q !== "") {
        const matchesSymbol = token.asset_symbol.toLowerCase().includes(q);
        const matchesName = token.asset_name.toLowerCase().includes(q);
        const matchesAddr = token.address.toLowerCase().includes(q);
        if (!matchesSymbol && !matchesName && !matchesAddr) return false;
      }

      return true;
    });
  }, [
    tokens,
    activeCategory,
    authenticOnly,
    volumeFilter,
    liquidityFilter,
    searchQuery,
  ]);

  // Sort logic (NULLS LAST for metrics)
  const sortedTokens = useMemo(() => {
    const list = [...filteredTokens];

    list.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "symbol":
          comparison = a.asset_symbol.localeCompare(b.asset_symbol);
          break;
        case "name":
          comparison = a.asset_name.localeCompare(b.asset_name);
          break;
        case "price": {
          const valA = a.priceUsd ?? -1;
          const valB = b.priceUsd ?? -1;
          comparison = valA - valB;
          break;
        }
        case "m5": {
          const valA = a.changeM5 ?? -9999;
          const valB = b.changeM5 ?? -9999;
          comparison = valA - valB;
          break;
        }
        case "h1": {
          const valA = a.changeH1 ?? -9999;
          const valB = b.changeH1 ?? -9999;
          comparison = valA - valB;
          break;
        }
        case "h6": {
          const valA = a.changeH6 ?? -9999;
          const valB = b.changeH6 ?? -9999;
          comparison = valA - valB;
          break;
        }
        case "h24": {
          const valA = a.changeH24 ?? -9999;
          const valB = b.changeH24 ?? -9999;
          comparison = valA - valB;
          break;
        }
        case "volume": {
          const valA = a.volume24hUsd ?? -1;
          const valB = b.volume24hUsd ?? -1;
          comparison = valA - valB;
          break;
        }
        case "liquidity": {
          const valA = a.liquidityUsd ?? -1;
          const valB = b.liquidityUsd ?? -1;
          comparison = valA - valB;
          break;
        }
        case "txns": {
          const valA = a.trades24h ?? -1;
          const valB = b.trades24h ?? -1;
          comparison = valA - valB;
          break;
        }
        case "rank":
        default:
          comparison = 0;
          break;
      }

      if (comparison === 0) {
        // Secondary sort: volume desc, then symbol asc
        const vA = a.volume24hUsd ?? 0;
        const vB = b.volume24hUsd ?? 0;
        if (vB !== vA) return vB - vA;
        return a.asset_symbol.localeCompare(b.asset_symbol);
      }

      return sortDirection === "desc" ? -comparison : comparison;
    });

    return list;
  }, [filteredTokens, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      // Default to desc for volume, liquidity, price, changes, txns
      if (["volume", "liquidity", "price", "m5", "h1", "h6", "h24", "txns"].includes(field)) {
        setSortDirection("desc");
      } else {
        setSortDirection("asc");
      }
    }
  };

  const handleRowClick = (token: RwaMarketRow) => {
    router.push(`/rwa/${token.address}`);
  };

  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          <SmartImage
            priority
            src={cdnUrl("/backgrounds/rwa-bg.webp")}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-70"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.85) 20%, rgba(10,10,10,0.85) 80%, #0A0A0A 100%)",
            }}
          />
        </div>

        {/* Film grain noise */}
        <div
          className="pointer-events-none fixed inset-0 z-[1] opacity-[0.055]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E\")",
            backgroundRepeat: "repeat",
          }}
        />

        {/* Content Layer */}
        <div className="relative z-10">
          <PageHeader
            eyebrow="ROBINHOOD CHAIN · RWA LIVE TERMINAL"
            title="REAL WORLD ASSETS"
            subline="High-density live DexScreener-style execution and liquidity terminal for tokenized stocks and ETFs on Robinhood Chain. Verified against canonical beacon and Stock implementation."
          />

          <section className="mx-auto max-w-7xl px-3 pb-20 sm:px-6">
            {/* Top Screener Metrics Banner */}
            <div className="rounded-xl border border-[#262626] bg-[#0c0c0c] p-4 text-xs font-mono mb-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] pb-3">
                {/* Meta Category Pills */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[#8a8a8a] text-[10px] tracking-wider uppercase">Market Telemetry:</span>
                  <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-[#ededea]">
                    🏛️ RWAs <span className="text-[#ccff00] font-bold">{marketStats.totalTokens}</span>
                  </span>
                  <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-[#ededea]">
                    📈 24h Vol <span className="text-[#ccff00] font-bold">{formatCompactUsd(marketStats.totalVol)}</span>
                  </span>
                  <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-[#ededea]">
                    💧 DEX Liq <span className="text-[#8fbf6a] font-bold">{formatCompactUsd(marketStats.totalLiq)}</span>
                  </span>
                  <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-[#ededea]">
                    ⚡ Active Pools <span className="text-[#ffaa22] font-bold">{marketStats.activePools}</span>
                  </span>
                  {marketStats.topGainer && (
                    <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-[#ededea]">
                      🔥 Top Gainer <span className="text-[#8fbf6a] font-bold">{marketStats.topGainer.symbol} +{marketStats.topGainer.change.toFixed(1)}%</span>
                    </span>
                  )}
                  <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-[#ededea]">
                    🛡️ Audit <span className="text-[#ccff00] font-bold">100% Verified</span>
                  </span>
                </div>

                <div className="flex items-center gap-4 text-[#8a8a8a] text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-[#8fbf6a] animate-pulse" />
                    <span className="text-[#ededea] font-bold">LIVE FEED</span>
                  </div>
                  <div>
                    SHOWING: <span className="text-[#ccff00] font-bold">{sortedTokens.length}</span> / {tokens.length}
                  </div>
                </div>
              </div>

              {/* Filter Controls Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3">
                {/* Left Category Quick Tabs */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "all", label: `All RWAs (${tokens.length})`, icon: Layers },
                    { id: "stock", label: `Stocks (${marketStats.stockCount})`, icon: TrendingUp },
                    { id: "etf", label: `ETFs (${marketStats.etfCount})`, icon: ShieldCheck },
                    { id: "gainers", label: "Top Gainers", icon: Flame },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const isActive = activeCategory === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveCategory(tab.id as typeof activeCategory)}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                          isActive
                            ? "bg-[#ccff00] text-[#0a0a0a] font-bold"
                            : "bg-[#141414] border border-[#242424] text-[#8a8a8a] hover:text-[#ededea]"
                        }`}
                      >
                        <Icon className="size-3.5" />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Right Search Input & Refresh Button */}
                <div className="flex items-center gap-2">
                  <div className="relative min-w-[220px] sm:min-w-[260px]">
                    <Search className="absolute left-3 top-2.5 size-3.5 text-[#666]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search ticker, company, address..."
                      className="w-full rounded-lg border border-[#262626] bg-[#141414] pl-9 pr-3 py-1.5 text-xs text-[#ededea] placeholder-[#555] focus:border-[#ccff00] focus:outline-none"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery("")}
                        className="absolute right-2.5 top-2 text-[#777] hover:text-[#ededea] text-xs cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={fetchFeed}
                    disabled={isRefreshing}
                    title={lastUpdated ? `Last updated ${lastUpdated}. Click to refresh.` : "Refresh market feed"}
                    className="rounded-lg border border-[#262626] bg-[#141414] p-2 text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ccff00] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-[#ccff00]" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Secondary DexScreener-style Rung Filters */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 mt-3 border-t border-[#1a1a1a]">
                <div className="flex flex-wrap items-center gap-4 text-[11px]">
                  {/* Authentic Toggle */}
                  <button
                    type="button"
                    onClick={() => setAuthenticOnly((prev) => !prev)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                      authenticOnly
                        ? "bg-[#ccff00]/15 border-[#ccff00] text-[#ccff00] font-bold"
                        : "bg-[#141414] border-[#262626] text-[#8a8a8a] hover:text-[#ededea]"
                    }`}
                  >
                    <Check className={`size-3 ${authenticOnly ? "text-[#ccff00]" : "text-transparent"}`} />
                    <span>Authentic Only</span>
                  </button>

                  {/* Volume Rungs */}
                  <div className="flex items-center gap-1">
                    <span className="text-white text-[10px] uppercase font-bold">Min Vol:</span>
                    {(
                      [
                        { id: "all", label: "All" },
                        { id: "10k", label: "$10K+" },
                        { id: "100k", label: "$100K+" },
                        { id: "1m", label: "$1M+" },
                      ] as const
                    ).map((rung) => (
                      <button
                        key={rung.id}
                        type="button"
                        onClick={() => setVolumeFilter(rung.id)}
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                          volumeFilter === rung.id
                            ? "bg-[#282828] text-[#ccff00] font-bold border border-[#3a3a3a]"
                            : "text-[#f0f0f0] hover:text-white"
                        }`}
                      >
                        {rung.label}
                      </button>
                    ))}
                  </div>

                  {/* Liquidity Rungs */}
                  <div className="flex items-center gap-1">
                    <span className="text-white text-[10px] uppercase font-bold">Min Liq:</span>
                    {(
                      [
                        { id: "all", label: "All" },
                        { id: "50k", label: "$50K+" },
                        { id0: "500k", id: "500k", label: "$500K+" },
                        { id: "1m", label: "$1M+" },
                      ] as const
                    ).map((rung) => (
                      <button
                        key={rung.id}
                        type="button"
                        onClick={() => setLiquidityFilter(rung.id)}
                        className={`px-2 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
                          liquidityFilter === rung.id
                            ? "bg-[#282828] text-[#8fbf6a] font-bold border border-[#3a3a3a]"
                            : "text-[#f0f0f0] hover:text-white"
                        }`}
                      >
                        {rung.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Reset Filters button if any non-default filter is active */}
                {(activeCategory !== "all" ||
                  authenticOnly ||
                  volumeFilter !== "all" ||
                  liquidityFilter !== "all" ||
                  searchQuery.trim() !== "") && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveCategory("all");
                      setAuthenticOnly(false);
                      setVolumeFilter("all");
                      setLiquidityFilter("all");
                      setSearchQuery("");
                    }}
                    className="text-[10px] text-[#f0f0f0] hover:text-[#ccff00] underline underline-offset-2 transition-colors cursor-pointer"
                  >
                    Reset all filters
                  </button>
                )}
              </div>
            </div>

            {/* Main High-Density Table (Spacious Uniswap Launches Style) */}
            <div className="rounded-2xl border border-[#242827] bg-[#0b0e0d] overflow-hidden text-xs shadow-2xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-separate border-spacing-y-1">
                  <thead>
                    <tr className="border-b border-[#2a352f] bg-[#1a221e] text-[13px] font-semibold text-[#c4d2c9] uppercase tracking-wider select-none [&>th+th]:border-l [&>th+th]:border-l-white/[0.06]">
                      <th
                        className="px-5 py-3.5 w-14 text-center cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("rank")}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>#</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th
                        className="px-5 py-3.5 min-w-[240px] cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("name")}
                      >
                        <div className="flex items-center gap-1">
                          <span>TOKEN</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th className="px-5 py-3.5 min-w-[90px] text-left">TYPE</th>
                      <th
                        className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("price")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>PRICE</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th
                        className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("h1")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>1H</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th
                        className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("h24")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>1D</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th
                        className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("volume")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>24H VOLUME</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th
                        className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("liquidity")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>LIQUIDITY</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th
                        className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                        onClick={() => handleSort("txns")}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>TXNS</span>
                          <ArrowUpDown className="size-3 opacity-60" />
                        </div>
                      </th>
                      <th className="px-5 py-3.5 text-center min-w-[110px]">ACTION</th>
                    </tr>
                  </thead>

                  <tbody>
                    {sortedTokens.map((token, idx) => {
                      const isEtf = token.category === "etf";
                      const hasPrice = token.priceUsd !== null && token.priceUsd > 0;
                      const hasVol = token.volume24hUsd !== null && token.volume24hUsd > 0;
                      const hasLiq = token.liquidityUsd !== null && token.liquidityUsd > 0;

                      return (
                        <tr
                          key={token.address}
                          onClick={() => handleRowClick(token)}
                          className="border border-[#202424] bg-[#0e1110] odd:bg-[#0e1110] even:bg-[#111413] hover:bg-[#181c17] hover:border-[#2b382a] transition-colors cursor-pointer group [&>td+td]:border-l [&>td+td]:border-l-white/[0.06]"
                        >
                          {/* # Rank */}
                          <td className="px-5 py-4.5 text-center text-[#9ca4a0] font-medium border-y border-l-2 border-l-transparent group-hover:border-l-[#ccff00] first:rounded-l-lg group-hover:text-white transition-colors">
                            {idx + 1}
                          </td>

                          {/* Token Info (Uniswap 2-line layout) */}
                          <td className="px-5 py-4.5 border-y border-[#202424]">
                            <div className="flex items-center gap-3.5">
                              <div className="relative shrink-0">
                                <RwaIcon
                                  symbol={token.asset_symbol}
                                  className="size-10 rounded-full overflow-hidden shrink-0 border border-[#262626] bg-[#141414]"
                                />
                                <div className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full border border-[#111111] bg-[#1a1a1a] flex items-center justify-center text-[8px] shadow-sm">
                                  {isEtf ? (
                                    <span title="ETF" className="text-[#a78bfa]">📊</span>
                                  ) : (
                                    <span title="Stock" className="text-[#ccff00]">🏛️</span>
                                  )}
                                </div>
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold text-white text-[14px] truncate max-w-[200px] group-hover:text-[#ccff00] transition-colors">
                                  {token.asset_name}
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="text-xs font-mono uppercase text-[#888888] tracking-wider">
                                    {token.asset_symbol}
                                  </span>
                                  <span className="text-[11px] font-mono text-[#8a928e]">/ ETH</span>
                                  {token.trusted && (
                                    <span className="rounded-full bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/30 px-1.5 py-0.2 text-[8px] font-bold uppercase tracking-wider">
                                      Authentic
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* TYPE */}
                          <td className="px-5 py-4.5 text-left">
                            {isEtf ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#8b5cf6]/15 text-[#a78bfa] border border-[#8b5cf6]/30 px-2.5 py-0.5 text-[11px] font-semibold">
                                ETF
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#ccff00]/15 text-[#ccff00] border border-[#ccff00]/30 px-2.5 py-0.5 text-[11px] font-semibold">
                                Stock
                              </span>
                            )}
                          </td>

                          {/* PRICE */}
                          <td className="px-5 py-4.5 text-right font-mono text-white text-[13px] font-medium">
                            {hasPrice ? formatTokenPrice(token.priceUsd!, true) : "—"}
                          </td>

                          {/* 1H */}
                          <td className="px-5 py-4.5 text-right">
                            {renderChangeIndicator(token.changeH1)}
                          </td>

                          {/* 1D (24H) */}
                          <td className="px-5 py-4.5 text-right">
                            {renderChangeIndicator(token.changeH24)}
                          </td>

                          {/* VOLUME 24H */}
                          <td className="px-5 py-4.5 text-right font-medium text-white text-[13px]">
                            {hasVol ? (
                              formatCompactUsd(token.volume24hUsd!)
                            ) : (
                              <span className="text-[#666666]">$0</span>
                            )}
                          </td>

                          {/* LIQUIDITY */}
                          <td className="px-5 py-4.5 text-right font-medium text-white text-[13px]">
                            {hasLiq ? (
                              formatCompactUsd(token.liquidityUsd!)
                            ) : (
                              <span className="text-[#666666]">$0</span>
                            )}
                          </td>

                          {/* TXNS */}
                          <td className="px-5 py-4.5 text-right text-[#aaaaaa] font-mono text-xs">
                            {token.trades24h !== null && token.trades24h > 0
                              ? token.trades24h.toLocaleString("en-US")
                              : "—"}
                          </td>

                          {/* ACTION BUTTONS */}
                          <td className="px-5 py-4.5 text-center">
                            <div className="flex items-center justify-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={`/rwa/${token.address}`}
                                className="rounded-full bg-[#ccff00]/15 hover:bg-[#ccff00] text-[#ccff00] hover:text-black border border-[#ccff00]/40 px-3.5 py-1 text-xs font-bold transition-all inline-flex items-center gap-1 shadow-sm cursor-pointer"
                              >
                                <Zap className="size-3" />
                                <span>Trade</span>
                              </Link>
                              <Link
                                href={`/scan/${token.address}`}
                                title="Inspect Audit Verdict"
                                className="p-1.5 rounded-full border border-[#2a2a2a] bg-[#141414] text-[#888888] hover:border-[#8fbf6a] hover:text-[#8fbf6a] transition-colors cursor-pointer"
                              >
                                <ShieldCheck className="size-3.5" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {sortedTokens.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-6 py-16 text-center text-xs text-[#8a8a8a]">
                          <div className="max-w-md mx-auto space-y-3">
                            <p className="text-sm font-semibold text-white">
                              No Real World Assets match the selected filters.
                            </p>
                            <p className="text-[11px] text-[#888888] leading-relaxed">
                              Try relaxing your search query, volume rungs, or category toggles to see registered Robinhood RWAs.
                            </p>
                            <div className="pt-2 flex items-center justify-center gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveCategory("all");
                                  setAuthenticOnly(false);
                                  setVolumeFilter("all");
                                  setLiquidityFilter("all");
                                  setSearchQuery("");
                                }}
                                className="rounded-full border border-[#ccff00] bg-[#ccff00] px-4 py-1.5 text-xs font-bold text-black hover:bg-[#b8e600] transition-colors cursor-pointer shadow-md"
                              >
                                Reset Filters
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Transparency Infrastructure Section */}
            <div className="mt-16 border-t-2 border-[#2A2A2A] pt-8">
              <p className="text-[11px] font-bold tracking-[0.24em] text-[#8a8a8a] uppercase">
                TRANSPARENCY · TRUSTED INFRASTRUCTURE
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#8a8a8a]">
                These are the exact issuer addresses used by the authenticity gate and scan-time
                infrastructure exclusions on Robinhood Chain. Disabling one takes effect on the next
                ten-minute cache refresh.
              </p>
              <div className="mt-6 space-y-3">
                {infrastructure.map((r) => (
                  <div
                    key={r.address}
                    className="flex flex-wrap items-center justify-between gap-3 bg-[#141414]/90 border-2 border-[#2A2A2A] p-4 brutalist-box brutalist-shadow-dark halftone-dark"
                  >
                    <span className="font-medium text-sm text-[#EDEDEA]">{r.label}</span>
                    <div className="max-w-full overflow-hidden">
                      <CopyAddressChip address={r.address} label={r.category.toUpperCase()} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Feedback & Corrections Line */}
            <div className="mt-10 pt-6 border-t border-[#2a2a2a]/60 text-center">
              <p className="text-xs text-[#8a8a8a]">
                Got questions or corrections? Let us know on{" "}
                <a
                  href="https://t.me/RobinCallsChat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#ededea] hover:text-[#ccff00] transition-colors underline underline-offset-4"
                >
                  Telegram Chat ↗
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </NoirShell>
  );
}
