"use client";

import { useEffect, useState } from "react";
import {
  BarChart2,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import type { TokenMarketData } from "@/lib/trade/types";
import { explorerWebUrl } from "@/lib/config/chain";

export interface DexScreenerEmbedProps {
  token: TokenMarketData;
  className?: string;
}

export function DexScreenerEmbed({ token, className = "" }: DexScreenerEmbedProps) {
  const [interval] = useState<string>("15");
  const [isIframeLoading, setIsIframeLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [chartFailed, setChartFailed] = useState(false);
  const [chartSlow, setChartSlow] = useState(false);

  const rawPair = token.pairAddress || "";
  const pairAddress = (rawPair || token.address).toLowerCase().trim();

  // GeckoTerminal owns this embed. Another provider's indexing or outage
  // cannot tell us whether its chart exists.
  useEffect(() => {
    if (token.isBondingCurve) return;
    setIsIframeLoading(true);
    setChartFailed(false);
    setChartSlow(false);
    const timer = setTimeout(() => setChartSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, [pairAddress, token.isBondingCurve, reloadKey]);

  // Ungraduated bonding curves trade on launchpads before AMM migration;
  // DexScreener has no pair yet, so display bonding curve telemetry
  if (token.isBondingCurve) {
    return (
      <div className={`relative w-full rounded-xl overflow-hidden border border-[#222222] bg-[#0c0c0c] shadow-lg p-6 sm:p-8 flex flex-col justify-between min-h-[440px] sm:min-h-[490px] lg:flex-1 lg:min-h-0 font-mono ${className}`}>
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1c1c1c] pb-4">
          <div className="flex items-center gap-2">
            <span className="rounded-md border border-[#ff9900]/30 bg-[#ff9900]/10 px-2.5 py-1 text-phi-xs font-bold text-[#ffaa22]">
              BONDING CURVE ACTIVE
            </span>
            <span className="text-phi-xs text-[#8a8a8a]">
              Hosted on <strong className="text-[#ededea]">{token.launchpadName || "Launchpad"}</strong>
            </span>
          </div>
          {token.launchpadUrl && (
            <a
              href={token.launchpadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#ff9900]/40 bg-[#1c140a] px-3 py-1.5 text-phi-xs font-bold text-[#ffaa22] hover:bg-[#ff9900] hover:text-black transition-all shadow-sm"
            >
              <span>Trade on {token.launchpadName || "Launchpad"}</span>
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>

        {/* Center Telemetry Gauge */}
        <div className="my-auto py-6 max-w-xl mx-auto w-full text-center space-y-6">
          <div className="space-y-2">
            <div className="text-phi-xs text-[#777777] uppercase tracking-wider">
              Bonding Curve Progression
            </div>
            <div className="text-4xl sm:text-5xl font-black tracking-tight text-[#ededea]">
              {token.bondingProgress ? `${token.bondingProgress.toFixed(1)}%` : "0%"}
            </div>
            <p className="text-phi-xs text-[#8a8a8a] max-w-md mx-auto leading-relaxed">
              {token.raisedText ? `Raised: ${token.raisedText} · ` : ""}
              When target is 100% reached, liquidity will be deposited into Uniswap V4 and live DexScreener candlesticks will activate.
            </p>
          </div>

          {/* Large Progress Bar */}
          <div className="w-full h-3 bg-[#1c1c1c] rounded-full overflow-hidden border border-[#2a2a2a] p-0.5">
            <div
              className="h-full bg-gradient-to-r from-[#ff8800] via-[#ffaa22] to-[#ccff00] rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, token.bondingProgress || 0))}%` }}
            />
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left pt-2">
            <div className="rounded-lg border border-[#1f1f1f] bg-[#121212] p-2.5">
              <div className="text-phi-2xs text-[#666]">PRICE</div>
              <div className="text-phi-xs font-bold text-[#ededea] font-mono">
                {token.priceUsd > 0 ? `$${token.priceUsd.toFixed(6)}` : "$0.00"}
              </div>
            </div>
            <div className="rounded-lg border border-[#1f1f1f] bg-[#121212] p-2.5">
              <div className="text-phi-2xs text-[#666]">MARKET CAP</div>
              <div className="text-phi-xs font-bold text-[#ededea] font-mono">
                {Number.isFinite(token.marketCap) ? `$${Math.round(token.marketCap).toLocaleString()}` : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-[#1f1f1f] bg-[#121212] p-2.5">
              <div className="text-phi-2xs text-[#666]">CREATOR / PAD</div>
              <div className="text-phi-xs font-bold text-[#ededea] truncate">
                {token.launchpadName || "Standard Curve"}
              </div>
            </div>
            <div className="rounded-lg border border-[#1f1f1f] bg-[#121212] p-2.5">
              <div className="text-phi-2xs text-[#666]">STATUS</div>
              <div className="text-phi-xs font-bold text-[#ffaa22]">
                Pre-Graduation
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Explorer link */}
        <div className="flex items-center justify-between border-t border-[#1c1c1c] pt-4 text-phi-xs text-[#666]">
          <span className="font-mono">Address: {token.address.slice(0, 10)}…{token.address.slice(-8)}</span>
          <a
            href={`${explorerWebUrl}/token/${token.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8a8a8a] hover:text-[#ccff00] transition-colors inline-flex items-center gap-1"
          >
            <span>Explorer</span>
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    );
  }

  // GeckoTerminal (operator, L213 #14). `token_address` states our subject: a bare pool id lets the
  // embed pick a side by its own rule, which charted a quote asset once (§8 #21).
  // Plain value, not useMemo: this runs after an early return, and a hook there breaks hook order.
  const iframeSrc = (() => {
    const params = new URLSearchParams({
      embed: "1",
      info: "0",
      swaps: "0",
      grayscale: "0",
      light_chart: "0",
      resolution: interval === "1D" ? "1d" : interval === "60" ? "1h" : interval === "240" ? "4h" : "15m",
      token_address: token.address.toLowerCase(),
    });
    return `https://www.geckoterminal.com/robinhood/pools/${pairAddress}?${params.toString()}`;
  })();

  return (
    <div className={`relative w-full rounded-xl overflow-hidden border border-[#222222] bg-[#080808] shadow-lg lg:flex lg:flex-1 lg:min-h-0 lg:flex-col ${className}`}>
      {/* Top Header */}
      <div className="flex items-center justify-between border-b border-[#1c1c1c] bg-[#0c0c0c] px-4 py-2.5 text-phi-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-[#ccff00]" />
          <span className="text-[#ededea] font-bold text-phi-xs tracking-wider uppercase">
            {token.symbol} · DEX CHART
          </span>
        </div>

        <div className="flex items-center gap-2">
          {token.launchpadUrl && (
            <a
              href={token.launchpadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1 rounded border border-[#2a2a2a] bg-[#141414] px-2 py-0.5 text-phi-2xs text-[#ffaa22] hover:border-[#ffaa22]/50 transition-colors"
            >
              <span>{token.launchpadName || "Launchpad"}</span>
              <ExternalLink className="size-2.5" />
            </a>
          )}
          <a
            href={`${explorerWebUrl}/token/${token.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-phi-xs text-[#8a8a8a] hover:text-[#ccff00] transition-colors"
          >
            <span>Explorer</span>
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      {/* Chart Canvas Area */}
      {chartFailed ? (
        <NoChartAvailable
          token={token}
          pairAddress={pairAddress}
          onRetry={() => {
            setChartFailed(false);
            setIsIframeLoading(true);
            setReloadKey((k) => k + 1);
          }}
        />
      ) : (
        <div className="flex w-full h-[440px] sm:h-[470px] lg:h-auto lg:flex-1 lg:min-h-0 flex-col bg-[#080808] shrink-0">
        <div className="relative min-h-0 flex-1">
          {/* Active Loading Skeleton so it never sits as a dead black box */}
          {isIframeLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#080808] gap-3 font-mono text-phi-xs text-[#8a8a8a] p-6 text-center">
              <div className="relative flex items-center justify-center">
                <div className="size-8 rounded-full border-2 border-[#ccff00]/20 border-t-[#ccff00] animate-spin" />
              </div>
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[#ccff00] animate-ping" />
                <span className="text-[#ededea] font-medium">{chartSlow ? "Chart is taking longer to load. Try Reload Chart below." : "Loading GeckoTerminal chart…"}</span>
              </div>
              <span className="text-phi-xs text-[#666666]">
                Pair: {pairAddress.slice(0, 10)}...{pairAddress.slice(-8)}
              </span>
            </div>
          )}

          <iframe
            key={`${pairAddress}-${reloadKey}`}
            src={iframeSrc}
            title={`${token.name} Price Chart`}
            className="absolute inset-0 size-full border-0"
            loading="eager"
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            onLoad={() => { setIsIframeLoading(false); setChartSlow(false); }}
            onError={() => { setChartFailed(true); setIsIframeLoading(false); }}
          />

        </div>
          {/* Its own strip, never over the iframe: GeckoTerminal draws its attribution along the bottom edge. */}
          <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-[#1c1c1c] bg-[#0c0c0c] px-2 py-1.5">
            <button
              type="button"
              onClick={() => {
                setIsIframeLoading(true);
                setReloadKey((k) => k + 1);
              }}
              className="rounded bg-[#121212]/90 backdrop-blur border border-[#333333] px-2 py-1 text-phi-2xs font-mono text-[#8a8a8a] hover:text-[#ccff00] hover:border-[#ccff00]/40 transition-colors"
              title="Refresh Chart Embed"
            >
              ↻ Reload Chart
            </button>
            <a
              href={`https://www.geckoterminal.com/robinhood/pools/${pairAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-[#121212]/90 backdrop-blur border border-[#333333] p-1 text-[#8a8a8a] hover:text-[#ccff00] hover:border-[#ccff00]/40 transition-colors"
              title="Open directly on GeckoTerminal"
            >
              <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/** A failed embed is unavailable; it does not prove the pool is unindexed. */
function NoChartAvailable({
  token,
  pairAddress,
  onRetry,
}: {
  token: TokenMarketData;
  pairAddress: string;
  onRetry: () => void;
}) {
  return (
    <div className="relative w-full h-[440px] sm:h-[470px] lg:h-auto lg:flex-1 lg:min-h-0 bg-[#080808] flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="size-12 rounded-full border border-[#2a2a2a] bg-[#121212] flex items-center justify-center mb-3 text-[#777]">
        <BarChart2 className="size-6 text-[#555]" />
      </div>
      <h3 className="font-bold text-phi-sm text-[#ededea] tracking-wide">NO CHART AVAILABLE</h3>
      <p className="text-phi-xs text-[#777777] max-w-sm mt-1.5 leading-relaxed">
        The GeckoTerminal chart could not load. Retry or open it directly.
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 mt-5">
        <a
          href={`https://www.geckoterminal.com/robinhood/pools/${pairAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3.5 py-1.5 text-phi-xs text-[#8a8a8a] hover:text-[#ededea] hover:border-[#444] transition-colors"
        >
          <span>Open GeckoTerminal</span>
          <ExternalLink className="size-3" />
        </a>
        <a
          href={`${explorerWebUrl}/token/${token.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3.5 py-1.5 text-phi-xs text-[#8a8a8a] hover:text-[#ededea] hover:border-[#444] transition-colors"
        >
          <span>View on Explorer</span>
          <ExternalLink className="size-3" />
        </a>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#141414] px-3.5 py-1.5 text-phi-xs text-[#8a8a8a] hover:text-[#ccff00] hover:border-[#ccff00]/40 transition-colors"
        >
          <RefreshCw className="size-3" />
          <span>Retry</span>
        </button>
      </div>

      <div className="mt-6 pt-3 border-t border-[#1c1c1c] text-phi-2xs text-[#555] flex items-center gap-1.5">
        <span>Pair:</span>
        <code className="text-[#666]">{pairAddress}</code>
      </div>
    </div>
  );
}
