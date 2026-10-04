import type { Metadata } from "next";
import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { ScanForm } from "../components/site/ScanForm";
import { RobinKnightDock } from "../components/agent/RobinKnightDock";
import { cdnUrl } from "@/lib/config/cdn";
import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES, SCANNER_WEB_APP_JSON_LD, SCAN_FAQ_ITEMS } from "@/lib/config/seo";
import { SeoFaq } from "../components/site/SeoFaq";

export const metadata: Metadata = {
  title: SEO_ROUTES.scan.title,
  description: SEO_ROUTES.scan.description,
  keywords: [...SEO_ROUTES.scan.keywords],
  alternates: { canonical: "/scan" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/scan`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.scan.title,
    description: SEO_ROUTES.scan.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.scan.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.scan.title,
    description: SEO_ROUTES.scan.description,
    images: ["/brand/og-default.jpg"],
  },
};

export default function ScanPage() {
  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/court-verdict-bg.webp")}
            alt="Verdict Background"
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
          <script
            type="application/ld+json"
            suppressHydrationWarning
            dangerouslySetInnerHTML={{ __html: JSON.stringify(SCANNER_WEB_APP_JSON_LD) }}
          />
          <PageHeader
            eyebrow="ROBINHOOD CHAIN · ID 4663"
            title="THE VERDICT"
            subline="Paste a contract. We read the chain, simulate the exit, and put the score on record."
          >
            <p className="mt-2 max-w-2xl text-xs text-[#8a8a8a]">
              Check any Robinhood Chain token before you buy: can it be sold, can the liquidity be pulled, and who holds the supply.
            </p>
          </PageHeader>
          <ScanForm />
          <SeoFaq items={SCAN_FAQ_ITEMS} className="pt-16" />
        </div>

        {/* No address in this route. The dock mounts but renders NULL until a
            verdict announces a subject, and withdraws again when that verdict
            unmounts — this page renders the verdict inline, so scanning a second
            token must not leave the rail open over the bare form. */}
        <RobinKnightDock />
      </div>
    </NoirShell>
  );
}
