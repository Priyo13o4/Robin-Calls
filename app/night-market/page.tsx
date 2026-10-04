import type { Metadata } from "next";
import { NoirShell } from "../components/site/NoirShell";
import type { LaunchpadLink } from "../components/site/NightMarketTabs";
import { NightMarketClient } from "./NightMarketClient";
import { TrendingPairsRail } from "../components/site/TrendingPairsRail";
import { getDexScreenerRobinhoodFeed } from "@/lib/trade/dexscreener-feed";
import { pickTrendingPairs } from "@/lib/trade/trending-rail";
import { cdnUrl } from "@/lib/config/cdn";
import { readEnabledLaunchpads } from "@/lib/data/launchpads";
import { readLaunchFeedCached } from "@/lib/data/launches";
import { launchFeedRowToTokenMarketData, type TokenMarketData } from "@/lib/trade/types";
import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES, nightMarketFaqItems } from "@/lib/config/seo";
import { SeoFaq } from "../components/site/SeoFaq";
import { isTradingOpen, readSwapConfig } from "@/lib/swap/config";
import { resolveLaunchQuotePrices } from "@/lib/launches/quote-prices";

export const metadata: Metadata = {
  title: SEO_ROUTES.nightMarket.title,
  description: SEO_ROUTES.nightMarket.description,
  keywords: [...SEO_ROUTES.nightMarket.keywords],
  alternates: { canonical: "/night-market" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/night-market`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.nightMarket.title,
    description: SEO_ROUTES.nightMarket.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.nightMarket.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.nightMarket.title,
    description: SEO_ROUTES.nightMarket.description,
    images: ["/brand/og-default.jpg"],
  },
};

export const revalidate = 120;

export default async function NightMarketPage() {
  let launchpads: LaunchpadLink[] = [];
  let initialTokens: TokenMarketData[] = [];
  let initialCursor: string | null = null;
  let initialQuotePrices: Record<string, number> = {};
  let trending: TokenMarketData[] = [];

  // At build time the database is absent, the read resolves closed, so no
  // Trade button is baked in until revalidation. That is the intended failure direction.
  const tradeEnabled = isTradingOpen(await readSwapConfig());

  try {
    const padRows = await readEnabledLaunchpads();
    launchpads = padRows.map((p) => ({ name: p.name, slug: p.slug, config: p.config }));
  } catch {
    /* launchpads read degrades to empty list if DB is unreachable */
  }

  try {
    const feed = await readLaunchFeedCached("all", 100);
    if (feed && feed.rows) {
      initialQuotePrices = await resolveLaunchQuotePrices(feed.rows);
      initialTokens = feed.rows.map((row, idx) =>
        launchFeedRowToTokenMarketData(row, idx + 1, launchpads, initialQuotePrices),
      );
      initialCursor = feed.nextCursor;
    }
  } catch {
    /* degrades to client-side DexScreener fetch if DB is offline */
  }

  try {
    trending = pickTrendingPairs((await getDexScreenerRobinhoodFeed()).pairs);
  } catch {
    /* no rail rather than a stale or invented one */
  }

  return (
    <NoirShell>
      <header className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/robin-knight-archway.webp")}
            alt=""
            aria-hidden
            fetchPriority="high"
            className="h-full w-full object-cover object-[70%_30%] opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a]/90 via-[#0a0a0a]/35 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-[#0a0a0a]/40" />
        </div>
        <div className="relative z-10 mx-auto max-w-5xl px-4 pb-16 pt-20 sm:px-6 sm:pb-24 sm:pt-32">
          <h1 className="font-cinzel text-4xl font-black leading-tight tracking-wide text-white sm:text-6xl">
            THE NIGHT MARKET
          </h1>
        </div>
      </header>

      <TrendingPairsRail pairs={trending} className="mb-6" />

      {/* ── DEXSCREENER-STYLE UNIFIED TERMINAL TABLE ── */}
      <div className="mb-12">
        <NightMarketClient
          initialTokens={initialTokens}
          initialCursor={initialCursor}
          tradeEnabled={tradeEnabled}
          launchpads={launchpads}
        />
      </div>

      <SeoFaq items={nightMarketFaqItems(launchpads.map((p) => p.name))} className="pt-16" />
    </NoirShell>
  );
}
