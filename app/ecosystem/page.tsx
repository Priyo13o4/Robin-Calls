import type { Metadata } from "next";
import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { EcosystemNetflixClient } from "../components/site/EcosystemNetflixClient";
import { queryPublishedPlatforms } from "@/lib/data/registry";
import { cdnUrl } from "@/lib/config/cdn";
import { SITE_URL } from "@/lib/config/site";
import type { DirectoryPlatform } from "@/lib/types";

/**
 * The index's title carries the category words a search actually uses
 * ("launchpads", "wallets", "DeFi") rather than only the brand phrase — this
 * page's job is to be the answer to "what is on Robinhood Chain", and it can
 * only rank for words it contains.
 */
import { SEO_ROUTES, ECOSYSTEM_FAQ_ITEMS } from "@/lib/config/seo";
import { SeoFaq } from "../components/site/SeoFaq";

export const metadata: Metadata = {
  title: SEO_ROUTES.ecosystem.title,
  description: SEO_ROUTES.ecosystem.description,
  keywords: [...SEO_ROUTES.ecosystem.keywords],
  alternates: { canonical: "/ecosystem" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/ecosystem`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.ecosystem.title,
    description: SEO_ROUTES.ecosystem.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.ecosystem.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.ecosystem.title,
    description: SEO_ROUTES.ecosystem.description,
    images: ["/brand/og-default.jpg"],
  },
};

export const revalidate = 300;

/**
 * CollectionPage wrapping an `ItemList` of the listings, each pointing at its own
 * page so a crawler gets the member URLs without walking the client-filtered grid.
 */
function ecosystemJsonLd(platforms: DirectoryPlatform[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${SITE_URL}/ecosystem#collection`,
        name: SEO_ROUTES.ecosystem.title,
        url: `${SITE_URL}/ecosystem`,
        description: SEO_ROUTES.ecosystem.description,
        mainEntity: {
          "@type": "ItemList",
          name: "Robinhood Chain ecosystem",
          numberOfItems: platforms.length,
          itemListElement: platforms.map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: p.name,
            url: `${SITE_URL}/ecosystem/${p.slug}`,
          })),
        },
      },
    ],
  };
}

export default async function EcosystemPage() {
  const platforms = await queryPublishedPlatforms();

  return (
    <NoirShell>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ecosystemJsonLd(platforms)) }}
      />
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/library-directory-bg.webp")}
            alt="Library Directory Background"
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-90"
          />
          {/* Gentle vignette to blend the image and keep text readable */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.75) 20%, rgba(10,10,10,0.75) 80%, #0A0A0A 100%)",
            }}
          />
        </div>

        {/* Film grain noise */}
        <div
          className="pointer-events-none fixed inset-0 z-[1] opacity-[0.055]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'240\' height=\'240\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
            backgroundRepeat: "repeat",
          }}
        />

        {/* Content Layer */}
        <div className="relative z-10">
          <PageHeader
            title="THE ECOSYSTEM"
            subline="The agent era of Robinhood Chain. Indexed."
          >
            <p className="mt-2 max-w-2xl text-xs text-[#8a8a8a]">
              A reviewed list of projects on Robinhood Chain: launchpads, DEXs, wallets, DeFi, AI tools and more.
            </p>
          </PageHeader>
          <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
            <EcosystemNetflixClient platforms={platforms} />
          </section>

          {/* Static SSR Crawlable Directory Index — ensures search crawlers & GEO bots discover and index every platform profile */}
          <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 border-t border-[#1C1C1C]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-cinzel text-xs tracking-widest text-[#888888] uppercase">
                All Verified Protocols ({platforms.length})
              </h2>
              <span className="font-mono text-[10px] text-[#555555]">Chain 4663 Directory</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-x-4 gap-y-2.5">
              {platforms.map((p) => (
                <a
                  key={p.slug}
                  href={`/ecosystem/${p.slug}`}
                  className="font-inter text-xs text-[#777777] hover:text-[#EDEDEA] transition-colors truncate"
                  title={`${p.name} on Robinhood Chain`}
                >
                  {p.name}
                </a>
              ))}
            </div>
          </section>

          <SeoFaq items={ECOSYSTEM_FAQ_ITEMS} />
        </div>
      </div>
    </NoirShell>
  );
}
