"use client";

import { useEffect, useState } from "react";
import { SmartImage } from "./SmartImage";
import { useNearViewport } from "./useNearViewport";

/**
 * Official stock/ETF logo, resolved client-side on mount via /api/rwa/icon
 * (a server-side proxy — TradingView's own resolver blocks cross-origin
 * browser requests). Best-effort: any miss or fetch failure just falls back
 * to the noir monogram, same pattern as the launch-tracker TokenIcon.
 */
export function RwaIcon({ symbol, className }: { symbol: string; className?: string }) {
  const [icon, setIcon] = useState<string | null>(null);
  // Near-viewport check prevents bursting 200 icon requests on initial mount
  const { ref, near } = useNearViewport<HTMLDivElement>();

  useEffect(() => {
    if (!near) return;
    let active = true;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/rwa/icon?symbol=${encodeURIComponent(symbol)}`, {
          signal: ctrl.signal,
        });
        if (!r.ok) return;
        const data = await r.json();
        if (active && typeof data?.url === "string") setIcon(data.url);
      } catch {
        /* best-effort — falls back to the monogram below */
      }
    })();
    return () => {
      active = false;
      ctrl.abort();
    };
  }, [symbol, near]);

  const box = className ?? "h-8 w-8";

  if (icon) {
    return (
      <SmartImage
        src={icon}
        alt=""
        className={`${box} shrink-0 rounded-full border border-[#2a2a2a] bg-[#1c1c1c] object-contain p-1`}
        onError={() => setIcon(null)}
      />
    );
  }
  return (
    <div
      ref={ref}
      className={`${box} flex shrink-0 items-center justify-center rounded-full border border-[#2a2a2a] bg-[#1c1c1c] font-cinzel text-[10px] text-[#8a8a8a]`}
    >
      {symbol.slice(0, 3).toUpperCase()}
    </div>
  );
}
