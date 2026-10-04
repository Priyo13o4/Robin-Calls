"use client";

import { useEffect, useRef, useState } from "react";
import { cidOf, iconCandidates, imageFromJsonPointer } from "@/lib/data/curve-icon";
import { fetchTokenImage } from "@/lib/data/token-art";
import { SmartImage } from "./SmartImage";
import { useNearViewport } from "./useNearViewport";

/**
 * A launch token's artwork, resolved in three tiers: the pad's own metadata
 * pointer, then the explorer, then DexScreener. Each tier degrades to null, so
 * a fault anywhere falls through to the monogram like any other empty answer.
 *
 * Shared by /night-market and the landing band. It used to live inside
 * NightMarketTabs, and the landing band drew a monogram instead, so the same
 * token had art on one surface and initials on the other.
 */
export function TokenIcon({
  address,
  symbol,
  explorerUrl,
  metadataUri,
  className = "h-10 w-10",
  fallbackClassName,
}: {
  address: string;
  symbol: string | null;
  explorerUrl: string;
  metadataUri: string | null;
  /** Box size and shape. The launch card is 40px square, the landing row 32px round. */
  className?: string;
  /** Extra classes for the monogram only, e.g. a launchpad tint. */
  fallbackClassName?: string;
}) {
  const [icon, setIcon] = useState<string | null>(null);
  // Up to three requests PER ROW, so they wait until the row is worth loading.
  // /night-market renders these by the dozen and the landing band renders them
  // three sections below the fold.
  const { ref, near } = useNearViewport<HTMLImageElement & HTMLSpanElement>();
  const advanceRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!near) return;
    let active = true;
    const ctrl = new AbortController();
    const triedUrls = new Set<string>();

    const queue: string[] = metadataUri ? iconCandidates(metadataUri) : [];
    let triedJson = false;
    let tier: "pointer" | "explorer" | "dexscreener" | "done" = "pointer";
    let inFlight = false;

    const fromExplorer = async (): Promise<string | null> => {
      try {
        const r = await fetch(`${explorerUrl}/api/v2/tokens/${address}`, { signal: ctrl.signal });
        if (!r.ok) return null;
        const data = await r.json();
        const url = data?.icon_url;
        return typeof url === "string" && url.startsWith("https://") ? url : null;
      } catch {
        return null;
      }
    };

    // token-art is the one DexScreener fetcher; never a second implementation
    // of the endpoint here. It swallows its own errors to null, so a fault in
    // this tier degrades to the monogram like every other empty answer.
    const fromDexscreener = (): Promise<string | null> => fetchTokenImage(address, ctrl.signal);

    const advance = async () => {
      if (!active || inFlight) return;
      inFlight = true;

      try {
        // Drain any pending direct candidate URLs.
        while (queue.length > 0) {
          const next = queue.shift()!;
          if (triedUrls.has(next)) continue;
          triedUrls.add(next);
          setIcon(next);
          return;
        }

        // When direct candidates error, try JSON pointer once for CID or http URLs.
        if (!triedJson) {
          triedJson = true;
          const isCidOrHttp = metadataUri
            ? cidOf(metadataUri) !== null || /^https?:\/\//i.test(metadataUri)
            : false;
          if (isCidOrHttp && metadataUri) {
            const jsonCandidates = await imageFromJsonPointer(metadataUri, ctrl.signal);
            if (!active) return;
            for (const c of jsonCandidates) {
              if (!triedUrls.has(c)) queue.push(c);
            }
            if (queue.length > 0) {
              const next = queue.shift()!;
              triedUrls.add(next);
              setIcon(next);
              return;
            }
          }
        }

        // Advance to explorer tier.
        if (tier === "pointer") {
          tier = "explorer";
          const explorerIcon = await fromExplorer();
          if (!active) return;
          if (explorerIcon && !triedUrls.has(explorerIcon)) {
            triedUrls.add(explorerIcon);
            setIcon(explorerIcon);
            return;
          }
        }

        // Advance to DexScreener tier.
        if (tier === "explorer") {
          tier = "dexscreener";
          const dsIcon = await fromDexscreener();
          if (!active) return;
          if (dsIcon && !triedUrls.has(dsIcon)) {
            triedUrls.add(dsIcon);
            setIcon(dsIcon);
            return;
          }
        }

        tier = "done";
        setIcon(null);
      } finally {
        inFlight = false;
      }
    };

    advanceRef.current = advance;
    void advance();

    return () => {
      active = false;
      ctrl.abort();
      advanceRef.current = () => {};
    };
  }, [address, explorerUrl, metadataUri, near]);

  if (icon) {
    return (
      <SmartImage
        ref={ref}
        src={icon}
        alt=""
        className={`shrink-0 border border-[#2a2a2a] bg-[#1c1c1c] object-cover ${className}`}
        onError={() => advanceRef.current()}
      />
    );
  }
  return (
    <span
      ref={ref}
      className={`flex shrink-0 items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] font-cinzel text-[#8a8a8a] ${className} ${
        fallbackClassName ?? "text-sm"
      }`}
    >
      {(symbol ?? "?").slice(0, 2).toUpperCase()}
    </span>
  );
}
