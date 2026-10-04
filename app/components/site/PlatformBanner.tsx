"use client";

import { useEffect, useState } from "react";
import { SmartImage } from "./SmartImage";
import { useNearViewport } from "./useNearViewport";

/**
 * Curated verified fallback banners for platforms where direct live scraping
 * can be blocked by bot-protection (Cloudflare 403) or client-side SPAs.
 */
const KNOWN_PLATFORM_BANNERS: Record<string, string> = {
  "gmgn.ai": "https://gmgn.ai/static/GMGN.png",
  "uniswap.org": "https://app.uniswap.org/images/1200x630_Rich_Link_Preview_Image.png",
  "app.uniswap.org": "https://app.uniswap.org/images/1200x630_Rich_Link_Preview_Image.png",
  "trykarma.app": "https://trykarma.app/twitter-image",
  "karmapay.xyz": "https://coin-images.coingecko.com/coins/images/55919/large/karma_icon_rain.png",
  "kibi.bot": "https://kibi.bot/assets/logo-nav.svg",
  "launchhood.com": "https://launchhood.com/icon.png",
  "stoxes.fun": "https://stoxes.io/opengraph.jpg",
  "letscash.fun": "https://letscash.fun/preview.jpg",
  "ponsfamily.com": "https://www.ponsfamily.com/opengraph-image?32c6808267be9a74",
  "flap.sh": "https://flap.sh/cover-programmable-token-launchpad.png",
  "robinfun.live": "https://robinfun.up.railway.app/hero.png",
  "goldsky.com": "https://goldsky.com/images/chains_opengraph.png",
};

function getKnownBanner(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return KNOWN_PLATFORM_BANNERS[host] ?? null;
  } catch {
    return null;
  }
}

/**
 * Directory listing banner — discovered client-side on load via /api/og-proxy,
 * checking curated fallback maps, declared banner_url, and live scraping.
 */
export function PlatformBanner({
  url,
  className = "h-32",
}: {
  url: string;
  className?: string;
}) {
  const [imgUrl, setImgUrl] = useState<string | null>(() => getKnownBanner(url));
  const [hasError, setHasError] = useState(false);
  /**
   * `/ecosystem` mounts ~180 of these at once. Without this gate every one of
   * them called /api/og-proxy on mount, and og-proxy makes a LIVE fetch to the
   * listed site — so opening the page was 180 requests to our own box fanning
   * out to 180 third parties, for ~170 cards nobody had scrolled to.
   */
  const { ref, near } = useNearViewport<HTMLDivElement>();

  useEffect(() => {
    if (!near) return;
    let active = true;
    const known = getKnownBanner(url);
    if (known) {
      setImgUrl(known);
    }

    fetch(`/api/og-proxy?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data) => {
        if (active && data.image) {
          if (data.image.startsWith("/")) {
            try {
              const base = new URL(url);
              setImgUrl(`${base.origin}${data.image}`);
              setHasError(false);
            } catch {
              setImgUrl(data.image);
              setHasError(false);
            }
          } else {
            setImgUrl(data.image);
            setHasError(false);
          }
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [url, near]);

  let hostDomain = "";
  try {
    hostDomain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    hostDomain = url;
  }

  if (!imgUrl || hasError) {
    return (
      <div
        ref={ref}
        className={`${className} relative w-full overflow-hidden bg-[#141414] border-b border-[#2a2a2a] flex items-center justify-center p-4`}
      >
        {/* Subtle geometric pattern */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #ededea 1px, transparent 1px), linear-gradient(to bottom, #ededea 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0a0a0a] via-[#1c1c1c]/70 to-[#141414]" />
        {/* Styled Monogram Brand Block */}
        <div className="relative z-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center border border-[#ccff00]/40 bg-[#ccff00]/10 font-cinzel text-lg font-black text-[#ccff00] shadow-[0_0_15px_rgba(204,255,0,0.15)]">
            {hostDomain.slice(0, 2).toUpperCase()}
          </div>
          <span className="mt-2 block font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a] uppercase truncate max-w-[200px]">
            {hostDomain}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`${className} relative w-full overflow-hidden bg-[#141414] border-b border-[#2a2a2a]`}>
      <SmartImage
        src={imgUrl}
        alt="Banner"
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className="h-full w-full object-cover object-center transition-transform duration-500 hover:scale-105"
      />
    </div>
  );
}
