import type { Metadata } from "next";

import { AgentPageClient } from "../components/agent/AgentPageClient";
import { NoirShell, PageHeader } from "../components/site/NoirShell";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.robinKnight.title,
  description: SEO_ROUTES.robinKnight.description,
  keywords: [...SEO_ROUTES.robinKnight.keywords],
  alternates: { canonical: "/robin-knight" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/robin-knight`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.robinKnight.title,
    description: SEO_ROUTES.robinKnight.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.robinKnight.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.robinKnight.title,
    description: SEO_ROUTES.robinKnight.description,
    images: ["/brand/og-default.jpg"],
  },
};

const ROBIN_KNIGHT_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "RobinCalls", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Robin Knight", item: `${SITE_URL}/robin-knight` },
      ],
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/robin-knight#agent`,
      name: "Robin Knight AI Copilot",
      applicationCategory: "AIApplication, SecurityApplication, FinanceApplication",
      operatingSystem: "Web",
      url: `${SITE_URL}/robin-knight`,
      description: SEO_ROUTES.robinKnight.description,
      provider: {
        "@type": "Organization",
        name: "RobinCalls",
        url: SITE_URL,
      },
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

/**
 * The agent plane's public surface — at `/robin-knight`, NOT `/agent`.
 *
 * `/agent/` belongs to the FastAPI container: nginx has a `location /agent/`
 * that proxies there, and nginx answers a request for `/agent` with a permanent
 * redirect to `/agent/` — which lands on the API, not on this page. So a page
 * at `/agent` is unreachable in every real deployment while working perfectly
 * in `next dev`, where there is no nginx. Measured, not reasoned about: it 301'd
 * on the first request through the local stack.
 *
 * `force-dynamic` is deliberately absent: everything here is fetched by the
 * browser from `/agent/*` (which never reaches Next at all), and the
 * conversation lives in the visitor's own browser. There is nothing for the
 * server to render per request.
 */
export default function AgentPage() {
  return (
    <NoirShell>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ROBIN_KNIGHT_JSON_LD) }}
      />
      <PageHeader
        eyebrow="ROBINHOOD CHAIN · ID 4663"
        title="THE ROBIN KNIGHT"
        subline="The native on-chain AI intelligence copilot for Robinhood Chain. Every figure it states was read from the record, and if it was not read, it does not reach the page."
      />
      <AgentPageClient />
    </NoirShell>
  );
}
