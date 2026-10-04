import Link from "next/link";
import { cdnUrl } from "@/lib/config/cdn";
import { flags } from "@/lib/config/flags";
import type { SaleSchedule } from "@/lib/sale/schedule";
import { TOKEN_ADDRESS, TOKEN_EXPLORER_URL, TOKEN_NAME, TOKEN_SYMBOL, TOKEN_VERIFIERS } from "@/lib/sale/token";
import { PINKSALE_LOGO_URL } from "@/lib/sale/vesting-locks";
import { HeroRevealTrigger } from "./ProductsReveal";
import { HeroScanBar } from "./HeroScanBar";
import { SaleClock } from "./SaleClock";
import { TokenAddressBox } from "./TokenAddressBox";
import { SmartImage } from "../SmartImage";
import { AddToWalletButton } from "../AddToWalletButton";

const Tick = () => (
  <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 flex-none">
    <circle cx="8" cy="8" r="8" fill="#ccff00" />
    <path d="M4.6 8.3l2.2 2.1 4.6-4.8" fill="none" stroke="#0a0a0a" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function TokenCard() {
  return (
    <div className="w-full max-w-[680px]">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/robincalls-32.svg" alt="" aria-hidden width={26} height={26} className="h-[26px] w-[26px] rounded-full" />
        <span className="font-cinzel text-[20px] font-black leading-none text-[#ededea] sm:text-[22px]">{TOKEN_NAME}</span>
        <span className="rounded-full border border-[#ccff00]/40 bg-[#ccff00]/10 px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.12em] text-[#ccff00]">
          ${TOKEN_SYMBOL}
        </span>
      </div>

      <TokenAddressBox address={TOKEN_ADDRESS} explorerHref={TOKEN_EXPLORER_URL} />

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <li className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[#6f6f6f]">Verified on</li>
        {TOKEN_VERIFIERS.map((v) => (
          <li key={v.name}>
            <a
              href={v.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 font-inter text-[12.5px] font-medium text-[#c7c7c2] underline-offset-4 transition-colors hover:text-[#ccff00] hover:underline"
            >
              <Tick />
              {v.name}
            </a>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <Link
          href="/tokenomics#locks"
          className="inline-flex items-center gap-2 rounded-full bg-[#f95997] py-1.5 pl-1.5 pr-4 font-inter text-[11px] font-bold uppercase tracking-[0.06em] text-white sm:gap-2.5 sm:py-2 sm:pl-2 sm:pr-5 sm:text-[12px] sm:tracking-[0.1em] shadow-[0_0_32px_-10px_rgba(249,89,151,0.8)] transition-transform hover:-translate-y-0.5"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={PINKSALE_LOGO_URL} alt="" aria-hidden width={20} height={20} className="h-5 w-5" />
          </span>
          Vesting details
        </Link>
        <Link
          href="/tokenomics"
          className="inline-flex items-center gap-2 rounded-full bg-[#ededea] px-4 py-2 font-inter text-[11px] font-bold uppercase tracking-[0.06em] text-[#0a0a0a] sm:px-5 sm:text-[12px] sm:tracking-[0.1em] transition-transform hover:-translate-y-0.5"
        >
          Tokenomics <span aria-hidden>→</span>
        </Link>
        <AddToWalletButton variant="pill" />
      </div>
    </div>
  );
}

/**
 * `data-hero-ready`/`data-hero-in` are pure CSS (globals.css): a compositor
 * fade-and-rise with nothing to wait for, present on the first server frame.
 */
export function Hero({ schedule, renderedAt }: { schedule: SaleSchedule; renderedAt: number }) {
  return (
    <div
      data-hero-ready=""
      // min-h-svh, never a fixed height: a short viewport must grow to the
      // content, not clip it under the fixed nav (70px mobile, 78px desktop).
      // overflow-hidden stays on the backdrop so overflow shows as a bug.
      className="relative flex min-h-svh flex-col bg-[#0a0a0a] px-4 pb-6 pt-20 sm:px-8 sm:pb-10 sm:pt-28"
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <SmartImage
          priority
          src={cdnUrl("/backgrounds/landing-hero-skyline.webp")}
          alt="The Robin guardian overlooking Robinhood Chain's skyline at night"
          className="h-full w-full object-cover object-[72%_38%]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/85 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-[#0a0a0a]/70" />
      </div>

      <div className="relative z-10 mx-auto my-auto flex w-full max-w-[1320px] flex-col gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
        <div className="min-w-0 flex-1">
          <p
            data-hero-in
            style={{ animationDelay: "0.1s" }}
            className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.26em] text-[#8a8a8a] sm:mb-4 xl:text-[11px]"
          >
            Robinhood Chain <span className="mx-1 text-[#3d3d3d]">{"//"}</span> Trust &amp;
            Intelligence Layer
          </p>

          {/* 32px base: "before you trade." measures 411px at 36px, 2px inside
              the content box at 445. lg is smaller than sm because the column
              narrows when the clock joins it. */}
          <h1
            data-hero-in
            style={{ animationDelay: "0.2s" }}
            className="mb-4 font-cinzel text-[32px] font-black uppercase leading-[0.95] tracking-[0.01em] text-[#ededea] min-[480px]:text-[42px] sm:mb-5 sm:text-[52px] lg:text-[48px] xl:text-[64px]"
          >
            Verify
            <br />
            before you trade.
          </h1>

          <p
            data-hero-in
            style={{ animationDelay: "0.3s" }}
            className="mb-6 max-w-[540px] font-inter text-[13px] leading-relaxed text-[#c7c7c2] sm:mb-7 sm:text-[15px]"
          >
            Scan a token before you buy it, then{" "}
            <Link href="/swap" className="font-semibold text-[#ededea] underline decoration-[#ccff00]/60 underline-offset-4 hover:text-[#ccff00]">
              swap it right here
            </Link>{" "}
            with the verdict in plain sight. Wallets, launches and real-world assets across Robinhood
            Chain, tracked in one place.
          </p>

          <div data-hero-in style={{ animationDelay: "0.4s" }}>
            <HeroScanBar />
          </div>

          <div data-hero-in style={{ animationDelay: "0.5s" }} className="mt-8 sm:mt-9">
            <TokenCard />
          </div>
        </div>

        <div data-hero-in style={{ animationDelay: "0.35s" }} className="flex w-full justify-center lg:w-[420px] lg:flex-none lg:justify-end">
          <SaleClock schedule={schedule} renderedAt={renderedAt} referrals={flags.tokenSale} />
        </div>
      </div>

      {/* Pinned to the hero's end by `mt-auto` inside it: it controls the grid
          in the next section, so the state lives in ProductsRevealProvider. */}
      <HeroRevealTrigger label="Explore all products" />
    </div>
  );
}
