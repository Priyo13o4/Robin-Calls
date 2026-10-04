"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import {
  X,
  ExternalLink,
  BarChart2,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type { SelectableToken } from "@/lib/trade/types";
import {
  fetchTopPoolForToken,
  type GeckoTopPool,
  getGeckoCooldownRemainingMs,
} from "@/lib/trade/gecko-top-pool";

export interface SwapMarketPanelProps {
  token: SelectableToken | null;
  open: boolean;
  onClose: () => void;
  onPoolChange?: (pool: string | null) => void;
}

function formatUsdValue(val: number | null): string {
  if (val === null || !Number.isFinite(val)) return "—";
  if (val === 0) return "$0.00";
  if (val >= 1_000_000_000) {
    return `$${(val / 1_000_000_000).toFixed(2)}B`;
  }
  if (val >= 1_000_000) {
    return `$${(val / 1_000_000).toFixed(2)}M`;
  }
  if (val >= 1_000) {
    return `$${(val / 1_000).toFixed(2)}K`;
  }
  if (val < 0.01) {
    return `$${val.toFixed(4)}`;
  }
  return `$${val.toFixed(2)}`;
}

function formatChangePercentage(val: number | null): {
  text: string;
  colorClass: string;
  isPositive: boolean | null;
} {
  if (val === null || !Number.isFinite(val)) {
    return { text: "—", colorClass: "text-[#8b918a]", isPositive: null };
  }
  const prefix = val > 0 ? "+" : "";
  const text = `${prefix}${val.toFixed(2)}%`;
  if (val > 0) {
    return { text, colorClass: "text-[#ccff00]", isPositive: true };
  }
  if (val < 0) {
    return { text, colorClass: "text-rose-400", isPositive: false };
  }
  return { text, colorClass: "text-[#8b918a]", isPositive: null };
}

function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function SwapMarketPanel({
  token,
  open,
  onClose,
  onPoolChange,
}: SwapMarketPanelProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<GeckoTopPool | null>(null);
  const [reloadAttempt, setReloadAttempt] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentTokenRef = useRef<string | null>(null);
  const lastNotifiedPoolRef = useRef<string | null>(null);

  // Desktop media query guard (min-width: 1024px corresponds to Tailwind lg breakpoint)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(mql.matches);

    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
    };

    mql.addEventListener("change", onChange);
    return () => {
      mql.removeEventListener("change", onChange);
    };
  }, []);

  // Handle Escape key to close panel
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  // Notify parent component on pool changes
  const notifyPoolChange = useCallback(
    (newPoolAddress: string | null) => {
      if (lastNotifiedPoolRef.current !== newPoolAddress) {
        lastNotifiedPoolRef.current = newPoolAddress;
        onPoolChange?.(newPoolAddress);
      }
    },
    [onPoolChange]
  );

  // On-demand loader: triggers strictly when open, on desktop, and for the selected token
  useEffect(() => {
    // 1. Guard against closed panel or mobile device: no request on mobile or when closed
    if (!open || !isDesktop || !token?.address) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setLoading(false);
      setError(null);
      setPool(null);
      notifyPoolChange(null);
      return;
    }

    const tokenAddress = token.address.toLowerCase();
    currentTokenRef.current = tokenAddress;

    // Abort previous in-flight request on token change or reload
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetchTopPoolForToken(tokenAddress, { signal: controller.signal })
      .then((resolvedPool) => {
        // Stale response guard: ensure token hasn't changed while request was in-flight
        if (currentTokenRef.current !== tokenAddress) return;

        setPool(resolvedPool);
        setLoading(false);
        setError(null);
        notifyPoolChange(resolvedPool?.poolAddress ?? null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (currentTokenRef.current !== tokenAddress) return;

        const errMsg =
          err instanceof Error
            ? err.message
            : "Failed to load market data for token.";
        setError(errMsg);
        setPool(null);
        setLoading(false);
        notifyPoolChange(null);
      });

    return () => {
      controller.abort();
    };
  }, [open, isDesktop, token?.address, reloadAttempt, notifyPoolChange]);

  // While closed, render nothing: no DOM, no iframe, no network
  if (!open) {
    return null;
  }

  // Construct iframe embed URL once pool is resolved
  const iframeSrc = pool && token?.address
    ? `https://www.geckoterminal.com/robinhood/pools/${encodeURIComponent(pool.poolAddress)}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&display_currency=usd&token_address=${encodeURIComponent(token.address.toLowerCase())}`
    : null;

  const changeInfo = formatChangePercentage(pool?.priceChange24h ?? null);
  const tradeHref = pool && token?.address
    ? `/trade/${encodeURIComponent(token.address)}`
    : null;

  return (
    <div
      role="region"
      aria-label="Market Chart and Pool Metrics"
      className="hidden lg:flex flex-col w-full rounded-[24px] border border-white/[0.08] bg-[#0e1013] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.65)] font-sans text-[#f0f1ed]"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#ccff00]/10 border border-[#ccff00]/25 text-[#ccff00]">
            <BarChart2 className="size-4" />
          </div>
          <div className="min-w-0 flex items-baseline gap-2">
            <h3 className="font-semibold text-sm tracking-wide text-[#f0f1ed] truncate">
              {token?.symbol ? `${token.symbol} Chart` : "Market Chart"}
            </h3>
            <span className="text-[11px] font-mono text-[#8b918a] shrink-0">
              GeckoTerminal
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Close button with accessible labeling and focus state */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close market chart panel"
            className="flex size-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-[#8b918a] transition-colors hover:border-white/20 hover:bg-white/[0.08] hover:text-[#f0f1ed] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ccff00]"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading && (
        <div className="flex h-[420px] w-full flex-col items-center justify-center rounded-xl border border-white/[0.04] bg-[#08090b]/80 p-6 text-center">
          <div className="size-8 animate-spin rounded-full border-2 border-white/10 border-t-[#ccff00] mb-3" />
          <p className="text-sm font-medium text-[#e8eae5]">
            Resolving top liquidity pool…
          </p>
          <p className="mt-1 text-xs text-[#8b918a]">
            Checking GeckoTerminal for deepest active pool
          </p>
        </div>
      )}

      {!loading && error && (
        <div className="flex h-[420px] w-full flex-col items-center justify-center rounded-xl border border-rose-500/20 bg-rose-950/10 p-6 text-center">
          <AlertCircle className="size-8 text-rose-400 mb-2" />
          <p className="text-sm font-medium text-rose-200">
            Unable to load market data
          </p>
          <p className="mt-1 max-w-sm text-xs text-rose-300/70">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setReloadAttempt((n) => n + 1)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-[#f0f1ed] transition-colors hover:bg-white/[0.12] hover:text-white"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </button>
        </div>
      )}

      {!loading && !error && !pool && (
        <div className="flex h-[420px] w-full flex-col items-center justify-center rounded-xl border border-white/[0.04] bg-[#08090b]/80 p-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-white/[0.04] border border-white/[0.08] mb-3 text-[#8b918a]">
            <BarChart2 className="size-5" />
          </div>
          <p className="text-sm font-medium text-[#f0f1ed]">
            No active pool found
          </p>
          <p className="mt-1 max-w-xs text-xs text-[#8b918a] leading-relaxed">
            No liquidity pool with positive reserves was found matching{" "}
            <span className="text-[#e8eae5] font-semibold">{token?.symbol || "this token"}</span>{" "}
            on GeckoTerminal.
          </p>
          {getGeckoCooldownRemainingMs() > 0 && (
            <p className="mt-2 text-[11px] text-amber-400/80 font-mono">
              GeckoTerminal rate limit active. Backing off 60s.
            </p>
          )}
        </div>
      )}

      {/* When open and pool resolved: embed iframe and show pool metrics */}
      {!loading && !error && pool && iframeSrc && (
        <div className="flex flex-col gap-3">
          {/* GeckoTerminal iframe embed (mounted strictly when open & pool resolved) */}
          <div className="relative h-[380px] w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#08090b]">
            <iframe
              src={iframeSrc}
              title={`${token?.symbol || "Token"} GeckoTerminal Price Chart`}
              className="h-full w-full border-0"
              allow="clipboard-write"
            />
          </div>

          {/* Under-chart metrics strip - all metrics sourced from the single selected pool record */}
          <div className="rounded-xl border border-white/[0.06] bg-[#08090b] p-3">
            <div className="grid grid-cols-2 gap-2 2xl:grid-cols-4">
              {/* 24h Volume */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2">
                <span className="block text-[11px] uppercase tracking-wider text-[#8b918a]">
                  24h Volume
                </span>
                <span className="mt-0.5 block font-mono text-xs font-semibold text-[#f0f1ed]">
                  {formatUsdValue(pool.volume24hUsd)}
                </span>
              </div>

              {/* Liquidity */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2">
                <span className="block text-[11px] uppercase tracking-wider text-[#8b918a]">
                  Gecko liquidity
                </span>
                <span className="mt-0.5 block font-mono text-xs font-semibold text-[#f0f1ed]">
                  {formatUsdValue(pool.reserveInUsd)}
                </span>
              </div>

              {/* 24h Change */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2">
                <span className="block text-[11px] uppercase tracking-wider text-[#8b918a]">
                  24h Change
                </span>
                <div className="mt-0.5 flex items-center gap-1 font-mono text-xs font-semibold">
                  {changeInfo.isPositive === true && (
                    <TrendingUp className="size-3 text-[#ccff00]" />
                  )}
                  {changeInfo.isPositive === false && (
                    <TrendingDown className="size-3 text-rose-400" />
                  )}
                  <span className={changeInfo.colorClass}>
                    {changeInfo.text}
                  </span>
                </div>
              </div>

              {/* Buys / Sells */}
              <div className="rounded-lg bg-white/[0.02] border border-white/[0.03] p-2">
                <span className="block text-[11px] uppercase tracking-wider text-[#8b918a]">
                  Buys / Sells
                </span>
                <span className="mt-0.5 block font-mono text-xs font-semibold text-[#f0f1ed]">
                  {pool.buys24h !== null && pool.sells24h !== null
                    ? `${pool.buys24h.toLocaleString()} / ${pool.sells24h.toLocaleString()}`
                    : "—"}
                </span>
              </div>
            </div>

            {/* Pool identity and full terminal link */}
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.04] pt-2.5 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[#8b918a] shrink-0 font-medium">Pool:</span>
                <span className="font-mono text-[#e8eae5] truncate font-medium">
                  {pool.name ?? "—"}
                </span>
                <span className="font-mono text-[#8b918a] text-[11px] shrink-0">
                  ({formatAddress(pool.poolAddress)})
                </span>
              </div>

              {tradeHref && (
                <div className="flex items-center gap-2">
                  <a
                    href={`https://www.geckoterminal.com/robinhood/pools/${pool.poolAddress}?token_address=${token?.address ?? ""}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#a4aaa2] hover:text-white"
                  >
                    GeckoTerminal ↗
                  </a>
                  <Link
                    href={tradeHref}
                    className="inline-flex items-center gap-1 rounded-md bg-[#ccff00]/10 px-2.5 py-1 text-xs font-semibold text-[#ccff00] transition-colors hover:bg-[#ccff00]/20"
                  >
                    <span>Full trade page</span>
                    <ExternalLink className="size-3" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
