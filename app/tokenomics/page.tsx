import type { Metadata } from "next";
import Link from "next/link";
import { flags } from "@/lib/config/flags";
import { NoirShell } from "@/app/components/site/NoirShell";
import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "@/lib/config/chain";
import { CIRCULATING_SUPPLY, TOKEN_ADDRESS, TOKEN_DECIMALS, TOKEN_EXPLORER_URL, TOKEN_NAME, TOKEN_SYMBOL } from "@/lib/sale/token";
import { SITE_URL } from "@/lib/config/site";
import { LAUNCH_PRINCIPLES } from "@/lib/sale/tokenomics";
import { TOTAL_SUPPLY } from "@/lib/sale/projection";
import { AddToWalletButton } from "@/app/components/site/AddToWalletButton";
import { AllocationSection } from "./AllocationSection";
import { SectionHead } from "./SectionHead";
import { VestingExplorer } from "./VestingExplorer";
import { VestedAddressesPanel } from "./VestedAddressesPanel";
import { SupplyCounter } from "./SupplyCounter";

/**
 * The public tokenomics reference. Live since 2026-09-04 (relaunched after the
 * split was finalized) - no flag gates this route any more.
 *
 * Fully static: no DB read, no RPC, nothing that can bake an empty snapshot at
 * image-build time (the ISR trap). The token facts, circulating supply included,
 * are lib/sale/token.ts and everything numeric renders from
 * `lib/sale/tokenomics.ts` and `lib/sale/projection.ts` - the same modules the
 * sale page reads - so the two pages cannot drift.
 *
 * NO PRICE OR FDV PROJECTION LIVES HERE. It moved to /token-sale, where the
 * raise it projects from is a real number this page does not have; a fact
 * sheet had to invent raise levels to draw it. The listing-price line and its
 * structural +20% are gone entirely (lib/sale/projection.ts says why).
 *
 * Section 04 draws VESTING & UNLOCK SCHEDULE — the operator's decided
 * schedule, every locked row fully unlocked by month 24. The LP position lock
 * is the one decision still open (duration unfixed), and its draft stamp in
 * section 02 is what says so; nothing on this page invents a number for it.
 * Section 03, PROJECTED CIRCULATING SUPPLY, is derived from 04 but renders
 * ABOVE it (VestingExplorer.tsx explains why: it's the headline number, and
 * a phone should see it first).
 */
export const metadata: Metadata = {
  title: "Tokenomics: Supply & Vesting Schedule | RobinCalls",
  description:
    "The ROBINCALLS token distribution, vesting schedule, and launch principles: all numbers derived from the ten million total supply without speculation.",
  alternates: { canonical: "/tokenomics" },
  // No ticker or contract address exists yet (see THE TOKEN, below the hero) -
  // stay unindexed until there is a real contract to crawl. Flipping this is an
  // operator decision, not an SEO chore: it is what makes /tokenomics eligible
  // to rank as a token page before a token exists.
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/tokenomics`,
    siteName: "RobinCalls",
    title: "Tokenomics: Supply & Vesting Schedule | RobinCalls",
    description:
      "The ROBINCALLS token distribution, vesting schedule, and launch principles: all numbers derived from the ten million total supply without speculation.",
    images: [
      {
        url: "/brand/og-default.jpg",
        width: 1200,
        height: 630,
        alt: "Tokenomics: Supply & Vesting Schedule | RobinCalls",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tokenomics: Supply & Vesting Schedule | RobinCalls",
    description:
      "The ROBINCALLS split, the vesting schedule and the launch principles: every number derived from one 10,000,000 supply, none asserted.",
    images: ["/brand/og-default.jpg"],
  },
};

/**
 * ISR, not static. The page's own content is constants, but it reads
 * `flags.tokenSale`, and a fully prerendered page bakes that env var at IMAGE
 * BUILD time: ENABLE_TOKEN_SALE lives in .env.production on the VPS, so
 * flipping it would never reach this route. 60s matches the landing page.
 */
export const revalidate = 60;

export default function TokenomicsPage() {
  return (
    <NoirShell>
      <style
        // Page-scoped rather than globals.css: this motion belongs to one
        // route, and globals.css is owned by the landing workstream.
        //
        // NOTHING HERE STARTS AT OPACITY 0. The page used to fade each section
        // in on scroll, which meant every word was dim until JS decided
        // otherwise; it also froze whole sections blank in any environment
        // whose animation clock does not tick. Text is painted, full strength,
        // on the first frame. What is left moves things that are already
        // visible.
        dangerouslySetInnerHTML={{
          __html: `
@keyframes tk-tick { from { transform: translateY(10px) skewX(-6deg); } to { transform: none; } }
@keyframes tk-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes tk-scan { from { transform: translateY(-100%); } to { transform: translateY(105vh); } }

/* Split card: brushed-metal rails on the two sides only, a glass sheen across the top. */
.tk-card { position: relative; border-radius: 14px; background: linear-gradient(180deg, rgba(255,255,255,.075) 0%, rgba(255,255,255,.02) 34%, rgba(18,18,18,.78) 100%); backdrop-filter: blur(12px) saturate(140%); -webkit-backdrop-filter: blur(12px) saturate(140%); box-shadow: inset 0 1px 0 rgba(255,255,255,.16), inset 0 -1px 0 rgba(0,0,0,.6), 0 14px 32px -20px rgba(0,0,0,.95); }
.tk-card::before, .tk-card::after { content: ""; position: absolute; top: 10px; bottom: 10px; width: 2px; border-radius: 2px; pointer-events: none; background: linear-gradient(180deg, rgba(90,90,86,0) 0%, #8d8d88 12%, #e6e6df 30%, #6c6c68 52%, #cfcfc8 74%, #7a7a75 88%, rgba(90,90,86,0) 100%); box-shadow: 0 0 6px rgba(230,230,223,.12); }
.tk-card::before { left: 0; }
.tk-card::after { right: 0; }

@media (prefers-reduced-motion: no-preference) {
  .tk-scan { animation: tk-scan 9s linear infinite; }
  .tk-pulse { animation: tk-pulse 1.8s ease-in-out infinite; }
  .tk-tick { animation: tk-tick .35s cubic-bezier(.215,.61,.355,1) both; }
}`,
        }}
      />

      {/* full-bleed backdrop: courtroom vignette + grain, the shared interior
          pattern; pointer-events-none so chrome stays clickable */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(120%_80%_at_50%_-10%,#161610_0%,#0a0a0a_55%)]" />
      <div className="halftone-dark pointer-events-none fixed inset-0 z-[1] opacity-[0.22]" />
      {/* slow scanline sweep — a transform on the compositor, so a busy main
          thread cannot stall it */}
      <div
        aria-hidden
        className="tk-scan pointer-events-none fixed inset-x-0 top-0 z-[1] h-32 bg-gradient-to-b from-transparent via-[rgba(204,255,0,0.035)] to-transparent"
      />

      {/* Headings and spacing sit on a φ scale: 10 · 16 · 26 · 42 · 68 · 110, with
          √φ half-steps 20 · 33 · 53 · 86 · 140. Text under 20px runs 1.2× that scale. */}
      <div className="relative z-[2]">
        {/* 00 · HERO — the supply, then what it is split into */}
        <header className="mx-auto max-w-6xl px-4 pb-2 pt-[68px] sm:px-8 sm:pt-[110px]">
          <p className="mb-[26px] font-mono text-[12px] tracking-[0.3em] text-[#ccff00]/80 sm:text-[13px]">
            THE TOKEN · {robinhoodChain.name.toUpperCase()} · ID {ROBINHOOD_CHAIN_ID}
          </p>
          <h1 className="font-cinzel text-[clamp(42px,7.4vw,86px)] font-black leading-[0.98] tracking-wide text-white">
            TOKEN<span className="text-[#ccff00]">OMICS</span>
          </h1>
          {/* Not a second <h1> — the page's one heading is the word above;
              this is the number the page is actually about. */}
          <div className="mt-[16px] flex flex-wrap items-baseline gap-x-[26px] gap-y-[10px]">
            <p className="font-cinzel text-[clamp(53px,9.6vw,140px)] font-black leading-[0.95] tracking-wide tabular-nums text-white">
              <SupplyCounter value={TOTAL_SUPPLY} />
            </p>
            <span className="font-cinzel text-[clamp(16px,1.7vw,20px)] font-bold tracking-[0.3em] text-[#ccff00]">
              ROBINCALLS
            </span>
          </div>
          <p className="mt-[26px] max-w-[42rem] font-serif text-[19px] italic leading-[1.618] text-[#a8a8a2] sm:text-[20px]">
            Split once, seven ways. Every number on this page comes from that
            split: the token counts, the unlock curve, and{" "}
            <span className="text-white">what can move, when</span>.
          </p>
        </header>

        {/* THE TOKEN: a continuation of the hero, not a numbered chapter. */}
        <div className="mx-auto max-w-6xl px-4 pt-[42px] sm:px-8">
          <div className="grid gap-px border-2 border-[#2a2a2a] bg-[#2a2a2a] shadow-[8px_8px_0_0_#1c1c1c] sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="TOKEN NAME" value={TOKEN_NAME} />
            <Fact label="TICKER" value={`$${TOKEN_SYMBOL}`} />
            <Fact label="STANDARD, DECIMALS" value={`ERC-20, ${TOKEN_DECIMALS}`} />
            <Fact
              label="CIRCULATING SUPPLY"
              value={CIRCULATING_SUPPLY.toLocaleString("en-US")}
              suffix={`${+((CIRCULATING_SUPPLY / TOTAL_SUPPLY) * 100).toFixed(2)}%`}
            />
            <div className="flex min-w-0 flex-col gap-[16px] bg-[#141414] px-[26px] py-[26px] sm:col-span-2 xl:col-span-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="mb-[10px] font-mono text-[14.5px] tracking-[0.18em] text-[#ccff00]/80">
                  CONTRACT ADDRESS
                </p>
                <a
                  href={TOKEN_EXPLORER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 max-w-full items-center gap-2.5 font-mono text-[17px] font-bold tracking-[0.02em] text-white transition-colors hover:text-[#ccff00] sm:text-[23px]"
                >
                  <span aria-hidden className="h-2 w-2 flex-none bg-[#ccff00]" />
                  <span className="min-w-0 break-all">{TOKEN_ADDRESS}</span>
                </a>
              </div>
              <AddToWalletButton />
            </div>
          </div>
          <p className="mt-[10px] font-mono text-[14.5px] leading-[1.618] text-[#8a8a8a]">
            Circulating is the total supply minus the 3,850,000 locked on PinkLock.
          </p>
        </div>

        <div className="mx-auto max-w-6xl px-4 pt-[68px] sm:px-8 sm:pt-[110px]">
          <section>
            <SectionHead
              n="01"
              title="ALLOCATION"
              sub={`${TOTAL_SUPPLY.toLocaleString('en-US')} ROBINCALLS, SPLIT SEVEN WAYS, FINAL.`}
            />
            <AllocationSection />
          </section>
        </div>

        <div className="mx-auto flex max-w-6xl flex-col gap-[68px] px-4 pb-[110px] pt-[68px] sm:gap-[110px] sm:px-8 sm:pt-[110px]">
          {/* 02 · LAUNCH PRINCIPLES */}
          <section>
            <SectionHead
              n="02"
              title="LAUNCH PRINCIPLES"
              sub="WHAT IS PROMISED, AND WHAT IS ONLY PLANNED"
            />
            <ol className="grid list-none gap-px border border-[#2a2a2a] bg-[#2a2a2a] p-0 sm:grid-cols-2">
              {LAUNCH_PRINCIPLES.map((p, i) => (
                <li
                  key={p.text}
                  className="flex items-center gap-[26px] bg-[#141414] px-[26px] py-[26px] transition-colors hover:bg-[#181812]"
                >
                  <span className="w-14 flex-none font-cinzel text-[2.75rem] font-black leading-none tabular-nums text-[#2a2a2a]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {/* The stamp is in normal flow, not absolutely placed: as an
                      overlay it printed across the very sentence it qualifies. */}
                  <span className="min-w-0">
                    <span className="block font-cinzel text-[20px] font-bold leading-tight text-white">
                      {p.text}
                    </span>
                    {p.draft && (
                      <span className="mt-2 inline-block border-[1.5px] border-[#d9c96a] px-2 py-0.5 font-mono text-[11px] tracking-[0.16em] text-[#d9c96a]">
                        INTENT · NOT YET ON CHAIN
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {/* 03 · PROJECTED CIRCULATING SUPPLY and 04 · VESTING & UNLOCK
              SCHEDULE — the decided schedule and the curve it derives, both
              driven by one month cursor in one client island */}
          <VestingExplorer />

          <VestedAddressesPanel />

          {/* Gated on the sale flag for the same reason as the landing CTA:
              with it off /token-sale carries no date, so this page must not
              send a reader there expecting one. */}
          {flags.tokenSale && (
            <section className="border-2 border-[#2a2a2a] bg-[#141414] px-6 py-8 shadow-[8px_8px_0_0_#1c1c1c] sm:p-[42px]">
              <p className="font-cinzel text-[26px] font-black leading-tight text-white">
                The raise
              </p>
              <p className="mt-[16px] max-w-2xl font-serif text-[19px] italic leading-[1.618] text-[#a8a8a2] sm:text-[20px]">
                The public fair launch above is sold in one pool at one price, fixed when
                the sale closes.
              </p>
              <Link
                href="/token-sale"
                className="mt-6 inline-flex items-center gap-2 border-2 border-[#ccff00] bg-[#ccff00] px-5 py-3 font-inter text-[13px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a] transition-colors hover:bg-[#ededea] hover:border-[#ededea]"
              >
                Go to the token sale →
              </Link>
            </section>
          )}

        </div>
      </div>
    </NoirShell>
  );
}

/** One cell of the contract grid. */
function Fact({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="bg-[#141414] px-[26px] py-[26px]">
      <p className="mb-[10px] font-mono text-[12px] tracking-[0.18em] text-[#ccff00]/80">{label}</p>
      <p className="font-cinzel text-[26px] font-bold leading-tight text-white">
        {value}
        {suffix && (
          <span className="ml-[10px] whitespace-nowrap text-[19px] text-[#ccff00]">{suffix}</span>
        )}
      </p>
    </div>
  );
}
