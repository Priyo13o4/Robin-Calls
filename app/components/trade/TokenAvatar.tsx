"use client";

import { useEffect, useMemo, useState } from "react";
import type { SelectableToken } from "@/lib/trade/types";
import { CANONICAL_STOCK_TOKENS } from "@/lib/trade/canonical-stocks";

/**
 * Uniswap-fidelity Token Avatar.
 * - Inner circular avatar has overflow-hidden with crisp borders.
 * - Supports official ETH (blue circle + white Ethereum diamond).
 * - High-res vector logos for TradingView RWAs & Crypto tokens.
 * - Auto-resolves official stock logo from canonical definitions if missing.
 * - Resets image error state automatically whenever selected token changes.
 * - Fallback: Official Robinhood feather logo in dark circle.
 * - Robinhood Chain badge overlay: Black feather inside lime rounded-square at bottom-right.
 */
export function TokenAvatar({
  token,
  className = "size-7",
  showBadges = true,
  showBadge,
}: {
  token: SelectableToken;
  className?: string;
  showBadges?: boolean;
  showBadge?: boolean;
}) {
  const [imgErr, setImgErr] = useState(false);

  // Automatically reset image error state whenever selected token changes
  useEffect(() => {
    setImgErr(false);
  }, [token.address, token.symbol, token.imageUrl]);

  // Resolve logo image:
  // 1. Direct token.imageUrl if present
  // 2. Lookup in CANONICAL_STOCK_TOKENS if stock or symbol match
  const resolvedUrl = useMemo(() => {
    if (token.imageUrl) return token.imageUrl;
    const match = CANONICAL_STOCK_TOKENS.find(
      (s) =>
        s.symbol.toUpperCase() === token.symbol.toUpperCase() ||
        (token.address && s.address.toLowerCase() === token.address.toLowerCase())
    );
    return match?.imageUrl || null;
  }, [token.imageUrl, token.symbol, token.address]);

  const renderInner = () => {
    // 1. Official ETH: Blue circle + Ethereum diamond SVG
    if (token.symbol === "ETH") {
      return (
        <div className="size-full rounded-full bg-[#5980e8] flex items-center justify-center border border-[#436fe2] shadow-sm">
          <svg viewBox="0 0 784.37 1277.39" className="w-3/5 h-3/5 fill-white">
            <polygon points="392.07,0 383.5,29.11 383.5,873.74 392.07,882.29 784.13,650.54" />
            <polygon points="392.07,0 0,650.54 392.07,882.29 392.07,472.33" fillOpacity="0.8" />
            <polygon points="392.07,956.52 387.24,962.41 387.24,1263.28 392.07,1277.38 784.37,724.89" />
            <polygon points="392.07,1277.38 392.07,956.52 0,724.89" fillOpacity="0.8" />
          </svg>
        </div>
      );
    }

    // 2. Real Token Image (TradingView SVG for stocks, TrustWallet/DexScreener for crypto)
    if (resolvedUrl && !imgErr) {
      return (
        <div className="size-full rounded-full overflow-hidden flex items-center justify-center bg-[#141414] border border-white/10 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={resolvedUrl}
            src={resolvedUrl}
            alt={token.symbol}
            onError={() => setImgErr(true)}
            className={`size-full ${
              token.category === "stocks"
                ? "object-contain p-1 bg-[#101010]"
                : "object-cover bg-[#161616]"
            }`}
          />
        </div>
      );
    }

    // 3. Fallback: Official Robinhood Feather Logo on dark circle (per directive)
    return (
      <div className="size-full rounded-full overflow-hidden flex items-center justify-center bg-[#141414] border border-[#262626] p-1.5 shadow-sm">
        <svg viewBox="0 0 500 500" className="size-full fill-[#00c805]">
          <path d="M151.41,379.15h5.7c1.04,0,2.07-.52,2.42-1.38,43.01-109.52,89.83-163.77,119.2-196.24,1.21-1.38.69-2.42-1.04-2.42h-52.52c-1.9,0-3.51.76-4.84,2.42l-37.66,46.64c-5.53,6.91-6.91,13.3-6.91,22.46v47.68c-12.27,34.38-20.04,57.7-25.74,78.77-.35,1.35.17,2.07,1.38,2.07ZM340.91,127.81c-8.12-8.64-44.74-8.98-61.67-2.42-3.52,1.36-6.91,3.68-8.46,5.01-15.55,13.3-25.91,23.84-35.76,34.2-1.21,1.21-.69,2.42,1.04,2.42h58.22c5.36,0,8.46,3.11,8.46,8.46v65.64c0,1.73,1.38,2.25,2.42.69l35.07-45.78c5.7-7.43,7.43-9.67,8.98-20.04,2.07-15.2.86-38.52-8.29-48.2ZM265.77,301.94l24.01-39.56c.52-1.04.69-2.25.69-3.11v-65.99c0-1.73-1.21-2.42-2.42-1.04-36.1,40.25-64.26,82.57-90.35,133.53-.66,1.28.17,2.42,1.73,1.9l53.9-16.58c6.08-1.87,9.5-4.32,12.44-9.16Z" />
        </svg>
      </div>
    );
  };

  const shouldShowBadge = showBadge ?? showBadges ?? true;

  const badgeSizeClass = useMemo(() => {
    if (className.includes("size-10") || className.includes("w-10") || className.includes("h-10")) {
      return "size-4 rounded-[4px] -bottom-0.5 -right-0.5 border-[1.5px]";
    }
    if (className.includes("size-6") || className.includes("w-6") || className.includes("h-6")) {
      return "size-2.5 rounded-[2.5px] -bottom-0.5 -right-0.5 border";
    }
    if (className.includes("size-5") || className.includes("w-5") || className.includes("h-5")) {
      return "size-2 rounded-[2px] -bottom-0.5 -right-0.5 border";
    }
    if (className.includes("size-7") || className.includes("w-7") || className.includes("h-7")) {
      return "size-3 rounded-[3px] -bottom-0.5 -right-0.5 border";
    }
    return "size-3 rounded-[3px] -bottom-0.5 -right-0.5 border";
  }, [className]);

  return (
    <span className={`relative inline-flex items-center justify-center shrink-0 ${className}`}>
      {renderInner()}
      {shouldShowBadge && (
        <span
          className={`absolute ${badgeSizeClass} overflow-hidden bg-[#ccff00] border-[#0c0c0c] flex items-center justify-center shadow-sm z-10 pointer-events-none`}
          title="Robinhood Chain"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/robinhood-chain-badge.webp"
            alt="Robinhood Chain"
            className="size-full object-contain"
          />
        </span>
      )}
    </span>
  );
}
