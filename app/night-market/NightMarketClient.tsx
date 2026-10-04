"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  applyMarketFilters, byNewest, compareKnown, NO_FILTERS, PRESETS, trendingScoreFor, type MarketFilters,
} from "@/lib/trade/market-filters";
import { MarketFilterPanel } from "./MarketFilterPanel";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  Pencil,
  RefreshCw,
  Rocket,
  Search,
  Zap,
} from "lucide-react";
import {
  type TokenMarketData,
  launchFeedRowToTokenMarketData,
  dexPairToTokenMarketData,
  formatSubscriptPrice,
  formatCompactUsd,
} from "@/lib/trade/types";
import { batchGetMarketData, searchDexScreenerPairs } from "@/lib/trade/dexscreener-api";
import { mergeLiveLaunchMarket } from "@/lib/trade/night-market-live";
import { type DexScreenerFeedStats } from "@/lib/trade/dexscreener-feed";
import { TokenIcon } from "@/app/components/site/TokenIcon";
import { ShimmerBlock } from "@/app/components/site/Skeleton";
import { explorerWebUrl } from "@/lib/config/chain";
import type { LaunchFeedRow } from "@/lib/launches/feed-types";
import type { LaunchpadLink } from "@/app/components/site/NightMarketTabs";

export interface NightMarketClientProps {
  initialTokens?: TokenMarketData[];
  initialCursor?: string | null;
  tradeEnabled?: boolean;
  launchpads?: LaunchpadLink[];
}

type PrimaryTab = "robinhood-pairs" | "aggregated-dex";
type AggregatedSubTab = "all" | "dex" | "bonding" | "gainers";
type SortField =
  | "rank"
  | "mcap"
  | "price"
  | "age"
  | "txns"
  | "volume"
  | "traders"
  | "m5"
  | "h1"
  | "h6"
  | "h24"
  | "liquidity";
type SortDirection = "asc" | "desc";

function sortValue(t: TokenMarketData, f: SortField): number {
  switch (f) {
    case "mcap": return t.marketCap;
    case "price": return t.priceUsd;
    case "volume": return t.volume24h;
    case "txns": return t.txns24h.total;
    case "traders": return t.traders24h.total;
    case "m5": return t.priceChange.m5;
    case "h1": return t.priceChange.h1;
    case "h6": return t.priceChange.h6;
    case "h24": return t.priceChange.h24;
    case "liquidity": return t.liquidityUsd;
    // Newer = larger createdAt; "asc" age means youngest first, so age sorts on -createdAt.
    case "age": return t.createdAtMs ? -t.createdAtMs : NaN;
    default: return t.rank;
  }
}

/** Age colour: bright green when new, easing to white at a day old. Log scale, so the
 *  first hour (where a launch actually moves) spans most of the ramp. */
const AGE_FRESH = [0x9d, 0xff, 0x7a];
const AGE_WHITE_MS = 24 * 3_600_000;
function ageColor(createdAtMs: number | null | undefined, nowMs: number): string {
  if (!createdAtMs) return "#f5f5f5";
  const ageMin = Math.max(1, (nowMs - createdAtMs) / 60_000);
  const t = Math.min(1, Math.log(ageMin) / Math.log(AGE_WHITE_MS / 60_000));
  const [r, g, b] = AGE_FRESH.map((c) => Math.round(c + (0xf5 - c) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

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

// Module-level client-side memory cache for zero-flicker instant tab restoration
let memoryCachedDexTokens: TokenMarketData[] = [];
let memoryCachedDexStats: DexScreenerFeedStats | null = null;
let memoryCachedTimestamp = 0;

const NM_STORAGE_KEYS = {
  ACTIVE_TAB: "rc_nm_primary_tab_v1",
  AGGREGATED_SUB_TAB: "rc_nm_sub_tab_v1",
  DEX_FEED_CACHE: "rc_dex_pairs_feed_v1",
} as const;

function getSavedDexFeed(): { tokens: TokenMarketData[]; stats: DexScreenerFeedStats | null } {
  if (memoryCachedDexTokens.length > 0) {
    return { tokens: memoryCachedDexTokens, stats: memoryCachedDexStats };
  }
  if (typeof window !== "undefined") {
    try {
      const raw = sessionStorage.getItem(NM_STORAGE_KEYS.DEX_FEED_CACHE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.tokens) && parsed.tokens.length > 0) {
          memoryCachedDexTokens = parsed.tokens;
          memoryCachedDexStats = parsed.stats || null;
          memoryCachedTimestamp = parsed.timestamp || 0;
          return { tokens: parsed.tokens, stats: parsed.stats || null };
        }
      }
    } catch {}
  }
  return { tokens: [], stats: null };
}

function getSavedInitialTab(): PrimaryTab {
  if (typeof window !== "undefined") {
    try {
      const param = new URLSearchParams(window.location.search).get("tab");
      if (param === "aggregated-dex" || param === "robinhood-pairs") {
        return param;
      }
      const saved = sessionStorage.getItem(NM_STORAGE_KEYS.ACTIVE_TAB);
      if (saved === "aggregated-dex" || saved === "robinhood-pairs") {
        return saved;
      }
    } catch {}
  }
  return "aggregated-dex"; // Aggregated DEX comes first by default!
}

function getSavedInitialSubTab(): AggregatedSubTab {
  if (typeof window !== "undefined") {
    try {
      const param = new URLSearchParams(window.location.search).get("subTab");
      if (param === "all" || param === "dex" || param === "bonding" || param === "gainers") {
        return param;
      }
      const saved = sessionStorage.getItem(NM_STORAGE_KEYS.AGGREGATED_SUB_TAB);
      if (saved === "all" || saved === "dex" || saved === "bonding" || saved === "gainers") {
        return saved as AggregatedSubTab;
      }
    } catch {}
  }
  return "all";
}

export function NightMarketClient({
  initialTokens = [],
  initialCursor = null,
  tradeEnabled = true,
  launchpads = [],
}: NightMarketClientProps) {
  const router = useRouter();

  // Primary Tab: Aggregated DEX comes first, remembered from session / URL
  // Server-safe defaults; the saved values are restored after hydration (below), never in an
  // initializer, or the first client render differs from the HTML (React #418 on revisit).
  const [primaryTab, setPrimaryTab] = useState<PrimaryTab>("aggregated-dex");
  const [aggregatedSubTab, setAggregatedSubTab] = useState<AggregatedSubTab>("all");

  // Tokens & pagination state
  const [tokens, setTokens] = useState<TokenMarketData[]>(initialTokens);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortField, setSortField] = useState<SortField>("rank");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [externalSearchedTokens, setExternalSearchedTokens] = useState<TokenMarketData[]>([]);
  const [isSearchingExternal, setIsSearchingExternal] = useState(false);

  // DexScreener Live Feed state - initialized immediately from client cache (zero blank screen)
  const [dexTokens, setDexTokens] = useState<TokenMarketData[]>([]);
  const [liveLaunchMarkets, setLiveLaunchMarkets] = useState<Record<string, TokenMarketData>>({});
  const [checkingLaunchMarkets, setCheckingLaunchMarkets] = useState<Set<string>>(() => new Set());
  const [dexScreenerStats, setDexScreenerStats] = useState<DexScreenerFeedStats | null>(null);
  const [dexSubSort, setDexSubSort] = useState<"trending" | "volume" | "gainers" | "new">("trending");
  const [dexTimeframe, setDexTimeframe] = useState<"5m" | "1h" | "6h" | "24h">("5m");
  const [boostedOnly, setBoostedOnly] = useState(false);
  const [marketFilters, setMarketFiltersState] = useState<MarketFilters>(NO_FILTERS);
  useEffect(() => {
    setPrimaryTab(getSavedInitialTab());
    setAggregatedSubTab(getSavedInitialSubTab());
    const cached = getSavedDexFeed();
    if (cached.tokens.length) {
      setDexTokens(cached.tokens);
      setDexScreenerStats(cached.stats);
      setLastDexUpdatedAt(cached.stats?.lastUpdated || memoryCachedTimestamp || null);
    }
    try {
      const saved = sessionStorage.getItem("nm.marketFilters");
      if (saved) setMarketFiltersState({ ...NO_FILTERS, ...(JSON.parse(saved) as Partial<MarketFilters>) });
    } catch {
      /* unreadable saved filters: start clear */
    }
  }, []);
  // Age filters need a clock; a minute is fine-grained enough and keeps render pure.
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Launchpad slugs, filtered in SQL by /api/launches (`pads=`), never over the downloaded page.
  const [selectedPads, setSelectedPads] = useState<string[]>([]);
  const padsRef = useRef<string[]>([]);
  padsRef.current = selectedPads;
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastLaunchUpdatedAt, setLastLaunchUpdatedAt] = useState<number | null>(null);
  const [lastDexUpdatedAt, setLastDexUpdatedAt] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState<number | null>(null);
  useEffect(() => {
    setClockMs(Date.now());
    const id = setInterval(() => setClockMs(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const setMarketFilters = (next: MarketFilters) => {
    setMarketFiltersState(next);
    setPage(1);
    try { sessionStorage.setItem("nm.marketFilters", JSON.stringify(next)); } catch { /* private mode: filters just are not remembered */ }
  };
  const [isLoadingDex, setIsLoadingDex] = useState(false);

  // Tab change handlers that remember state in URL + sessionStorage
  const handlePrimaryTabChange = (tab: PrimaryTab) => {
    setPrimaryTab(tab);
    setPage(1);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(NM_STORAGE_KEYS.ACTIVE_TAB, tab);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", tab);
        window.history.replaceState({}, "", url.toString());
      } catch {}
    }
  };

  const handleAggregatedSubTabChange = (subTab: AggregatedSubTab) => {
    setAggregatedSubTab(subTab);
    setPage(1);
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(NM_STORAGE_KEYS.AGGREGATED_SUB_TAB, subTab);
        const url = new URL(window.location.href);
        url.searchParams.set("subTab", subTab);
        window.history.replaceState({}, "", url.toString());
      } catch {}
    }
  };

  // Token1 Quote Filter state
  const [selectedQuote, setSelectedQuote] = useState<string>("ALL");
  const [isQuoteDropdownOpen, setIsQuoteDropdownOpen] = useState(false);
  const [quoteSearchText, setQuoteSearchText] = useState("");
  const quoteDropdownRef = useRef<HTMLDivElement>(null);

  // Page-wise pagination
  const [page, setPage] = useState<number>(1);
  const pageSize = 50;

  // Click outside quote dropdown handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (quoteDropdownRef.current && !quoteDropdownRef.current.contains(event.target as Node)) {
        setIsQuoteDropdownOpen(false);
      }
    }
    if (isQuoteDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isQuoteDropdownOpen]);

  // Fetch page from /api/launches
  const fetchLaunches = useCallback(
    async (tab: "all" | "dex" | "bonding" | "gainers", cursorParam?: string | null) => {
      const apiTab = tab === "gainers" ? "all" : tab;
      const url = new URL("/api/launches", window.location.origin);
      url.searchParams.set("tab", apiTab);
      url.searchParams.set("limit", "100");
      if (cursorParam) {
        url.searchParams.set("cursor", cursorParam);
      }
      if (padsRef.current.length) url.searchParams.set("pads", padsRef.current.join(","));

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load launches: HTTP ${res.status}`);
      }

      const data: { rows: LaunchFeedRow[]; nextCursor: string | null; quotePrices: Record<string, number> } =
        await res.json();
      return data;
    },
    [],
  );

  // Fetch live DexScreener feed for Robinhood Chain with cache persistence
  const fetchDexScreenerFeed = useCallback(async (isSilent = false) => {
    if (!isSilent) {
      setIsLoadingDex(true);
    }
    setErrorNotice(null);
    try {
      const res = await fetch("/api/dexscreener/feed");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const pairs = data.pairs || [];
      const stats = data.stats || null;
      setDexTokens(pairs);
      setDexScreenerStats(stats);
      setLastDexUpdatedAt(stats?.lastUpdated || Date.now());

      // Persist in module memory and sessionStorage
      memoryCachedDexTokens = pairs;
      memoryCachedDexStats = stats;
      memoryCachedTimestamp = Date.now();
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem(
            NM_STORAGE_KEYS.DEX_FEED_CACHE,
            JSON.stringify({ tokens: pairs, stats, timestamp: Date.now() })
          );
        } catch {}
      }
    } catch (err: any) {
      setErrorNotice(err?.message || "Failed to load live Robinhood pairs feed.");
    } finally {
      setIsLoadingDex(false);
    }
  }, []);

  // Initial load for DexScreener feed (silent background if already cached)
  useEffect(() => {
    fetchDexScreenerFeed(getSavedDexFeed().tokens.length > 0);
  }, [fetchDexScreenerFeed]);

  // The launch registry's market snapshot is minutes to hours old and has no 5M or 1D change.
  // Overlay a live pair on every graduated row (see mergeLiveLaunchMarket), feed first, then a batch read.
  useEffect(() => {
    if (primaryTab !== "aggregated-dex") return;
    let cancelled = false;
    const candidates = tokens.filter((token) => !token.isBondingCurve && !token.liquidityPulled).slice(0, 100);
    const fromFeed: Record<string, TokenMarketData> = {};
    const missing = new Set<string>();
    // Only rows with no stored depth show "checking"; a priced row keeps its number while the read runs.
    const unpriced = new Set<string>();
    for (const token of candidates) {
      const address = token.address.toLowerCase();
      const best = dexTokens
        .filter((pair) => pair.address.toLowerCase() === address && Number.isFinite(pair.liquidityUsd) && pair.liquidityUsd > 0)
        .sort((a, b) => b.liquidityUsd - a.liquidityUsd)[0];
      if (best) fromFeed[address] = best;
      else if (/^0x[0-9a-f]{40}$/i.test(address)) {
        missing.add(address);
        if (!Number.isFinite(token.liquidityUsd) || token.liquidityUsd <= 0) unpriced.add(address);
      }
    }
    setCheckingLaunchMarkets(unpriced);
    if (missing.size) {
      void batchGetMarketData([...missing]).then((results) => {
        if (cancelled) return;
        const next = { ...fromFeed };
        for (const address of missing) {
          const market = results.get(address);
          if (market && Number.isFinite(market.liquidityUsd) && market.liquidityUsd > 0) next[address] = market;
        }
        setLiveLaunchMarkets(next);
      }).catch(() => {
        if (!cancelled) setLiveLaunchMarkets(fromFeed);
      }).finally(() => { if (!cancelled) setCheckingLaunchMarkets(new Set()); });
    } else {
      setLiveLaunchMarkets(fromFeed);
    }
    return () => { cancelled = true; };
  }, [primaryTab, tokens, dexTokens]);

  // Background auto-refresh every 30 seconds when tab is active
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchDexScreenerFeed(true);
        if (primaryTab === "aggregated-dex") {
          const requestedPads = padsRef.current.join(",");
          fetchLaunches(aggregatedSubTab)
            .then((data) => {
              if (requestedPads !== padsRef.current.join(",")) return;
              if (data.rows && (data.rows.length > 0 || requestedPads)) {
                setTokens(
                  data.rows.map((row, idx) =>
                    launchFeedRowToTokenMarketData(row, idx + 1, launchpads, data.quotePrices)
                  )
                );
                setCursor(data.nextCursor);
                setLastLaunchUpdatedAt(Date.now());
              }
            })
            // Background poll: the last good table stays up; the manual refresh reports errors.
            .catch(() => {});
        }
      }
    };

    timer = setInterval(tick, 30_000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [fetchDexScreenerFeed, fetchLaunches, primaryTab, aggregatedSubTab, launchpads]);

  // Load Aggregated launches when subTab changes
  useEffect(() => {
    if (primaryTab !== "aggregated-dex") return;

    let cancelled = false;
    async function loadData() {
      setIsLoading(true);
      setErrorNotice(null);

      try {
        const data = await fetchLaunches(aggregatedSubTab);
        if (cancelled) return;

        if (data.rows && data.rows.length > 0) {
          const mapped = data.rows.map((row, idx) =>
            launchFeedRowToTokenMarketData(row, idx + 1, launchpads, data.quotePrices),
          );
          setTokens(mapped);
          setCursor(data.nextCursor);
          setLastLaunchUpdatedAt(Date.now());
        } else if (padsRef.current.length) {
          // A launchpad filter that matches nothing is an answer, not an empty DB.
          setTokens([]);
          setCursor(null);
          setLastLaunchUpdatedAt(Date.now());
        } else {
          // Fallback if local DB unpopulated in dev
          const dexPairs = await searchDexScreenerPairs("robinhood");
          if (cancelled) return;

          if (dexPairs && dexPairs.length > 0) {
            const mapped = dexPairs.map((p: any, idx: number) => dexPairToTokenMarketData(p, idx + 1));
            setTokens(mapped);
            setCursor(null);
          } else {
            setTokens([]);
            setCursor(null);
          }
        }
      } catch (err: any) {
        if (cancelled) return;
        if (padsRef.current.length) {
          setTokens([]);
          setCursor(null);
          setErrorNotice(err?.message || "Failed to load selected launchpads.");
          return;
        }
        try {
          const dexPairs = await searchDexScreenerPairs("robinhood");
          if (cancelled) return;
          if (dexPairs && dexPairs.length > 0) {
            const mapped = dexPairs.map((p: any, idx: number) => dexPairToTokenMarketData(p, idx + 1));
            setTokens(mapped);
            setCursor(null);
          } else {
            setErrorNotice(err?.message || "Failed to load live token feed.");
          }
        } catch {
          setErrorNotice(err?.message || "Failed to load live token feed.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [aggregatedSubTab, fetchLaunches, launchpads, primaryTab, selectedPads]);

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection(field === "rank" || field === "age" ? "asc" : "desc");
    }
    setPage(1);
  };

  // On-demand DexScreener live search when searching by token name, symbol, or address
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || q.length < 2) {
      setExternalSearchedTokens([]);
      setIsSearchingExternal(false);
      return;
    }

    let isCancelled = false;
    setIsSearchingExternal(true);

    const timer = setTimeout(async () => {
      try {
        const pairs = await searchDexScreenerPairs(q);
        if (!isCancelled && pairs && pairs.length > 0) {
          const mapped = pairs.map((p, idx) => dexPairToTokenMarketData(p, idx + 1));
          setExternalSearchedTokens(mapped);
        } else if (!isCancelled) {
          setExternalSearchedTokens([]);
        }
      } catch {
        if (!isCancelled) setExternalSearchedTokens([]);
      } finally {
        if (!isCancelled) setIsSearchingExternal(false);
      }
    }, 250);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  // Compute available Quote Tokens (Token1) dynamically
  const availableQuotes = useMemo(() => {
    const popularQuotes: { symbol: string; name: string }[] = [
      { symbol: "ALL", name: "All Pairs" },
      { symbol: "ETH", name: "Ethereum" },
      { symbol: "WETH", name: "Wrapped Ether" },
      { symbol: "USDG", name: "Global Dollar" },
      { symbol: "USDC", name: "USD Coin" },
      { symbol: "USDT", name: "Tether USD" },
      { symbol: "AAPL", name: "Apple Inc." },
      { symbol: "NVDA", name: "NVIDIA Corp" },
      { symbol: "TSLA", name: "Tesla Inc." },
      { symbol: "MSFT", name: "Microsoft Corp" },
      { symbol: "META", name: "Meta Platforms" },
      { symbol: "SPY", name: "S&P 500 ETF" },
      { symbol: "QQQ", name: "Invesco QQQ ETF" },
      { symbol: "AMZN", name: "Amazon.com Inc." },
      { symbol: "GOOGL", name: "Alphabet Inc." },
    ];

    const seen = new Set(popularQuotes.map((q) => q.symbol));
    const pool = primaryTab === "robinhood-pairs" ? dexTokens : tokens;
    const additional: { symbol: string; name: string }[] = [];

    for (const t of pool) {
      const sym = (t.quoteToken?.symbol || "").toUpperCase();
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        additional.push({ symbol: sym, name: t.quoteToken?.name || sym });
      }
    }

    return [...popularQuotes, ...additional];
  }, [primaryTab, dexTokens, tokens]);

  const filteredQuotes = useMemo(() => {
    const q = quoteSearchText.trim().toLowerCase();
    if (!q) return availableQuotes;
    return availableQuotes.filter(
      (item) => item.symbol.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
    );
  }, [availableQuotes, quoteSearchText]);

  // Filter & Search Logic
  const displayedTokens = useMemo(() => {
    const currentLaunchMarket = (token: TokenMarketData) => {
      const address = token.address.toLowerCase();
      const merged = mergeLiveLaunchMarket(token, liveLaunchMarkets[address]);
      return merged === token && checkingLaunchMarkets.has(address)
        ? { ...token, liquidityUsd: NaN }
        : merged;
    };
    const isSearching = searchQuery.trim().length > 0;
    const q = searchQuery.trim().toLowerCase();

    // ── ROBINHOOD PAIRS TAB (DexScreener Live Feed) ──
    if (primaryTab === "robinhood-pairs") {
      let filtered = [...dexTokens];

      if (isSearching) {
        filtered = filtered.filter((token) => {
          const matchesName = (token.name || "").toLowerCase().includes(q);
          const matchesSymbol = (token.symbol || "").toLowerCase().includes(q);
          const matchesAddr = (token.address || "").toLowerCase().includes(q);
          const matchesPairAddr = (token.pairAddress || "").toLowerCase().includes(q);
          const matchesQuote = (token.quoteToken?.symbol || "").toLowerCase().includes(q);
          return matchesName || matchesSymbol || matchesAddr || matchesPairAddr || matchesQuote;
        });
      }

      if (boostedOnly) filtered = filtered.filter((t) => (t.boostScore ?? 0) > 0);

      // Filter by quote token (token1)
      if (selectedQuote !== "ALL") {
        filtered = filtered.filter(
          (t) => (t.quoteToken?.symbol || "").toUpperCase() === selectedQuote.toUpperCase(),
        );
      }

      filtered = applyMarketFilters(filtered, marketFilters, nowMs);

      // If user clicked a column header, sort by that column. Unknown values sink either way.
      if (sortField !== "rank") {
        return filtered.sort((a, b) => compareKnown(sortValue(a, sortField), sortValue(b, sortField), sortDirection));
      }

      // Otherwise sort by the active DexScreener sub-filter
      switch (dexSubSort) {
        case "volume":
          filtered.sort((a, b) => compareKnown(a.volume24h, b.volume24h, "desc"));
          break;
        case "gainers":
          filtered.sort((a, b) => compareKnown(a.priceChange.h24, b.priceChange.h24, "desc"));
          break;
        case "new":
          filtered.sort(byNewest);
          break;
        case "trending":
        default: {
          // Activity in the chosen window, scaled by momentum; never price change alone.
          const tf = dexTimeframe;
          const score = new Map(filtered.map((t) => [t, trendingScoreFor(t, tf)]));
          filtered.sort((a, b) => score.get(b)! - score.get(a)!);
          break;
        }
      }

      return filtered;
    }

    // ── AGGREGATED DEX TAB ──
    let allTokens: TokenMarketData[];
    if (isSearching && selectedPads.length === 0 && externalSearchedTokens.length > 0) {
      const seen = new Set<string>();
      const combined: TokenMarketData[] = [];

      for (const ext of externalSearchedTokens) {
        const key = (ext.pairAddress || ext.address).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(ext);
        }
      }

      for (const raw of tokens) {
        const t = currentLaunchMarket(raw);
        const key = (t.pairAddress || t.address).toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          combined.push(t);
        }
      }
      allTokens = combined;
    } else {
      allTokens = tokens.map(currentLaunchMarket);
    }

    const filtered = allTokens.filter((token) => {
      if (isSearching) {
        const matchesName = token.name.toLowerCase().includes(q);
        const matchesSymbol = token.symbol.toLowerCase().includes(q);
        const matchesAddr = token.address.toLowerCase().includes(q);
        const matchesPairAddr = (token.pairAddress || "").toLowerCase().includes(q);
        const matchesQuote = (token.quoteToken?.symbol || "").toLowerCase().includes(q);
        const matchesVenue = (token.venue || "").toLowerCase().includes(q);
        if (!matchesName && !matchesSymbol && !matchesAddr && !matchesPairAddr && !matchesQuote && !matchesVenue) {
          return false;
        }
      }

      // Filter by quote token (token1)
      if (selectedQuote !== "ALL") {
        if ((token.quoteToken?.symbol || "").toUpperCase() !== selectedQuote.toUpperCase()) {
          return false;
        }
      }

      // Sub-filters for Aggregated DEX
      if (aggregatedSubTab === "dex") return !token.isBondingCurve;
      if (aggregatedSubTab === "bonding") return token.isBondingCurve;
      // Launch rows carry a 1h change only; a missing 24h change is unknown, not a loss.
      if (aggregatedSubTab === "gainers") {
        const ch = Number.isFinite(token.priceChange.h24) ? token.priceChange.h24 : token.priceChange.h1;
        return ch > 0;
      }

      return true;
    });

    if (sortField === "rank" || sortField === "age") {
      return filtered.sort((a, b) => (sortDirection === "desc" ? b.rank - a.rank : a.rank - b.rank));
    }
    return filtered.sort((a, b) => compareKnown(sortValue(a, sortField), sortValue(b, sortField), sortDirection));
  }, [
    primaryTab,
    aggregatedSubTab,
    dexTokens,
    tokens,
    liveLaunchMarkets,
    checkingLaunchMarkets,
    externalSearchedTokens,
    searchQuery,
    selectedQuote,
    sortField,
    sortDirection,
    dexSubSort,
    dexTimeframe,
    boostedOnly,
    marketFilters,
    selectedPads,
    nowMs,
  ]);

  // Page-wise pagination calculations
  const totalItems = displayedTokens.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedTokens = displayedTokens.slice(startIndex, startIndex + pageSize);

  // Next page handler
  const handleNextPage = async () => {
    if (currentPage < totalPages) {
      setPage((p) => p + 1);
      return;
    }

    // If at the end of Aggregated DEX list and cursor exists, fetch next 100
    if (primaryTab === "aggregated-dex" && cursor && !isLoadingMore) {
      setIsLoadingMore(true);
      try {
        const data = await fetchLaunches(aggregatedSubTab, cursor);
        if (data.rows && data.rows.length > 0) {
          const startIdx = tokens.length;
          const newTokens = data.rows.map((row, idx) =>
            launchFeedRowToTokenMarketData(row, startIdx + idx + 1, launchpads, data.quotePrices),
          );

          let added = 0;
          setTokens((prev) => {
            const seen = new Set(prev.map((t) => (t.pairAddress || t.address).toLowerCase()));
            const deduped = newTokens.filter((t) => !seen.has((t.pairAddress || t.address).toLowerCase()));
            added = deduped.length;
            return [...prev, ...deduped];
          });

          if (!data.nextCursor || added === 0 || data.rows.length < 100) {
            setCursor(null);
          } else {
            setCursor(data.nextCursor);
          }
          setPage((p) => p + 1);
        } else {
          setCursor(null);
        }
      } catch (err: any) {
        setErrorNotice(err?.message || "Failed to fetch additional tokens.");
      } finally {
        setIsLoadingMore(false);
      }
    }
  };

  const handlePrevPage = () => {
    setPage((p) => Math.max(1, p - 1));
  };

  // Row navigation
  const handleRowClick = (token: TokenMarketData) => {
    if (token.isBondingCurve && token.launchpadUrl) {
      window.open(token.launchpadUrl, "_blank", "noopener,noreferrer");
    } else {
      router.push(`/trade/${token.pairAddress || token.address}`);
    }
  };

  const refreshNow = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setErrorNotice(null);
    try {
      if (primaryTab === "robinhood-pairs") {
        await fetchDexScreenerFeed(true);
      } else {
        const d = await fetchLaunches(aggregatedSubTab);
        setTokens(d.rows.map((r, i) => launchFeedRowToTokenMarketData(r, i + 1, launchpads, d.quotePrices)));
        setCursor(d.nextCursor);
        setPage(1);
        setLastLaunchUpdatedAt(Date.now());
      }
    } catch (err: any) {
      setErrorNotice(err?.message || "Refresh failed. The table shows the last good data.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const togglePad = (slug: string) => {
    setIsLoading(true);
    setSelectedPads((prev) => (prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]));
    setPage(1);
  };

  const lastUpdatedAt = primaryTab === "robinhood-pairs" ? lastDexUpdatedAt : lastLaunchUpdatedAt;
  const updatedAgo =
    lastUpdatedAt === null || clockMs === null ? null : Math.max(0, Math.round((clockMs - lastUpdatedAt) / 1000));

  const showLaunchSkeleton = primaryTab === "aggregated-dex" && isLoading;
  const isCurrentLoading =
    primaryTab === "robinhood-pairs"
      ? isLoadingDex && dexTokens.length === 0
      : isLoading && tokens.length === 0;

  return (
    <div className="space-y-0 font-mono">
      {/* ── ELEVATED BOOK-TAG TAB SWITCHER WITH 3D DEPTH ── */}
      <div className="relative z-10 flex items-end gap-1.5 px-2 select-none -mb-px">
        {/* Tab 1: Aggregated DEX (First!) */}
        <button
          type="button"
          onClick={() => handlePrimaryTabChange("aggregated-dex")}
          className={`group relative flex items-center gap-2 rounded-t-xl px-5 py-2.5 text-xs font-mono font-bold transition-all duration-150 cursor-pointer ${
            primaryTab === "aggregated-dex"
              ? "z-20 bg-[#0c0c0c] text-white border-t-2 border-t-[#ccff00] border-x border-[#262626] border-b-transparent shadow-[0_-6px_16px_rgba(0,0,0,0.7)] translate-y-[1px]"
              : "z-10 bg-[#070707] text-[#e0e0e0] border-t border-x border-[#1e1e1e] hover:bg-[#121212] hover:text-white"
          }`}
        >
          <Layers
            className={`size-3.5 ${primaryTab === "aggregated-dex" ? "text-[#ccff00]" : "text-[#e0e0e0] group-hover:text-white"}`}
          />
          <span className="tracking-wide">Aggregated DEX</span>
          {tokens.length > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
                primaryTab === "aggregated-dex"
                  ? "bg-[#ccff00]/15 text-[#ccff00] border border-[#ccff00]/30"
                  : "bg-[#181818] text-[#f0f0f0] border border-[#262626]"
              }`}
            >
              {tokens.length}
            </span>
          )}
        </button>

        {/* Tab 2: Robinhood Pairs (Second) */}
        <button
          type="button"
          onClick={() => handlePrimaryTabChange("robinhood-pairs")}
          className={`group relative flex items-center gap-2 rounded-t-xl px-5 py-2.5 text-xs font-mono font-bold transition-all duration-150 cursor-pointer ${
            primaryTab === "robinhood-pairs"
              ? "z-20 bg-[#0c0c0c] text-white border-t-2 border-t-[#ccff00] border-x border-[#262626] border-b-transparent shadow-[0_-6px_16px_rgba(0,0,0,0.7)] translate-y-[1px]"
              : "z-10 bg-[#070707] text-[#e0e0e0] border-t border-x border-[#1e1e1e] hover:bg-[#121212] hover:text-white"
          }`}
        >
          <Flame
            className={`size-3.5 ${primaryTab === "robinhood-pairs" ? "text-[#ccff00]" : "text-[#e0e0e0] group-hover:text-white"}`}
          />
          <span className="tracking-wide">Robinhood Pairs</span>
          {dexTokens.length > 0 && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
                primaryTab === "robinhood-pairs"
                  ? "bg-[#ccff00]/15 text-[#ccff00] border border-[#ccff00]/30"
                  : "bg-[#181818] text-[#f0f0f0] border border-[#262626]"
              }`}
            >
              {dexTokens.length}
            </span>
          )}
        </button>
      </div>

      {/* ── TOP METRICS BANNER & CONTROLS CONTAINER ── */}
      <div className="relative rounded-xl border border-[#262626] bg-[#0c0c0c] p-4 text-xs shadow-xl space-y-3">
        {/* Banner Row */}
        {primaryTab === "robinhood-pairs" ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#f0f0f0] text-[10px] tracking-wider uppercase font-semibold">
                DexScreener Live:
              </span>
              <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-white">
                📊 24H Volume{" "}
                <span className="text-[#ccff00] font-bold">
                  {formatCompactUsd(dexScreenerStats?.totalVolume24h || 0)}
                </span>
              </span>
              <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-white">
                ⚡ 24H Txns{" "}
                <span className="text-[#8fbf6a] font-bold">
                  {(dexScreenerStats?.totalTxns24h || 0).toLocaleString("en-US")}
                </span>
              </span>
              <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-white">
                🏊 Indexed Pools <span className="text-[#38bdf8] font-bold">{dexTokens.length}</span>
              </span>
              <button
                type="button"
                onClick={() => { setBoostedOnly((on) => !on); setPage(1); }}
                aria-pressed={boostedOnly}
                title={boostedOnly ? "Show every pair" : "Show only boosted tokens"}
                className={`rounded-full border px-2.5 py-0.5 text-white transition-colors ${
                  boostedOnly ? "border-[#ffaa22]/60 bg-[#ffaa22]/15" : "border-[#2a2a2a] bg-[#181818] hover:border-[#ffaa22]/40"
                }`}
              >
                ⚡ Boosted Tokens{" "}
                <span className="text-[#ffaa22] font-bold">
                  {dexScreenerStats?.boostedTokensCount || 0}
                </span>
                {boostedOnly && <span className="ml-1 text-[#ffaa22]">✕</span>}
              </button>
            </div>

            <div className="flex items-center gap-3 text-white text-[11px]">
              <div>
                CHAIN ID: <span className="text-[#ccff00] font-bold">4663</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1f1f1f] pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#f0f0f0] text-[10px] tracking-wider uppercase font-semibold">
                Categories:
              </span>
              <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-white">
                🏛️ Equities &amp; ETFs <span className="text-[#ccff00] font-bold">196 Assets</span>
              </span>
              <span className="rounded-full bg-[#181818] border border-[#2a2a2a] px-2.5 py-0.5 text-white">
                📈 DEX <span className="text-[#8fbf6a] font-bold">Live Pools</span>
              </span>
              <span className="text-[#f0f0f0] text-[10px] tracking-wider uppercase font-semibold">
                🚀 Launchpads:
              </span>
              {launchpads.map((pad) => {
                const on = selectedPads.includes(pad.slug);
                return (
                  <button
                    key={pad.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => togglePad(pad.slug)}
                    className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                      on
                        ? "border-[#ffaa22]/70 bg-[#ffaa22]/15 text-[#ffaa22] font-bold"
                        : "border-[#2a2a2a] bg-[#181818] text-white hover:border-[#ffaa22]/40"
                    }`}
                  >
                    {pad.name}
                    {on && <span className="ml-1">✕</span>}
                  </button>
                );
              })}
              {selectedPads.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setIsLoading(true); setSelectedPads([]); setPage(1); }}
                  className="rounded-full border border-[#2a2a2a] px-2.5 py-0.5 text-[#8a8a8a] hover:text-white cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-4 text-white text-[11px]">
              {showLaunchSkeleton && (
                <span role="status" className="inline-flex items-center gap-1.5 text-[#ccff00]">
                  <Loader2 className="size-3 animate-spin" /> Filtering launches...
                </span>
              )}
              <div>
                INDEXED: <span className="text-white font-bold">{showLaunchSkeleton ? "…" : tokens.length}</span>
              </div>
            </div>
          </div>
        )}

        {/* ── FILTER CONTROLS BAR: SUB-FILTERS, TOKEN1 FILTER, SEARCH & REFRESH ── */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Left Controls: Token1 Selector + Tab-Specific Sub-Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {/* ── TOKEN1 QUOTE FILTER WITH DOTTED UNDERSCORE & EDIT PEN ── */}
            <div className="relative" ref={quoteDropdownRef}>
              <button
                type="button"
                onClick={() => setIsQuoteDropdownOpen((prev) => !prev)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-mono transition-colors cursor-pointer ${
                  selectedQuote !== "ALL"
                    ? "border-[#ccff00] bg-[#1a220a] text-white"
                    : "border-[#2a2a2a] bg-[#141414] text-white hover:border-[#383838]"
                }`}
                title="Filter by Token1 (Quote currency)"
              >
                <span className="text-[#f0f0f0]">Pair:</span>
                <span className="text-white font-bold">token0</span>
                <span className="text-[#f0f0f0]">/</span>
                <span className="border-b border-dotted border-white text-white font-bold tracking-wider">
                  {selectedQuote === "ALL" ? "token1" : selectedQuote}
                </span>
                <Pencil className="size-3 text-[#ccff00] ml-0.5" />
                <ChevronDown className="size-3 text-[#f0f0f0] ml-0.5" />
              </button>

              {/* VIRTUALIZED / SCROLLABLE DROPDOWN */}
              {isQuoteDropdownOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl border border-[#333333] bg-[#101010] p-2.5 shadow-2xl z-50 font-mono text-xs">
                  {/* Search inside quote tokens */}
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-2 size-3 text-[#f0f0f0]" />
                    <input
                      type="text"
                      value={quoteSearchText}
                      onChange={(e) => setQuoteSearchText(e.target.value)}
                      placeholder="Search token1 (ETH, USDG...)"
                      className="w-full rounded-md border border-[#2a2a2a] bg-[#161616] pl-7 pr-2.5 py-1 text-xs text-white placeholder-[#888] focus:border-[#ccff00] focus:outline-none"
                      autoFocus
                    />
                  </div>

                  {/* Scrollable list of quotes */}
                  <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1 scrollbar-thin scrollbar-thumb-[#2a2a2a]">
                    {filteredQuotes.map((q) => {
                      const isSelected = selectedQuote === q.symbol;
                      return (
                        <button
                          key={q.symbol}
                          type="button"
                          onClick={() => {
                            setSelectedQuote(q.symbol);
                            setIsQuoteDropdownOpen(false);
                            setPage(1);
                          }}
                          className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? "bg-[#ccff00] text-black font-bold"
                              : "text-white hover:bg-[#1a1a1a]"
                          }`}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="font-bold">{q.symbol}</span>
                            <span
                              className={`text-[10px] truncate max-w-[120px] ${
                                isSelected ? "text-black/80" : "text-[#f0f0f0]"
                              }`}
                            >
                              {q.name}
                            </span>
                          </div>
                          {isSelected && <Check className="size-3.5 text-black shrink-0" />}
                        </button>
                      );
                    })}
                    {filteredQuotes.length === 0 && (
                      <div className="py-4 text-center text-xs text-[#f0f0f0]">No quote token found</div>
                    )}
                  </div>

                  {selectedQuote !== "ALL" && (
                    <div className="pt-2 mt-2 border-t border-[#222]">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedQuote("ALL");
                          setIsQuoteDropdownOpen(false);
                          setPage(1);
                        }}
                        className="w-full rounded bg-[#1a1a1a] hover:bg-[#222] py-1 text-center text-[11px] text-[#ccff00] transition-colors"
                      >
                        Reset to All Quotes
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PRIMARY TAB SPECIFIC SUB-FILTERS */}
            {primaryTab === "robinhood-pairs" ? (
              /* DexScreener Filters: Trending, Top Volume, Gainers, New */
              <div className="flex flex-wrap items-center gap-1.5">
                {/* Trending with Timeframe Selector */}
                <div className="inline-flex items-center rounded-lg bg-[#141414] border border-[#262626] p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setDexSubSort("trending");
                      setSortField("rank");
                      setPage(1);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      dexSubSort === "trending" && sortField === "rank"
                        ? "bg-[#ccff00] text-black"
                        : "text-white hover:text-white"
                    }`}
                  >
                    <Flame className="size-3.5" />
                    <span>Trending</span>
                  </button>
                  <div className="h-3 w-px bg-[#262626] mx-1" />
                  {(["5m", "1h", "6h", "24h"] as const).map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => {
                        setDexSubSort("trending");
                        setDexTimeframe(tf);
                        setSortField("rank");
                        setPage(1);
                      }}
                      className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                        dexSubSort === "trending" && dexTimeframe === tf && sortField === "rank"
                          ? "bg-[#222] text-[#ccff00]"
                          : "text-[#f0f0f0] hover:text-white"
                      }`}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Top Volume */}
                <button
                  type="button"
                  onClick={() => {
                    setDexSubSort("volume");
                    setSortField("rank");
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    dexSubSort === "volume" && sortField === "rank"
                      ? "bg-[#ccff00] text-black font-bold"
                      : "bg-[#141414] border border-[#242424] text-white hover:border-[#383838]"
                  }`}
                >
                  <span>🏆 Top Volume</span>
                </button>

                {/* Top Gainers */}
                <button
                  type="button"
                  onClick={() => {
                    setDexSubSort("gainers");
                    setSortField("rank");
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    dexSubSort === "gainers" && sortField === "rank"
                      ? "bg-[#ccff00] text-black font-bold"
                      : "bg-[#141414] border border-[#242424] text-white hover:border-[#383838]"
                  }`}
                >
                  <span>📈 Gainers</span>
                </button>

                {/* New Pairs */}
                <button
                  type="button"
                  onClick={() => {
                    setDexSubSort("new");
                    setSortField("rank");
                    setPage(1);
                  }}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                    dexSubSort === "new" && sortField === "rank"
                      ? "bg-[#ccff00] text-black font-bold"
                      : "bg-[#141414] border border-[#242424] text-white hover:border-[#383838]"
                  }`}
                >
                  <span>🌱 New Pairs</span>
                </button>

                <MarketFilterPanel
                  value={marketFilters}
                  onChange={setMarketFilters}
                  onPreset={(preset) => {
                    setMarketFilters(PRESETS[preset]);
                    setSortField("rank");
                    if (preset === "newLaunches") setDexSubSort("new");
                    else { setDexSubSort("trending"); setDexTimeframe("5m"); }
                  }}
                  shown={displayedTokens.length}
                  total={dexTokens.length}
                />
              </div>
            ) : (
              /* Aggregated DEX Sub-Filters: All, DEX Pairs, Bonding Curves, Top Gainers */
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: "all", label: "All Launches", icon: Layers },
                  { id: "dex", label: "DEX Pairs", icon: Zap },
                  { id: "bonding", label: "Bonding Curves", icon: Rocket },
                  { id: "gainers", label: "Top Gainers", icon: ArrowUpDown },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = aggregatedSubTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        handleAggregatedSubTabChange(tab.id as AggregatedSubTab);
                      }}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                        isActive
                          ? "bg-[#ccff00] text-black font-bold"
                          : "bg-[#141414] border border-[#242424] text-white hover:border-[#383838]"
                      }`}
                    >
                      <Icon className="size-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Search Input & Refresh */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-[220px]">
              {isSearchingExternal ? (
                <Loader2 className="absolute left-3 top-2.5 size-3.5 text-[#ccff00] animate-spin" />
              ) : (
                <Search className="absolute left-3 top-2.5 size-3.5 text-[#f0f0f0]" />
              )}
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter token, symbol, address..."
                className="w-full rounded-lg border border-[#262626] bg-[#141414] pl-9 pr-3 py-1.5 text-xs text-white placeholder-[#888] focus:border-[#ccff00] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={refreshNow}
              disabled={isRefreshing}
              title="Refresh Feed"
              aria-label="Refresh Feed"
              className="rounded-lg border border-[#262626] bg-[#141414] p-2 text-white hover:border-[#ccff00] hover:text-[#ccff00] transition-colors cursor-pointer disabled:cursor-wait"
            >
              <RefreshCw className={`size-3.5 ${isCurrentLoading || isRefreshing ? "animate-spin text-[#ccff00]" : ""}`} />
            </button>
            <span className="hidden whitespace-nowrap text-[10px] text-[#8a8a8a] sm:inline" aria-live="polite">
              {updatedAgo === null ? "Auto 30s" : `Updated ${updatedAgo < 5 ? "now" : `${updatedAgo}s ago`} · auto 30s`}
            </span>
          </div>
        </div>
      </div>

      {errorNotice && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-2 text-xs text-red-400 mt-3">
          {errorNotice}
        </div>
      )}

      {/* ── MAIN HIGH-DENSITY TABLE (SPACIOUS UNISWAP LAUNCHES STYLE) ── */}
      <div aria-busy={showLaunchSkeleton} className="mt-4 rounded-2xl border border-[#242827] bg-[#0b0e0d] overflow-hidden text-xs shadow-2xl">
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
                  className="px-5 py-3.5 min-w-[240px] text-left cursor-pointer hover:text-white transition-colors"
                  onClick={() => handleSort("rank")}
                >
                  <div className="flex items-center gap-1">
                    <span>TOKEN</span>
                    <ArrowUpDown className="size-3 opacity-60" />
                  </div>
                </th>
                <th className="px-5 py-3.5 min-w-[150px] text-left">LAUNCHPAD / MARKET</th>
                <th
                  className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                  onClick={() => handleSort("mcap")}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>FDV</span>
                    <ArrowUpDown className="size-3 opacity-60" />
                  </div>
                </th>
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
                    <span>{aggregatedSubTab === "bonding" ? "RAISE" : "LIQUIDITY"}</span>
                    <ArrowUpDown className="size-3 opacity-60" />
                  </div>
                </th>
                <th
                  className="px-5 py-3.5 text-right cursor-pointer hover:text-white transition-colors"
                  onClick={() => handleSort("m5")}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>5M</span>
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
                  onClick={() => handleSort("age")}
                >
                  <div className="flex items-center justify-end gap-1">
                    <span>AGE</span>
                    <ArrowUpDown className="size-3 opacity-60" />
                  </div>
                </th>
                <th className="px-5 py-3.5 text-center min-w-[110px]">ACTION</th>
              </tr>
            </thead>
            <tbody>
              {showLaunchSkeleton && Array.from({ length: 6 }, (_, row) => (
                <tr key={`filter-skeleton-${row}`} aria-hidden="true" className="bg-[#0e1110]">
                  <td className="px-5 py-4"><ShimmerBlock className="h-3 w-4 rounded" /></td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <ShimmerBlock className="size-10 shrink-0 rounded-full" />
                      <div className="space-y-2">
                        <ShimmerBlock className="h-3 w-28 rounded" />
                        <ShimmerBlock className="h-2.5 w-20 rounded" />
                      </div>
                    </div>
                  </td>
                  {Array.from({ length: 9 }, (_, col) => (
                    <td key={col} className="px-5 py-4"><ShimmerBlock className="ml-auto h-3 w-16 rounded" /></td>
                  ))}
                  <td className="px-5 py-4"><ShimmerBlock className="ml-auto h-7 w-20 rounded-full" /></td>
                </tr>
              ))}
              {!showLaunchSkeleton && paginatedTokens.map((token, idx) => {
                const isBonding = token.isBondingCurve;
                const quoteSymbol = token.quoteToken?.symbol || "ETH";
                const overallRank = startIndex + idx + 1;

                return (
                  <tr
                    key={token.pairAddress || `${token.address}-${idx}`}
                    onClick={() => handleRowClick(token)}
                    onMouseEnter={() => {
                      if (!token.isBondingCurve || !token.launchpadUrl) {
                        router.prefetch(`/trade/${token.address}`);
                      }
                    }}
                    className="border border-[#202424] bg-[#0e1110] odd:bg-[#0e1110] even:bg-[#111413] hover:bg-[#181c17] hover:border-[#2b382a] transition-colors cursor-pointer group [&>td+td]:border-l [&>td+td]:border-l-white/[0.06]"
                  >
                    {/* # Rank */}
                    <td className="px-5 py-4.5 text-center text-[#9ca4a0] font-medium border-y border-l-2 border-l-transparent group-hover:border-l-[#ccff00] first:rounded-l-lg group-hover:text-white transition-colors">
                      {overallRank}
                    </td>

                    {/* Token Info (Uniswap 2-line layout) */}
                    <td className="px-5 py-4.5 border-y border-[#202424]">
                      <div className="flex items-center gap-3.5">
                        <div className="relative shrink-0">
                          <TokenIcon
                            address={token.address}
                            symbol={token.symbol}
                            explorerUrl={explorerWebUrl}
                            metadataUri={token.avatarUrl || null}
                            className="size-10 rounded-full overflow-hidden shrink-0 border border-[#262626] bg-[#141414] object-cover"
                            fallbackClassName={
                              isBonding ? "text-[#ffaa22]" : token.isStock ? "text-[#ccff00]" : "text-white"
                            }
                          />
                          <div className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full border border-[#111111] bg-[#1a1a1a] flex items-center justify-center text-[8px] shadow-sm">
                            {isBonding ? (
                              <span title="Bonding Curve">🚀</span>
                            ) : token.isStock ? (
                              <span title="Robinhood RWA">🏛️</span>
                            ) : (
                              <span className="text-[#ccff00]" title={token.venue || "Robinhood DEX"}>⚡</span>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              title={token.name || token.symbol}
                              className={`font-semibold text-white text-[14px] truncate max-w-[180px] transition-colors ${
                                isBonding ? "group-hover:text-[#ffaa22]" : "group-hover:text-[#ccff00]"
                              }`}
                            >
                              {token.name || token.symbol}
                            </span>
                            {(token.boostScore ?? 0) > 0 && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-[#ffaa22]/15 text-[#ffaa22] border border-[#ffaa22]/30 px-1.5 py-0.2 text-[9px] font-bold">
                                <span>⚡</span>
                                <span>{token.boostScore}</span>
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {/* Capped: one live token's symbol is a 28,161-char ticker list with no spaces,
                                and an uncapped cell widened the whole column to 220,000 px. */}
                            <span title={token.symbol} className="text-xs font-mono uppercase text-[#888888] tracking-wider truncate max-w-[140px]">
                              {token.symbol}
                            </span>
                            <span className="shrink-0 text-[11px] font-mono text-[#8a928e]">/ {quoteSymbol}</span>
                            {token.dexVersion && (
                              <span className="shrink-0 rounded bg-[#1e1e1e] border border-[#2d2d2d] px-1 py-0.2 text-[8px] font-mono text-[#aaaaaa] uppercase font-bold">
                                {token.dexVersion}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Dedicated MARKET / LAUNCHPAD Column */}
                    <td className="px-5 py-4.5 text-left">
                      {isBonding ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-full bg-[#ffaa22]/15 text-[#ffaa22] border border-[#ffaa22]/30 px-2 py-0.5 text-[10px] font-bold">
                              {token.bondingProgress
                                ? `${token.bondingProgress.toFixed(0)}% BOND`
                                : "BONDING"}
                            </span>
                            <span className="text-xs text-white font-medium truncate max-w-[90px]">
                              {token.launchpadName || "Launchpad"}
                            </span>
                          </div>
                          <div className="w-24 h-1 bg-[#222222] rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#ffaa22] rounded-full transition-all"
                              style={{
                                width: `${Math.min(100, Math.max(0, token.bondingProgress || 0))}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : token.isStock ? (
                        <div className="space-y-0.5">
                          <Link
                            href={`/rwa/${token.address}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center rounded-full bg-[#ccff00]/15 text-[#ccff00] border border-[#ccff00]/30 px-2.5 py-0.5 text-[10px] font-bold hover:bg-[#ccff00] hover:text-black transition-colors"
                          >
                            {token.symbol === "SPY" || token.symbol === "QQQ" ? "ETF" : "EQUITY"}
                          </Link>
                          <div className="text-[11px] text-[#888888]">Robinhood RWA</div>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#38bdf8]/15 text-[#38bdf8] border border-[#38bdf8]/30 px-2 py-0.5 text-[10px] font-bold">
                              DEX
                            </span>
                            {/* DexScreener names an unlisted DEX by its contract address; shorten it. */}
                            <span title={token.venue || undefined} className="text-xs text-white font-medium truncate max-w-[140px]">
                              {token.venue && /^0x[0-9a-f]{40}$/i.test(token.venue)
                                ? `${token.venue.slice(0, 6)}…${token.venue.slice(-4)}`
                                : token.venue || "Robinhood DEX"}
                            </span>
                          </div>
                          {token.pairAddress && (
                            <div className="text-[10px] font-mono text-[#888888] hover:text-[#ccff00] transition-colors">
                              <a
                                href={`${explorerWebUrl}/address/${token.pairAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={`Pool contract: ${token.pairAddress}`}
                                className="inline-flex items-center gap-0.5"
                              >
                                <span>
                                  {token.pairAddress.slice(0, 6)}…{token.pairAddress.slice(-4)}
                                </span>
                                <ExternalLink className="size-2.5 opacity-60" />
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* FDV */}
                    <td className="px-5 py-4.5 text-right font-medium text-[#8fd8ff] text-[13px]">
                      {formatCompactUsd(token.marketCap)}
                    </td>

                    {/* PRICE (with subscript zero notation) */}
                    <td className="px-5 py-4.5 text-right font-mono text-white text-[13px] font-medium">
                      {formatSubscriptPrice(token.priceUsd, token.isStock)}
                    </td>

                    {/* 24H VOLUME */}
                    <td className="px-5 py-4.5 text-right font-medium text-white text-[13px]">
                      {formatCompactUsd(token.volume24h)}
                    </td>

                    {/* LIQUIDITY / RAISE */}
                    <td className="px-5 py-4.5 text-right font-medium text-white text-[13px]">
                      {isBonding && token.raisedText ? (
                        <span className="text-[#ffaa22] font-semibold">{token.raisedText}</span>
                      ) : (
                        formatCompactUsd(token.liquidityUsd)
                      )}
                    </td>

                    {/* 5M */}
                    <td className="px-5 py-4.5 text-right">
                      {renderChangeIndicator(token.priceChange.m5)}
                    </td>

                    {/* 1H */}
                    <td className="px-5 py-4.5 text-right">
                      {renderChangeIndicator(token.priceChange.h1)}
                    </td>

                    {/* 1D (24H) */}
                    <td className="px-5 py-4.5 text-right">
                      {renderChangeIndicator(token.priceChange.h24)}
                    </td>

                    {/* AGE */}
                    <td className="px-5 py-4.5 text-right font-mono text-xs" style={{ color: ageColor(token.createdAtMs, nowMs) }}>
                      {token.age}
                    </td>

                    {/* ACTION: TRADE LINK OR LAUNCHPAD */}
                    <td className="px-5 py-4.5 text-center">
                      {isBonding ? (
                        <a
                          href={token.launchpadUrl || "#"}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 rounded-full bg-[#ffaa22]/15 text-[#ffaa22] border border-[#ffaa22]/30 px-3.5 py-1 text-xs font-bold hover:bg-[#ffaa22] hover:text-black transition-colors cursor-pointer shadow-sm"
                        >
                          <span>BUY CURVE</span>
                          <ExternalLink className="size-2.5" />
                        </a>
                      ) : (
                        <div
                          className="flex items-center justify-center gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleRowClick(token)}
                            className="rounded-full bg-[#ccff00]/15 hover:bg-[#ccff00] text-[#ccff00] hover:text-black border border-[#ccff00]/40 px-3.5 py-1 text-xs font-bold transition-all cursor-pointer shadow-sm"
                          >
                            Trade
                          </button>
                          {token.pairAddress && (
                            <a
                              href={`https://dexscreener.com/robinhood/${token.pairAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="View on DexScreener"
                              className="p-1.5 rounded-full border border-[#2a2a2a] bg-[#141414] text-[#888888] hover:text-[#ccff00] hover:border-[#ccff00] transition-colors cursor-pointer"
                            >
                              <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {paginatedTokens.length === 0 && !isCurrentLoading && !showLaunchSkeleton && (
                <tr>
                  <td colSpan={12} className="px-6 py-16 text-center text-xs text-white">
                    {isSearchingExternal ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-8">
                        <Loader2 className="size-5 text-[#ccff00] animate-spin" />
                        <span className="text-xs font-mono text-white">
                          Searching live DEX venues across Robinhood Chain...
                        </span>
                      </div>
                    ) : selectedPads.length > 0 && !searchQuery.trim() ? (
                      <div className="py-8 text-center text-xs font-mono text-[#888888]">
                        No launches found for the selected launchpads.
                      </div>
                    ) : searchQuery.trim().startsWith("0x") ? (
                      <div className="max-w-md mx-auto space-y-3">
                        <p className="text-sm font-semibold text-white">
                          No pools found for address{" "}
                          <span className="font-mono text-[#ccff00] break-all">{searchQuery.trim()}</span>.
                        </p>
                        <p className="text-[11px] text-[#f0f0f0] leading-relaxed">
                          This contract address has no active liquidity pools deployed or indexed yet on
                          Robinhood Chain.
                        </p>
                        <div className="pt-2 flex items-center justify-center gap-3">
                          <Link
                            href={`/trade/${searchQuery.trim()}`}
                            className="rounded-full border border-[#ccff00] bg-[#ccff00] px-4 py-1.5 text-xs font-bold text-black hover:bg-[#b8e600] transition-colors inline-flex items-center gap-1.5 shadow-md"
                          >
                            <Zap className="size-3.5" />
                            Open in Trade Terminal
                          </Link>
                          <Link
                            href={`/scan/${searchQuery.trim()}`}
                            className="rounded-full border border-[#2a2a2a] bg-[#141414] px-4 py-1.5 text-xs font-mono text-white hover:border-[#ccff00] transition-colors inline-flex items-center gap-1.5"
                          >
                            Run Security Audit 🛡️
                          </Link>
                        </div>
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs font-mono text-[#888888]">
                        No tracked tokens or DEX venues match &quot;{searchQuery}&quot; on Robinhood Chain.
                      </div>
                    )}
                  </td>
                </tr>
              )}

              {isCurrentLoading && !showLaunchSkeleton && (
                <tr>
                  <td colSpan={12} className="px-6 py-12 text-center text-xs text-white">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="size-4 animate-spin text-[#ccff00]" />
                      <span>Loading live market rows...</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ── BOTTOM-LEFT PAGE-WISE PAGINATION ── */}
        <div className="border-t border-[#1f1f1f] bg-[#0c0c0c] px-4 py-3 flex flex-wrap items-center justify-between gap-4">
          {/* Bottom Left: Showing pairs & Next/Prev Controls */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-white text-xs font-mono">
              Showing pairs{" "}
              <span className="text-[#ccff00] font-bold">
                {totalItems > 0 ? startIndex + 1 : 0}
              </span>
              –
              <span className="text-[#ccff00] font-bold">
                {Math.min(startIndex + pageSize, totalItems)}
              </span>{" "}
              of <span className="text-white font-bold">{totalItems.toLocaleString("en-US")}</span>
            </span>

            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={currentPage <= 1 || isCurrentLoading}
                className="flex items-center gap-1 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-xs font-mono font-bold text-white hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-30 disabled:hover:border-[#2a2a2a] disabled:hover:text-white transition-colors cursor-pointer"
              >
                <ChevronLeft className="size-3.5" />
                <span>Prev Page</span>
              </button>

              <span className="px-2 text-xs font-mono text-white font-bold">
                Page {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={handleNextPage}
                disabled={
                  (currentPage >= totalPages &&
                    (primaryTab === "robinhood-pairs" || !cursor)) ||
                  isCurrentLoading ||
                  isLoadingMore
                }
                className="flex items-center gap-1 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 text-xs font-mono font-bold text-white hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-30 disabled:hover:border-[#2a2a2a] disabled:hover:text-white transition-colors cursor-pointer"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin text-[#ccff00]" />
                    <span>Loading...</span>
                  </>
                ) : (
                  <>
                    <span>Next Page</span>
                    <ChevronRight className="size-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="text-[11px] text-[#f0f0f0] font-mono">
            {primaryTab === "robinhood-pairs"
              ? "Live DEX venue stream for Robinhood Chain (ID: 4663)"
              : "Direct on-chain launches & bonding curves indexed"}
          </div>
        </div>
      </div>
    </div>
  );
}
