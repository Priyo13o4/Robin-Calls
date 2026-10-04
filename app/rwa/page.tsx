import type { Metadata } from "next";
import { isTrustedRwaToken, primeTrustedAddresses, trustedAddresses } from "@/lib/config/trusted-addresses";
import { readRwaRegistryTokens } from "@/lib/data/registry";
import { readAllRwaQuotes, type RwaQuote } from "@/lib/market/rwa-quotes";
import { RwaTerminalClient, type InfraItem } from "../components/site/RwaTerminalClient";
import type { RwaMarketRow } from "@/app/api/rwa/feed/route";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.rwa.title,
  description: SEO_ROUTES.rwa.description,
  keywords: [...SEO_ROUTES.rwa.keywords],
  alternates: { canonical: "/rwa" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/rwa`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.rwa.title,
    description: SEO_ROUTES.rwa.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.rwa.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.rwa.title,
    description: SEO_ROUTES.rwa.description,
    images: ["/brand/og-default.jpg"],
  },
};

export const dynamic = "force-dynamic";

export default async function RwaIndexPage() {
  await primeTrustedAddresses();
  const rawTokens = await readRwaRegistryTokens();

  const addresses = rawTokens.map((t) => t.address);
  const { quotes } = await readAllRwaQuotes(addresses);

  const initialTokens: RwaMarketRow[] = rawTokens.map((t) => {
    const q: RwaQuote | undefined = quotes.get(t.address.toLowerCase());
    return {
      address: t.address,
      asset_name: t.asset_name,
      asset_symbol: t.asset_symbol,
      category: t.category,
      verify_status: t.verify_status,
      trusted: t.verify_status === "ok" && isTrustedRwaToken(t.address),
      priceUsd: q?.priceUsd ?? null,
      marketCapUsd: q?.marketCapUsd ?? null,
      volume24hUsd: q?.volume24hUsd ?? null,
      liquidityUsd: q?.liquidityUsd ?? null,
      trades24h: q?.trades24h ?? null,
      poolAddress: q?.poolAddress ?? null,
      changeM5: q?.changeM5 ?? null,
      changeH1: q?.changeH1 ?? null,
      changeH6: q?.changeH6 ?? null,
      changeH24: q?.changeH24 ?? null,
    };
  });

  // Default sort by 24h trade volume descending, then symbol alphabetical
  initialTokens.sort((a, b) => {
    const volA = a.volume24hUsd ?? 0;
    const volB = b.volume24hUsd ?? 0;
    if (volB !== volA) return volB - volA;
    return a.asset_symbol.localeCompare(b.asset_symbol);
  });

  const infrastructure: InfraItem[] = trustedAddresses()
    .filter((r) =>
      ["rwa-beacon", "rwa-impl", "rwa-factory", "rwa-vault", "rwa-operator"].includes(r.category)
    )
    .map((r) => ({
      address: r.address,
      label: r.label,
      category: r.category,
    }));

  return <RwaTerminalClient initialTokens={initialTokens} infrastructure={infrastructure} />;
}
