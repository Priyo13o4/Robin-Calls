import type { Metadata } from "next";
import { Cinzel, Inter } from "next/font/google";
import { WalletKitProvider } from "@/lib/wallet/WalletKitProvider";
import { WhitelistStatusProvider } from "./components/site/WhitelistStatusContext";
import { ScrollResetOnNavigate } from "./components/site/ScrollResetOnNavigate";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { resolveSaleAddress } from "@/lib/sale/address";

/**
 * Canonical site origin for absolute URLs in metadata, OpenGraph, robots, and
 * the sitemap. Falls back to the production host so a build with the env unset
 * still emits correct absolute URLs rather than `localhost`.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://robincalls.com";

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["600", "700", "900"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const OG_TITLE = "RobinCalls | Robinhood Chain RWA, Token Scanner, Night Market, Swap, Ecosystem & Robin Knight";
const OG_DESCRIPTION =
  "The trust and market intelligence platform for Robinhood Chain (chain 4663). Verify authentic RWAs and tokenized stocks, scan tokens for contract risks, track live Night Market launches, swap tokens across DEXs, explore the dApp ecosystem, and consult the Robin Knight AI copilot.";

/**
 * Site-wide social card, inherited by every page that does not set its own.
 * Relative because `metadataBase` above makes it absolute — and it stays on
 * our own origin rather than the CDN: crawlers refetch this per share and some
 * are fussy about cross-origin image hosts.
 *
 * Verdict pages override `images` with the generated per-verdict card from
 * /api/og/[id] (see app/scan/[address]/page.tsx), which 404s on an unknown id
 * — so that override only happens once the row is known to exist.
 */
const OG_IMAGE = {
  url: "/brand/og-default.jpg",
  width: 1200,
  height: 630,
  alt: OG_TITLE,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: OG_TITLE,
  description: OG_DESCRIPTION,
  keywords: [
    "robincalls",
    "robincalls rwa",
    "robincalls token scanner",
    "robincalls night market",
    "robincalls swap",
    "robincalls ecosystem",
    "robincalls robin knight",
    "robincalls ledger",
    "robincalls wanted",
    "robinhood chain rwa",
    "robinhood chain tokenized stocks",
    "robinhood chain token scanner",
    "robinhood chain launchpads",
    "robinhood chain swap",
    "chain 4663",
    "robinhood l2",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "RobinCalls",
    url: SITE_URL,
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
    images: [OG_IMAGE.url],
  },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/site.webmanifest",
};

/**
 * Organization + WebSite + SoftwareApplication JSON-LD — read by AI answer
 * engines (GEO/AEO) and Google's knowledge graph to resolve "RobinCalls" as a
 * multi-product platform entity rather than two dictionary words.
 */
const ORG_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "RobinCalls",
      alternateName: [
        "Robin Calls",
        "robincalls.com",
        "RobinCalls RWA",
        "RobinCalls Token Scanner",
        "RobinCalls Night Market",
        "RobinCalls Swap",
        "RobinCalls Ecosystem",
        "RobinCalls Robin Knight",
        "RobinCalls Ledger",
        "RobinCalls Wanted",
      ],
      url: SITE_URL,
      logo: `${SITE_URL}/brand/logo.png`,
      description: OG_DESCRIPTION,
      sameAs: [
        "https://x.com/RobinCalls",
        "https://t.me/RobinCallsChat",
        "https://t.me/RobinCallsAnn",
      ] as string[],
      hasPart: [
        {
          "@type": "WebPage",
          name: "RobinCalls RWA",
          url: `${SITE_URL}/rwa`,
          description: "Verified tokenized stocks and authentic RWAs on Robinhood Chain.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls Token Scanner",
          url: `${SITE_URL}/scan`,
          description: "Evidence-backed token security verdicts and contract safety checks.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls Night Market",
          url: `${SITE_URL}/night-market`,
          description: "Live launchpad aggregator and bonding curve discovery for Robinhood Chain.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls Swap",
          url: `${SITE_URL}/swap`,
          description: "Instant token swap and cross-DEX execution on Robinhood Chain.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls Ecosystem",
          url: `${SITE_URL}/ecosystem`,
          description: "Reviewed directory of dApps, launchpads, DEXs and protocols on Robinhood Chain.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls Robin Knight",
          url: `${SITE_URL}/robin-knight`,
          description: "On-chain AI intelligence agent and verdict copilot for Robinhood Chain.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls The Ledger",
          url: `${SITE_URL}/ledger`,
          description: "Public hash-chained audit ledger of all published token verdicts.",
        },
        {
          "@type": "WebPage",
          name: "RobinCalls Wanted Board",
          url: `${SITE_URL}/wanted`,
          description: "On-chain evidence tracker for deployer liquidity drains and rug pulls.",
        },
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: "RobinCalls",
      alternateName: [
        "Robin Calls",
        "robincalls.com",
        "RobinCalls RWA",
        "RobinCalls Token Scanner",
        "RobinCalls Night Market",
        "RobinCalls Swap",
        "RobinCalls Ecosystem",
      ],
      description: OG_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "RobinCalls Intelligence Platform",
      applicationCategory: "FinanceApplication, SecurityApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description: OG_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const sale = await resolveSaleAddress();
  const saleChainId = sale.kind === "address" ? sale.chainId : null;

  return (
    <html
      lang="en"
      // .dark is permanent, not a theme toggle: the site is noir-only, and the
      // class routes shadcn's token set to the Noir values in globals.css.
      className={`${cinzel.variable} ${inter.variable} dark h-full antialiased overflow-x-hidden`}
    >
      {/*
        `overflow-x-hidden` belongs on <html> ONLY, and must not be repeated here.

        When an element sets `overflow-x: hidden`, CSS computes its `overflow-y`
        from `visible` up to `auto` — so this class silently turned <body> into
        its own scroll container. Body's overflow is normally propagated to the
        viewport and body itself stays unstyled, but that propagation is skipped
        when <html> already declares its own overflow (which it does, above), so
        the two did not collapse into one box.

        Every `position: sticky` element in the app then resolved against body's
        scrollport instead of the viewport. Body's scrollport is the full
        document height and never scrolls (html is the scrolling element), so
        the sticky constraint could never trigger: the app sidebar, the
        methodology rails and the reading-progress rule all scrolled straight
        off the top of the screen. Verified before the fix — the sidebar's
        viewport-relative top tracked scrollY exactly (0 → -1500 at scrollY
        1500). Horizontal overflow is still clipped, by <html>, at the same box.
      */}
      <body className="min-h-[100dvh] flex flex-col font-inter w-full">
        <script
          type="application/ld+json"
          // Static and identical on every render — safe to skip the
          // client/server text-content diff that would otherwise trip
          // hydration warnings over JSON key ordering.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSON_LD) }}
        />
        <script
          id="rc-sale-chain"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `window.__SALE_CHAIN_ID__=${JSON.stringify(saleChainId)};`,
          }}
        />
        {/*
          BACKSTOP ONLY — the deploy-skew fix is the chunk archive.

          `.next/static` is a persistent volume in production and every build
          merges into it (docker/app/entrypoint.sh), so a tab open across a
          deploy still resolves the hashes its build emitted. That is what
          actually fixed "some pages fail to load, a reload works": the assets
          stop disappearing.

          This handler covers only what the archive cannot — a tab left open
          past the archive's retention window (NEXT_STATIC_RETENTION_DAYS,
          default 14). It reloads once to pick up the current build rather than
          showing a broken page.

          The sessionStorage guard has an in-memory fallback because the
          accessor itself THROWS where site data is blocked (private windows,
          some embedded webviews). Reloading unconditionally in that catch is
          an immediate reload loop with no gap between attempts, so the flag
          caps it at one reload per page load.
        */}
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof window==='undefined')return;var K='rc_stale_reload',M=false;function r(){try{var l=sessionStorage.getItem(K),n=Date.now();if(!l||n-parseInt(l,10)>15000){sessionStorage.setItem(K,String(n));window.location.reload();}}catch(e){if(M)return;M=true;window.location.reload();}}window.addEventListener('error',function(e){var m=e&&e.message?e.message:'',t=e&&e.target;if((t&&t.tagName==='SCRIPT'&&t.src&&t.src.indexOf('/_next/static/chunks/')!==-1)||/chunkloaderror|loading chunk|failed to load chunk/i.test(m)){r();}},true);window.addEventListener('unhandledrejection',function(e){var re=e&&e.reason,m=re&&(re.message||re.stack)?(re.message||re.stack):String(re);if(/chunkloaderror|loading chunk|failed to load chunk/i.test(m)){r();}});})();`,
          }}
        />
        {/* Root layout, not NoirShell — NoirShell is instantiated per top-level
            page (there is no shared `app/(app)/layout.tsx` segment), so a
            provider mounted there loses its state on every navigation between
            different routes. Root layout is the one thing App Router actually
            keeps alive across client-side navigations. See
            WhitelistStatusContext.tsx for what broke without this. */}
        {/* wagmi context useWallet needs, outermost of the two — WhitelistStatusProvider
            calls useWallet() on mount and would throw "must be used within a
            WagmiProvider" without it above. */}
        <ScrollResetOnNavigate />
        <WalletKitProvider initialChainId={saleChainId ?? undefined}>
          <WhitelistStatusProvider>{children}</WhitelistStatusProvider>
        </WalletKitProvider>
        {/* Root, for the same reason as the providers above: a toast raised by a
            transaction must survive the navigation that transaction triggers. */}
        <Toaster position="bottom-right" skin="solid" />
      </body>
    </html>
  );
}
