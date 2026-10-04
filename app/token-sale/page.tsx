import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { flags } from "@/lib/config/flags";
import { SITE_URL } from "@/lib/config/site";
import { resolveSaleAddress } from "@/lib/sale/address";
import { readSaleSnapshotCached } from "@/lib/sale/server";
import { reportError } from "@/lib/observability/reporter";
import { readSaleClock } from "@/lib/sale/schedule";
import { saleReader } from "@/lib/referrals/census";
import { SalePageClient } from "./SalePageClient";
import { SaleTeaser } from "./SaleTeaser";

/**
 * The client-facing TokenSale page: a teaser before the sale opens, the live
 * sale interface once `flags.tokenSale` is on. Indexed in BOTH states so the
 * page accrues search authority before launch day rather than starting cold.
 *
 * force-dynamic is load-bearing twice over: the address comes from site_config
 * per request, and a static/ISR render would bake a build-time empty DB read,
 * the failure that already hit 4 routes here. The address NEVER comes from a
 * NEXT_PUBLIC_ var: those are build-time inlined, so rotating a sale address
 * would silently require a rebuild.
 */
export const dynamic = "force-dynamic";

import { SEO_ROUTES } from "@/lib/config/seo";
import { COMMISSION_BPS } from "@/lib/referrals/rules";

/** Drop the referral card here (1200x630) and every `?ref=` link shares it; until then the default card. */
const REFERRAL_OG_IMAGE = "/brand/og-referral.jpg";

export async function generateMetadata({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }): Promise<Metadata> {
  const referred = typeof (await searchParams).ref === "string";
  const title = referred ? "You are invited to the ROBINCALLS fair launch | RobinCalls" : SEO_ROUTES.tokenSale.title;
  const description = referred
    ? `Open this invite, connect a wallet and contribute with the code already filled in to get ${COMMISSION_BPS.buyerBonus / 100}% more tokens. Pro-rata, priced at the close, on Robinhood Chain.`
    : SEO_ROUTES.tokenSale.description;
  const image = referred && existsSync(join(process.cwd(), "public", REFERRAL_OG_IMAGE)) ? REFERRAL_OG_IMAGE : "/brand/og-default.jpg";
  return {
    title,
    description,
    keywords: [...SEO_ROUTES.tokenSale.keywords],
    alternates: { canonical: "/token-sale" },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/token-sale`,
      siteName: "RobinCalls",
      title,
      description,
      images: [
        {
          url: image,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default async function TokenSalePage() {
  // Not a 404 any more: the teaser is a real page with real content and no
  // live numbers, so there is nothing to mistake for a configured-but-empty sale.
  if (!flags.tokenSale) return <SaleTeaser />;

  const resolved = await resolveSaleAddress();
  const contract = resolved.kind === "address" ? resolved.address : "";
  const client = resolved.kind === "address" ? saleReader(resolved.chainId) : undefined;
  // Cached for 5s and single-flighted: this route is force-dynamic, so without
  // it every visitor pays 3 RPC requests for numbers identical to everyone
  // else's. The browser polls live on top of this render anyway.
  const [snapshot, clock] = await Promise.all([
    contract && resolved.kind === "address"
      ? readSaleSnapshotCached(contract, { client, chainId: resolved.chainId }).catch((error: unknown) => {
          // A transient RPC fault rethrows from the reader; thrown here it replaced the whole page with Next's
          // error screen. Null is "no first paint", and the client's live poll fills the numbers (§4: "—", never 0).
          void reportError({ code: "RC_RPC_UNAVAILABLE", message: "token sale first-paint snapshot failed", operation: "sale.pageSnapshot", error });
          return null;
        })
      : null,
    readSaleClock(),
  ]);
  return (
    <SalePageClient
      contract={contract}
      addressState={resolved.kind}
      snapshot={snapshot}
      chainId={resolved.kind === "address" ? resolved.chainId : undefined}
      schedule={clock.schedule}
      renderedAt={clock.renderedAt}
    />
  );
}
