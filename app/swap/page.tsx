import type { Metadata } from "next";
import { NoirShell } from "../components/site/NoirShell";
import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";
import { SwapExperience } from "./SwapExperience";

export const metadata: Metadata = {
  title: SEO_ROUTES.swap.title,
  description: SEO_ROUTES.swap.description,
  keywords: [...SEO_ROUTES.swap.keywords],
  alternates: { canonical: "/swap" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/swap`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.swap.title,
    description: SEO_ROUTES.swap.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.swap.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.swap.title,
    description: SEO_ROUTES.swap.description,
    images: ["/brand/og-default.jpg"],
  },
};

const SWAP_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "RobinCalls", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Swap", item: `${SITE_URL}/swap` },
      ],
    },
    {
      "@type": "FinancialService",
      "@id": `${SITE_URL}/swap#service`,
      name: "RobinCalls Swap",
      url: `${SITE_URL}/swap`,
      description: SEO_ROUTES.swap.description,
      provider: { "@type": "Organization", name: "RobinCalls", url: SITE_URL },
      serviceType: "Decentralized Cryptocurrency Exchange & Cross-Pool Swap",
      areaServed: "Global",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/swap#app`,
      name: "RobinCalls Swap Engine",
      url: `${SITE_URL}/swap`,
      applicationCategory: "DecentralizedFinanceApplication",
      operatingSystem: "All",
      description:
        "Native swap interface and multihop DEX aggregator on Robinhood Chain with pre-execution safety simulation and multi-venue routing.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default function SwapPage() {
  return (
    <NoirShell>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SWAP_JSON_LD) }}
      />
      <SwapExperience />
    </NoirShell>
  );
}
