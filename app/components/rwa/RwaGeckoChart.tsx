"use client";

import { useCallback, useRef, useState } from "react";

const SLOW_AFTER_MS = 12_000;

export function isUsableRwaPoolAddress(poolAddress: string | null | undefined, tokenAddress: string): poolAddress is string {
  return typeof poolAddress === "string"
    && /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(poolAddress)
    && poolAddress.toLowerCase() !== tokenAddress.toLowerCase();
}

export function rwaGeckoChartUrl(poolAddress: string, tokenAddress: string): string {
  return `https://www.geckoterminal.com/robinhood/pools/${encodeURIComponent(poolAddress)}?embed=1&info=0&swaps=0&grayscale=0&light_chart=0&display_currency=usd&resolution=1h&token_address=${encodeURIComponent(tokenAddress)}`;
}

export function rwaGeckoPoolPageUrl(poolAddress: string, tokenAddress: string): string {
  return `https://www.geckoterminal.com/robinhood/pools/${encodeURIComponent(poolAddress)}?token_address=${encodeURIComponent(tokenAddress)}`;
}

type ChartState = "loading" | "loaded" | "slow" | "error";

export function RwaGeckoChart({
  tokenAddress,
  symbol,
  poolAddress,
}: {
  tokenAddress: string;
  symbol: string;
  poolAddress: string | null;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ChartState>("loading");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pool = isUsableRwaPoolAddress(poolAddress, tokenAddress) ? poolAddress : null;

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const attachFrame = useCallback((node: HTMLIFrameElement | null) => {
    clearTimer();
    if (!node) return;
    setState("loading");
    timer.current = setTimeout(() => setState((current) => current === "loading" ? "slow" : current), SLOW_AFTER_MS);
  }, [attempt, pool, clearTimer]);

  if (!pool) {
    return (
      <div className="flex h-[400px] w-full flex-col items-center justify-center border border-[#222] bg-[#111] text-center text-sm text-[#aaa] sm:h-[420px]">
        <p className="font-medium text-white">Pool unavailable</p>
        <p className="mt-1">Waiting for pool data.</p>
      </div>
    );
  }

  const chartUrl = rwaGeckoChartUrl(pool, tokenAddress);
  const poolPageUrl = rwaGeckoPoolPageUrl(pool, tokenAddress);

  return (
    <div className="flex h-[400px] w-full flex-col overflow-hidden border border-[#222] bg-[#111] sm:h-[420px]">
      <iframe
        key={`${pool}:${attempt}`}
        ref={attachFrame}
        src={chartUrl}
        title={`${symbol} price chart`}
        className="min-h-0 w-full flex-1 border-0"
        allow="clipboard-write"
        onLoad={() => { clearTimer(); setState("loaded"); }}
        onError={() => { clearTimer(); setState("error"); }}
      />
      {/* Below the iframe, not over it: GeckoTerminal's attribution sits on its bottom edge. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#222] bg-[#111] px-3 py-2 text-xs text-[#bbb]" aria-live="polite">
        {state !== "loaded" && (
          <span className="min-w-0 flex-1 basis-full sm:basis-auto">{state === "error" ? "Chart failed to load." : state === "slow" ? "Chart is taking longer than expected." : "Loading chart…"}</span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <button type="button" onClick={() => { clearTimer(); setState("loading"); setAttempt((n) => n + 1); }} className="text-white underline underline-offset-2">
            Reload chart
          </button>
          <a href={poolPageUrl} target="_blank" rel="noreferrer" className="text-white underline underline-offset-2">Open chart</a>
        </div>
      </div>
    </div>
  );
}
