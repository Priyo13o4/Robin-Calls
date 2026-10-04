import { SiteNav } from "./components/site/SiteNav";
import { SiteFooter } from "./components/site/SiteFooter";
import { SmoothScroll } from "./components/site/SmoothScroll";
import { Hero } from "./components/site/landing/Hero";
import { ProductGrid } from "./components/site/landing/ProductGrid";
import { SectionBand } from "./components/site/landing/Section";
import { ProductsRevealProvider } from "./components/site/landing/ProductsReveal";
import { RwaShowcase, type RwaPreviewItem } from "./components/site/landing/RwaShowcase";
import { RobinKnightSection } from "./components/site/landing/RobinKnightSection";
import { NightMarketSection } from "./components/site/landing/NightMarketSection";
import { RecordSection } from "./components/site/landing/RecordSection";
import { HowItWorks } from "./components/site/landing/HowItWorks";
import { TokenSection } from "./components/site/landing/TokenSection";
import { WhyRobinCalls } from "./components/site/landing/WhyRobinCalls";
import { ClosingCta } from "./components/site/landing/ClosingCta";
import {
  EcosystemSection,
  type EcosystemCategoryCount,
  type EcosystemPreviewItem,
} from "./components/site/landing/EcosystemSection";

import {
  countCurveGraduations24h,
  countCurveTrades24h,
  countLaunchFeedRows,
  readLaunchFeed,
  readVisibleLaunchesByHour,
} from "@/lib/data/launches";
import { readIndictedDeployers } from "@/lib/data/wanted";
import { queryLedgerFeed } from "@/lib/data/ledger";
import { readRwaRegistryTokens, queryPublishedPlatforms } from "@/lib/data/registry";
import { readRwaQuotes } from "@/lib/market/rwa-quotes";
import { readLandingStats } from "@/lib/data/observability";
import { isTrustedRwaToken, primeTrustedAddresses } from "@/lib/config/trusted-addresses";
import { isDatabaseConfigured } from "@/lib/db/client";
import { flags } from "@/lib/config/flags";
import { readSaleClock } from "@/lib/sale/schedule";

import type { Metadata } from "next";
import { SEO_ROUTES, SCANNER_WEB_APP_JSON_LD } from "@/lib/config/seo";
import { SITE_URL } from "@/lib/config/site";

export const metadata: Metadata = {
  title: SEO_ROUTES.home.title,
  description: SEO_ROUTES.home.description,
  keywords: [...SEO_ROUTES.home.keywords],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "RobinCalls",
    title: SEO_ROUTES.home.title,
    description: SEO_ROUTES.home.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.home.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.home.title,
    description: SEO_ROUTES.home.description,
    images: ["/brand/og-default.jpg"],
  },
};

// Every section below reads from the database directly (no client round trip
// through /api/*), so the page's own freshness is one revalidate window —
// matching /api/stats's, since RecordSection's counters are the most
// cache-sensitive tenant.
export const revalidate = 60;

const NIGHT_MARKET_PREVIEW_SIZE = 5;
const WANTED_PREVIEW_SIZE = 5;
const LEDGER_PREVIEW_SIZE = 3;
const RWA_PREVIEW_SIZE = 4;
const ECOSYSTEM_PREVIEW_SIZE = 4;

/**
 * Night Market's own page paginates by recency (`readLaunchFeed` has no
 * "top by score" query shape). A preview showing the newest five would mostly
 * show unscanned rows, so a wider recent page is re-ranked by score here
 * instead of adding a second query shape to lib/data for one card.
 */
async function readNightMarketPreview() {
  const { rows } = await readLaunchFeed("bonding", 30, null);
  return [...rows]
    .sort((a, b) => (b.verdict?.score ?? -1) - (a.verdict?.score ?? -1))
    .slice(0, NIGHT_MARKET_PREVIEW_SIZE);
}

async function readRwaPreview(): Promise<{
  items: RwaPreviewItem[];
  totalCount: number;
  categoryCount: number;
  categories: string[];
  marketComplete: boolean;
}> {
  await primeTrustedAddresses();
  const rows = await readRwaRegistryTokens();
  const picked = rows.slice(0, RWA_PREVIEW_SIZE);
  // Live provider, not `market_snapshots`: nothing fills that table for the RWA
  // registry, so every card read a dash. See lib/market/rwa-quotes.ts.
  const { quotes, complete } = await readRwaQuotes(picked.map((r) => r.address));
  const items = picked.map((r) => {
    const q = quotes.get(r.address) ?? null;
    return {
      address: r.address,
      asset_name: r.asset_name,
      asset_symbol: r.asset_symbol,
      category: r.category,
      trusted: r.verify_status === "ok" && isTrustedRwaToken(r.address),
      price_usd: q?.priceUsd ?? null,
      market_cap_usd: q?.marketCapUsd ?? null,
      volume_24h_usd: q?.volume24hUsd ?? null,
      trades_24h: q?.trades24h ?? null,
    };
  });
  // The filter row renders these, so it names categories we hold rows for and
  // nothing else — see RwaShowcase.
  const categories = [...new Set(rows.map((r) => r.category))].filter(Boolean).sort();
  return {
    items,
    totalCount: rows.length,
    categoryCount: categories.length,
    categories,
    marketComplete: complete,
  };
}

/**
 * The directory, split into the two things the landing band shows: a count per
 * category over EVERY published row, and the cards.
 *
 * The counts run over the full set, never over the four cards — a "12
 * launchpads" derived from a four-card sample would be a number about our
 * slice presented as a number about the chain.
 */
async function readEcosystemPreview(): Promise<{
  items: EcosystemPreviewItem[];
  categories: EcosystemCategoryCount[];
  totalCount: number;
}> {
  const platforms = await queryPublishedPlatforms();

  const counts = new Map<string, number>();
  for (const p of platforms) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const items = platforms
    .filter((p): p is typeof p & { banner_url: string } => !!p.banner_url)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
    .slice(0, ECOSYSTEM_PREVIEW_SIZE)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      description: p.description,
      banner_url: p.banner_url,
      has_agent: p.has_agent,
    }));

  return { items, categories, totalCount: platforms.length };
}

export default async function Home() {
  const [
    nightMarketRows,
    wantedRows,
    ledgerFeed,
    rwa,
    stats,
    ecosystem,
    onCurveCount,
    onDexCount,
    visibleLaunchesByHour,
    graduated24hCount,
    trades24hCount,
    saleClock,
  ] = await Promise.all([
    readNightMarketPreview(),
    readIndictedDeployers(WANTED_PREVIEW_SIZE),
    queryLedgerFeed({ limit: LEDGER_PREVIEW_SIZE }),
    readRwaPreview(),
    readLandingStats(),
    readEcosystemPreview(),
    // Counted over the tab's own predicate, not over the five rows shown:
    // a headline derived from the preview slice would be a number about our
    // sample dressed as a number about the chain.
    countLaunchFeedRows("bonding"),
    countLaunchFeedRows("dex"),
    readVisibleLaunchesByHour(),
    countCurveGraduations24h(),
    flags.launchIngest ? countCurveTrades24h() : Promise.resolve(null),
    readSaleClock(),
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SCANNER_WEB_APP_JSON_LD) }}
      />
      <SmoothScroll />
      <SiteNav isFixed />
      {/* The hero holds the trigger, the band holds the cards it reveals. */}
      <ProductsRevealProvider>
        <Hero schedule={saleClock.schedule} renderedAt={saleClock.renderedAt} />
        {/* One field of /rwa's art behind both bands, not two restarts of it. */}
        <SectionBand backdrop="/backgrounds/rwa-bg.webp">
          {/* Every panel in the grid is one of these reads, never a new query:
              the latest verdict is simply the newest ledger row. */}
          <ProductGrid
            latestVerdict={ledgerFeed.entries[0] ?? null}
            wanted={wantedRows}
            nightMarket={nightMarketRows}
            rwa={rwa.items}
            rwaTotal={rwa.totalCount}
            ecosystemTotal={ecosystem.totalCount}
            ecosystemCategories={ecosystem.categories.length}
          />
          <RwaShowcase
            items={rwa.items}
            totalCount={rwa.totalCount}
            categoryCount={rwa.categoryCount}
            categories={rwa.categories}
            marketComplete={rwa.marketComplete}
          />
        </SectionBand>
      </ProductsRevealProvider>
      <RobinKnightSection />
      <NightMarketSection
        rows={nightMarketRows}
        activity={visibleLaunchesByHour}
        measured={isDatabaseConfigured()}
        stats={{
          onCurve: onCurveCount,
          onDex: onDexCount,
          graduated24h: graduated24hCount,
          trades24h: trades24hCount,
          graduations: stats.curve_graduations,
          launchpadsLive: stats.launchpads_live,
        }}
      />
      <EcosystemSection
        items={ecosystem.items}
        categories={ecosystem.categories}
        totalCount={ecosystem.totalCount}
      />
      <RecordSection rows={ledgerFeed.entries} stats={stats} wanted={wantedRows} />
      <HowItWorks />
      <TokenSection />
      <WhyRobinCalls />
      <ClosingCta />
      <SiteFooter />
    </>
  );
}
