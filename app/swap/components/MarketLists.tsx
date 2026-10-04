"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Flame, RefreshCw, TrendingUp } from "lucide-react";
import type { RwaMarketRow } from "@/app/api/rwa/feed/route";
import { ShimmerBlock } from "@/app/components/site/Skeleton";

const PANEL = "border border-white/[0.08] bg-[#101110]/90 shadow-[0_20px_80px_rgba(0,0,0,.22)]";
const ROW = "group flex items-center gap-2.5 sm:gap-3 border-t border-white/[0.06] px-3.5 py-3 transition-colors hover:bg-white/[0.035] sm:px-5";

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function changeOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

import { formatDexPrice } from "@/lib/trade/format";

export function fmtUsd(value: number | null, _digits = 2): string {
  return formatDexPrice(value);
}

function fmtCompact(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[13px] text-[#70736d]">—</span>;
  const positive = value >= 0;
  const abs = Math.abs(value);
  const formatted = abs >= 1000 ? value.toFixed(0) : value.toFixed(2);
  return (
    <span className={`font-mono text-[13px] tabular-nums whitespace-nowrap ${positive ? "text-[#ccff00]" : "text-[#ff8b83]"}`}>
      {positive ? "+" : ""}{formatted}%
    </span>
  );
}

export function shouldRetryIncompleteRwaQuotes(quotesComplete: unknown, alreadyRetried: boolean): boolean {
  return quotesComplete === false && !alreadyRetried;
}

/** Same shape as a loaded row (rank, avatar, name, price/volume, change), so nothing jumps on arrival. */
function LoadingRows() {
  return <div aria-label="Loading markets" aria-busy="true">{[0, 1, 2, 3, 4, 5].map((n) => <div key={n} className={ROW}>
    <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
      <ShimmerBlock className="h-3 w-4 shrink-0 rounded sm:w-5" />
      <ShimmerBlock className="h-8 w-8 shrink-0 rounded-full sm:h-9 sm:w-9" />
      <span className="min-w-0 flex-1 space-y-1.5">
        <ShimmerBlock className="h-4 w-16 rounded" />
        <ShimmerBlock className="h-3 w-28 rounded" />
      </span>
    </div>
    <span className="flex min-w-[5.2rem] shrink-0 flex-col items-end gap-1.5">
      <ShimmerBlock className="h-3.5 w-16 rounded" />
      <ShimmerBlock className="h-3 w-12 rounded" />
    </span>
    <span className="flex min-w-[5rem] shrink-0 justify-end"><ShimmerBlock className="h-3.5 w-12 rounded" /></span>
  </div>)}</div>;
}

export function PopularRwas() {
  const [rows, setRows] = useState<RwaMarketRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [updated, setUpdated] = useState<number | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const autoRetryUsed = useRef(false);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let retryTimer: number | null = null;
    // A cold feed also verifies RWA authenticity before enriching prices.
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    const readJson = async (url: string) => {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
      if (!response.ok) throw new Error("RWA feed unavailable");
      return response.json() as Promise<Record<string, unknown>>;
    };
    Promise.all([readJson("/api/rwa/feed"), readJson("/api/rwa/official-assets")])
      .then(([data, official]) => {
        if (disposed) return;
        const officialAddresses = new Set(Array.isArray(official.assets)
          ? official.assets.flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const address = (item as { address?: unknown }).address;
            return isAddress(address) ? [address.toLowerCase()] : [];
          }) : []);
        const safe = Array.isArray(data.tokens) ? data.tokens.filter((item): item is RwaMarketRow => {
          if (!item || typeof item !== "object") return false;
          const row = item as Partial<RwaMarketRow>;
          return row.trusted === true && row.verify_status === "ok" &&
            typeof row.address === "string" && /^0x[a-fA-F0-9]{40}$/.test(row.address) &&
            officialAddresses.has(row.address.toLowerCase()) &&
            typeof row.asset_symbol === "string" && /^[A-Za-z0-9._-]{1,12}$/.test(row.asset_symbol) &&
            (row.priceUsd === null || typeof row.priceUsd === "number" && Number.isFinite(row.priceUsd));
        }).slice(0, 100) : [];
        safe.sort((a, b) => (numberOrNull(b.volume24hUsd) ?? 0) - (numberOrNull(a.volume24hUsd) ?? 0));
        const nextRows = safe.slice(0, 8);
        rowsRef.current = nextRows;
        setRows(nextRows);
        setState(safe.length ? "ready" : "empty");
        setUpdated(Date.now());
        if (shouldRetryIncompleteRwaQuotes(data.quotesComplete, autoRetryUsed.current)) {
          autoRetryUsed.current = true;
          retryTimer = window.setTimeout(() => setLoadAttempt((attempt) => attempt + 1), 5_000);
        }
      })
      .catch(() => { if (!disposed) setState(rowsRef.current.length ? "ready" : "error"); })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [loadAttempt]);

  return <section className={PANEL} aria-labelledby="popular-rwas-title">
    <header className="flex items-start justify-between gap-3 px-4 pb-4 pt-5 sm:px-5">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-[.2em] text-[#ccff00]"><span className="h-1.5 w-1.5 rounded-full bg-[#ccff00] shadow-[0_0_10px_#ccff00]" /> Robinhood assets</div><h2 id="popular-rwas-title" className="text-[21px] font-semibold tracking-tight text-[#f2f3ed]">Popular RWAs</h2><p className="mt-1 text-[13px] text-[#82857e]">Stock Tokens and ETFs by 24h onchain volume</p></div>
      <Link href="/rwa" className="mt-1 inline-flex shrink-0 items-center gap-1 text-[13px] text-[#aeb1a9] transition-colors hover:text-[#ccff00]">All assets <ArrowUpRight size={13} /></Link>
    </header>
    <div className="flex items-center gap-2.5 sm:gap-3 px-3.5 pb-2 text-[11px] font-mono uppercase tracking-[.16em] text-[#686b65] sm:px-5">
      <span className="flex-1 min-w-0">Asset</span>
      <span className="text-right shrink-0 min-w-[5.2rem]">Price</span>
      <span className="min-w-[5rem] text-right shrink-0">24h</span>
    </div>
    {state === "loading" ? <LoadingRows /> : state === "error" ? <div className="border-t border-white/[0.06] px-5 py-10 text-center text-[15px] text-[#858780]">Could not load Robinhood assets. <button type="button" onClick={() => { autoRetryUsed.current = false; if (!rowsRef.current.length) setState("loading"); setLoadAttempt((attempt) => attempt + 1); }} className="underline underline-offset-2 hover:text-[#ccff00]">Try again</button>.</div> : state === "empty" ? <div className="border-t border-white/[0.06] px-5 py-10 text-center text-[15px] text-[#858780]">No listed assets are available right now.</div> : <div>{rows.map((asset, index) => <Link key={asset.address} href={`/rwa/${asset.address}`} className={ROW}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        <span className="w-4 sm:w-5 shrink-0 font-mono text-xs text-[#62655f]">{String(index + 1).padStart(2, "0")}</span>
        <span className="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#1d201b] text-xs font-bold text-[#d9ded1]">{asset.asset_symbol.slice(0, 2)}<img src={`https://cdn.robinhood.com/ncw_assets/logos/${asset.address.toLowerCase()}.png`} alt="" className="absolute inset-0 h-full w-full object-contain bg-[#1d201b] p-1" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] sm:text-[15px] font-semibold text-[#e9ebe4] group-hover:text-white">{asset.asset_symbol}</span>
          <span className="block truncate text-xs text-[#777a73]">{asset.asset_name}</span>
        </span>
      </div>
      <span className="min-w-[5.2rem] text-right shrink-0">
        <span className="block font-mono text-[13px] tabular-nums text-[#d9dbd4]">{fmtUsd(numberOrNull(asset.priceUsd), 4)}</span>
        <span className="block text-xs text-[#747770]">Vol ${fmtCompact(numberOrNull(asset.volume24hUsd))}</span>
      </span>
      <span className="min-w-[5rem] text-right shrink-0"><Change value={changeOrNull(asset.changeH24)} /></span>
    </Link>)}</div>}
    <footer className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-xs text-[#696c66] sm:px-5"><span>Market data from Robinhood Chain listings</span><span className="inline-flex items-center gap-1.5"><RefreshCw size={10} className={state === "loading" ? "animate-spin" : ""} />{updated ? `Updated ${new Date(updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Live feed"}</span></footer>
  </section>;
}

type Pair = {
  chainId?: unknown; pairAddress?: unknown; dexId?: unknown;
  baseToken?: { address?: unknown; name?: unknown; symbol?: unknown };
  quoteToken?: { symbol?: unknown };
  priceUsd?: unknown;
  volume?: { h24?: unknown };
  priceChange?: { h24?: unknown };
  liquidity?: { usd?: unknown };
};
type RankedToken = { address: string; name: string; symbol: string; price: number | null; volume: number | null; change: number | null; liquidity: number | null; dex: string };
const DEX = "https://api.dexscreener.com";

function isAddress(value: unknown): value is string { return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value); }
function asFinite(value: unknown): number | null { const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN; return Number.isFinite(n) && n >= 0 ? n : null; }

async function dexJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`DexScreener returned ${response.status}`);
  return response.json();
}

export function PopularTokens() {
  const [tokens, setTokens] = useState<RankedToken[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [updated, setUpdated] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    const load = async () => {
      try {
        const feeds = await Promise.allSettled([
          dexJson(`${DEX}/token-boosts/top/v1`, controller.signal),
          dexJson(`${DEX}/token-boosts/latest/v1`, controller.signal),
          dexJson(`${DEX}/token-profiles/latest/v1`, controller.signal),
        ]);
        const addresses = new Set<string>();
        for (const result of feeds) {
          if (result.status !== "fulfilled" || !Array.isArray(result.value)) continue;
          for (const entry of result.value.slice(0, 150)) {
            if (entry && typeof entry === "object") {
              const item = entry as { chainId?: unknown; tokenAddress?: unknown };
              if (typeof item.chainId === "string" && item.chainId.toLowerCase() === "robinhood" && isAddress(item.tokenAddress)) addresses.add(item.tokenAddress.toLowerCase());
            }
          }
        }
        const batch = [...addresses].slice(0, 30);
        if (!batch.length) { if (!disposed) { setTokens([]); setState("empty"); setUpdated(Date.now()); } return; }
        const pairData = await dexJson(`${DEX}/tokens/v1/robinhood/${batch.join(",")}`, controller.signal);
        const pairs = Array.isArray(pairData) ? pairData as Pair[] : [];
        const best = new Map<string, RankedToken>();
        const discovered = new Set(batch);
        for (const pair of pairs.slice(0, 300)) {
          if (!pair || typeof pair !== "object" || typeof pair.chainId !== "string" || pair.chainId.toLowerCase() !== "robinhood" || !isAddress(pair.baseToken?.address)) continue;
          const address = pair.baseToken.address.toLowerCase();
          if (!discovered.has(address)) continue;
          const symbol = typeof pair.baseToken?.symbol === "string" ? pair.baseToken.symbol.slice(0, 16) : "TOKEN";
          const candidate: RankedToken = {
            address, symbol, name: typeof pair.baseToken?.name === "string" ? pair.baseToken.name.slice(0, 48) : symbol,
            price: asFinite(pair.priceUsd), volume: asFinite(pair.volume?.h24), change: typeof pair.priceChange?.h24 === "number" && Number.isFinite(pair.priceChange.h24) ? pair.priceChange.h24 : null,
            liquidity: asFinite(pair.liquidity?.usd), dex: typeof pair.dexId === "string" ? pair.dexId.slice(0, 20) : "Robinhood Chain",
          };
          const previous = best.get(address);
          if (!previous || (candidate.volume ?? -1) > (previous.volume ?? -1)) best.set(address, candidate);
        }
        // Filter exclusively for positive gainers (pumps) and exclude dumps / rugs (change <= 0)
        const ranked = [...best.values()]
          .filter((candidate) => typeof candidate.change === "number" && candidate.change > 0)
          .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1))
          .slice(0, 8);
        if (!disposed) { setTokens(ranked); setState(ranked.length ? "ready" : "empty"); setUpdated(Date.now()); }
      } catch {
        if (!disposed) setState("error");
      }
    };
    void load();
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, []);

  const subtitle = useMemo(() => state === "ready" ? "DexScreener top gainers · sorted by 24h volume" : "Live Robinhood Chain gainers · DexScreener", [state]);
  return <section className={PANEL} aria-labelledby="popular-tokens-title">
    <header className="flex items-start justify-between gap-3 px-4 pb-4 pt-5 sm:px-5">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-mono uppercase tracking-[.2em] text-[#91a5ff]"><Flame size={12} /> Onchain markets</div><h2 id="popular-tokens-title" className="text-[21px] font-semibold tracking-tight text-[#f2f3ed]">Popular tokens</h2><p className="mt-1 text-[13px] text-[#82857e]">{subtitle}</p></div>
      <span className="mt-1 rounded-full border border-[#91a5ff]/20 bg-[#91a5ff]/[0.07] px-2.5 py-1 text-xs font-mono text-[#aab8ff]">CHAIN 4663</span>
    </header>
    <div className="flex items-center gap-2.5 sm:gap-3 px-3.5 pb-2 text-[11px] font-mono uppercase tracking-[.16em] text-[#686b65] sm:px-5">
      <span className="flex-1 min-w-0">Token</span>
      <span className="text-right shrink-0 min-w-[5.2rem]">Price</span>
      <span className="min-w-[5rem] text-right shrink-0">24h</span>
    </div>
    {state === "loading" ? <LoadingRows /> : state === "error" ? <div className="border-t border-white/[0.06] px-5 py-10 text-center text-[15px] text-[#858780]">DexScreener data is temporarily unavailable.</div> : state === "empty" ? <div className="border-t border-white/[0.06] px-5 py-10 text-center text-[15px] text-[#858780]">No Robinhood Chain token pairs were returned.</div> : <div>{tokens.map((token, index) => <Link key={token.address} href={`/trade/${token.address}`} className={ROW}>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
        <span className="w-4 sm:w-5 shrink-0 font-mono text-xs text-[#62655f]">{String(index + 1).padStart(2, "0")}</span>
        <span className="relative flex h-8 w-8 sm:h-9 sm:w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-[#1c2026] text-[13px] font-bold text-[#cbd2ef]">{token.symbol.slice(0, 1)}<img src={`https://dd.dexscreener.com/ds-data/tokens/robinhood/${token.address}.png`} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] sm:text-[15px] font-semibold text-[#e9ebe4] group-hover:text-white">{token.symbol}</span>
          <span className="block truncate text-xs text-[#777a73]">{token.name} <span className="text-[#555851]">· {token.dex}</span></span>
        </span>
      </div>
      <span className="min-w-[5.2rem] text-right shrink-0">
        <span className="block font-mono text-[13px] tabular-nums text-[#d9dbd4]">{token.price === null ? "—" : fmtUsd(token.price, 6)}</span>
        <span className="block text-xs text-[#747770]">Vol ${fmtCompact(token.volume)}</span>
      </span>
      <span className="min-w-[5rem] text-right shrink-0"><Change value={token.change} /></span>
    </Link>)}</div>}
    <footer className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-xs text-[#696c66] sm:px-5"><span className="inline-flex items-center gap-1.5"><TrendingUp size={11} /> Pair data scoped to Robinhood Chain</span><span className="inline-flex items-center gap-1.5"><RefreshCw size={10} className={state === "loading" ? "animate-spin" : ""} />{updated ? `Updated ${new Date(updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Live feed"}</span></footer>
  </section>;
}
