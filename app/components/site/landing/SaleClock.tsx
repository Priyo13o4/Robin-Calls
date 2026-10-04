"use client";

import Link from "next/link";
import { Gift } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { COMMISSION_BPS } from "@/lib/referrals/rules";
import { reconcilePhase, remaining, type ContractPhase, type SaleSchedule } from "@/lib/sale/schedule-clock";
import { TOKENOMICS } from "@/lib/sale/tokenomics";

const HOLDER_DROP_PCT = TOKENOMICS.flatMap((r) => r.breakdown ?? []).find((b) => b.label === "TOKEN HOLDER AIRDROP")?.pct;

// Same source as /token-sale's referral panel, so the two cannot disagree.
const REFERRAL_LINES = [
  { big: `+${COMMISSION_BPS.buyerBonus / 100}%`, text: "more tokens when you buy with someone's code" },
  { big: `${COMMISSION_BPS.referrerTokens / 100}%`, text: "of the tokens your referrals buy, once you qualify" },
  { big: `${COMMISSION_BPS.referrerEth / 100}%`, text: "of the ETH they put in, paid to you in ETH" },
  // The split's own row, so a change to the airdrop can never leave this line behind.
  ...(HOLDER_DROP_PCT ? [{ big: `${HOLDER_DROP_PCT}%`, text: "of the supply airdropped to token holders after the sale" }] : []),
];

const fmtUtc = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  }) + " UTC";

function Half({ top, children, className = "", onAnimationEnd }: { top: boolean; children: ReactNode; className?: string; onAnimationEnd?: () => void }) {
  return (
    <span
      onAnimationEnd={onAnimationEnd}
      className={`absolute inset-x-0 h-1/2 overflow-hidden [backface-visibility:hidden] ${
        top ? "top-0 origin-bottom rounded-t-[inherit] bg-[#1b1b1b]" : "bottom-0 origin-top rounded-b-[inherit] bg-[#151515]"
      } ${className}`}
    >
      <span className={`absolute inset-x-0 flex h-[200%] items-center justify-center ${top ? "top-0" : "bottom-0"}`}>{children}</span>
    </span>
  );
}

/** One split-flap tile. The flap pair is keyed on the new value so each change replays it. */
function FlipDigit({ value }: { value: string }) {
  const [cur, setCur] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== cur) {
    setPrev(cur);
    setCur(value);
  }
  const flipping = prev !== cur;
  return (
    <span className="relative inline-block h-[58px] w-[40px] rounded-[9px] font-inter text-[38px] font-bold tabular-nums text-[#ededea] shadow-[0_10px_24px_-10px_rgba(0,0,0,0.9)] [perspective:260px] sm:h-[72px] sm:w-[50px] sm:text-[48px]">
      <Half top>{cur}</Half>
      <Half top={false}>{flipping ? prev : cur}</Half>
      {flipping && (
        <>
          <Half key={`t${cur}`} top className="rc-flap-top z-10">{prev}</Half>
          <Half
            key={`b${cur}`}
            top={false}
            className="rc-flap-bottom z-10"
            onAnimationEnd={() => setPrev(cur)}
          >
            {cur}
          </Half>
        </>
      )}
      <span aria-hidden className="absolute inset-x-0 top-1/2 z-20 h-px -translate-y-1/2 bg-black/80" />
    </span>
  );
}

function Unit({ digits, label }: { digits: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex gap-1">
        {[...digits].map((d, i) => <FlipDigit key={i} value={d} />)}
      </div>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.24em] text-[#8a8a8a]">{label}</span>
    </div>
  );
}

const Colon = () => <span aria-hidden className="pb-6 font-inter text-[28px] font-bold text-[#3d3d3d] sm:text-[34px]">:</span>;

export function SaleClock({
  schedule,
  renderedAt,
  referrals,
  contract,
  onSalePage = false,
}: {
  schedule: SaleSchedule;
  renderedAt: number;
  referrals: boolean;
  /** The sale contract's own state, when the caller has read it. */
  contract?: ContractPhase;
  /** On /token-sale itself: no link back to the page the visitor is on. */
  onSalePage?: boolean;
}) {
  // First render uses the server's clock so hydration matches; the tick then
  // corrects it, and any difference flips in rather than jumping.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, []);

  const phase = reconcilePhase(schedule, now, contract);
  const r = phase.kind === "starts" || phase.kind === "ends" ? remaining(phase.at, now) : null;
  // "—" is the §4 placeholder: the schedule could not be read. "--" is a real "no date yet".
  const blank = phase.kind === "unknown" ? "—" : "-";
  const pad = (n: number | undefined) => (n === undefined ? blank + blank : String(n).padStart(2, "0"));
  const heading = {
    unknown: "Sale schedule",
    tba: "Starts in",
    starts: "Starts in",
    ends: "Ends in",
    live: "Sale is live",
    ended: contract === "cancelled" ? "Sale was cancelled" : "Sale has ended",
  }[phase.kind];
  const dateLine =
    phase.kind === "starts" ? `Opens ${fmtUtc(phase.at)}`
    : phase.kind === "ends" ? `Closes ${fmtUtc(phase.at)}`
    : phase.kind === "tba" ? "Date announced soon"
    : phase.kind === "unknown" ? "Could not load the schedule"
    : phase.kind === "ended" ? (contract === "cancelled" ? "Refunds are open" : onSalePage ? "Claims are open below" : "Claims open on the sale page")
    : "No closing time set yet";
  const live = phase.kind === "ends" || phase.kind === "live";

  return (
    <div className="relative w-full max-w-[420px] overflow-hidden rounded-3xl border border-white/10 bg-[#0b0b0b]/80 p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-7">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-60 w-60 rounded-full bg-[#ccff00]/[0.08] blur-[70px]" />

      <p className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-[#8a8a8a]">
        <span className="relative flex h-1.5 w-1.5">
          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#ccff00] opacity-70" />}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${live ? "bg-[#ccff00]" : "bg-[#5a5a5a]"}`} />
        </span>
        $ROBINCALLS · One price for all
      </p>
      {!onSalePage && (
        <h2 className="mt-3 font-cinzel text-[24px] font-black uppercase leading-[1.05] text-[#ededea] sm:text-[28px]">
          Fair launch
          <br />
          <span className="text-[#ccff00]">token sale</span>
        </h2>
      )}

      <p className={`${onSalePage ? "mt-5" : "mt-6"} text-center font-mono text-[11px] font-bold uppercase tracking-[0.28em] text-[#ededea]`}>{heading}</p>

      <div role="timer" aria-label={r ? `${heading} ${r.days}d ${r.hours}h ${r.minutes}m` : heading} className="mt-3 flex items-start justify-center gap-2 sm:gap-3">
        <Unit digits={pad(r?.days)} label="Days" />
        <Colon />
        <Unit digits={pad(r?.hours)} label="Hours" />
        <Colon />
        <Unit digits={pad(r?.minutes)} label="Mins" />
      </div>
      <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-[#6f6f6f]">{dateLine}</p>

      {!onSalePage && (live || phase.kind === "ended") && (
        <Link
          href="/token-sale"
          className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-[#ccff00] py-3 font-inter text-[12px] font-bold uppercase tracking-[0.14em] text-[#0a0a0a] shadow-[0_0_36px_-10px_rgba(204,255,0,0.7)] transition-transform hover:-translate-y-0.5"
        >
          {live ? "Join the sale" : "Claim your tokens"} →
        </Link>
      )}

      {referrals && phase.kind !== "ended" && (
        <div className="mt-5 rounded-2xl border border-[#ccff00]/20 bg-[#ccff00]/[0.04] p-4">
          <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#ccff00]">
            <Gift className="size-3.5" aria-hidden />
            Earn from referrals in the presale
          </p>
          <ul className="mt-3 space-y-2">
            {REFERRAL_LINES.map((l) => (
              <li key={l.text} className="flex items-baseline gap-3">
                <span className="w-9 flex-none font-inter text-[15px] font-bold tabular-nums text-white">{l.big}</span>
                <span className="font-inter text-[12.5px] leading-snug text-white">{l.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-center">
            <Link
              href="/token-sale#referrals"
              className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light flex-none whitespace-nowrap border-[#ccff00] bg-[#ccff00] px-4 py-2.5 font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]"
            >
              Join now →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
