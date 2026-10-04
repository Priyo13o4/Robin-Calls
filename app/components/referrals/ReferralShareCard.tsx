"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEther } from "viem";
import { Copy, Check } from "lucide-react";

import { referralLink } from "@/lib/referrals/code";
import { formatEth } from "@/lib/referrals/display";
import { COMMISSION_BPS } from "@/lib/referrals/rules";
import { TOKEN_SYMBOL } from "@/lib/sale/token";
import type { ReferralState } from "@/lib/referrals/useReferral";

/**
 * A wallet's own code, its share link, and how far it is from the two gates on
 * the referrer commission.
 *
 * The progress bars are a LIVE reading, labelled as one. Eligibility is settled
 * at the close of the sale and nowhere else, so this card never says "you have
 * qualified" — a referrer above the bar today can be below it tomorrow if a
 * referred wallet's contribution is still settling, and a page that promised
 * otherwise would be publishing a guarantee nobody made.
 */
export function ReferralShareCard({ state }: { state: ReferralState }) {
  const [copied, setCopied] = useState<null | "code" | "link">(null);
  const [origin, setOrigin] = useState("");

  // Read in the browser: the link has to carry whatever host the visitor is
  // actually on, and a server-rendered origin would hand a testnet visitor a
  // production link.
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const copy = useCallback(async (what: "code" | "link", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard is blocked in some embedded browsers. The value is on screen
      // and selectable, so there is nothing to recover from and nothing to say.
    }
  }, []);

  if (!state.myCode) {
    return (
      <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3">
        <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">YOUR REFERRAL CODE</p>
        <p className="mt-2 text-[12px] leading-relaxed text-[#8a8a8a]">
          You get your code with your first contribution. Contribute once and it shows up here, ready
          to share.
        </p>
      </div>
    );
  }

  const link = origin ? referralLink(origin, state.myCode) : "";
  const referredWei = BigInt(state.referredWei);
  const minWei = BigInt(state.rules.minReferredWei);
  const peoplePct = Math.min(100, (state.referredCount / Math.max(1, state.rules.minReferredWallets)) * 100);
  const ethPct = minWei === 0n ? 100 : Math.min(100, Number((referredWei * 100n) / minWei));

  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
      <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">YOUR REFERRAL CODE</p>

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="font-mono text-[22px] tracking-[0.24em] text-[#ccff00]">{state.myCode}</p>
        <button
          type="button"
          onClick={() => void copy("code", state.myCode ?? "")}
          title="Copy referral code"
          aria-label="Copy referral code"
          className="flex size-8 flex-none items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#141414] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
        >
          {copied === "code" ? (
            <Check className="size-3.5 text-[#ccff00]" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 py-2 font-mono text-[11px] text-[#8a8a8a]">
          {link || "…"}
        </p>
        <button
          type="button"
          disabled={!link}
          onClick={() => void copy("link", link)}
          title="Copy referral link"
          aria-label="Copy referral link"
          className="flex size-8 flex-none items-center justify-center rounded-lg border border-[#2a2a2a] bg-[#141414] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-30"
        >
          {copied === "link" ? (
            <Check className="size-3.5 text-[#ccff00]" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      </div>
      <a
        href={link ? `https://x.com/intent/post?text=${encodeURIComponent(`I'm in the $${TOKEN_SYMBOL} fair launch on Robinhood Chain. Use my code ${state.myCode} for ${COMMISSION_BPS.buyerBonus / 100}% more tokens:`)}&url=${encodeURIComponent(link)}` : undefined}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={!link}
        className={`mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-2.5 text-[13px] font-bold text-black transition-opacity hover:opacity-90 ${link ? "" : "pointer-events-none opacity-30"}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-3.5" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Share on X
      </a>
      <p className="mt-2 text-[11px] leading-relaxed text-[#8a8a8a]">
        Anyone who opens this link gets your code filled in and locked, so they cannot type it wrong.
      </p>

      <div className="mt-4 h-px bg-white/[0.07]" />

      <p className="mt-3 font-mono text-[12px] font-bold tracking-[0.22em] text-white">
        PEOPLE YOU BROUGHT IN
      </p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <Gauge
          label="People who used your code"
          value={`${state.referredCount}`}
          target={`${state.rules.minReferredWallets} needed`}
          pct={peoplePct}
        />
        <Gauge
          label="What they put in"
          value={`${formatEth(referredWei)} ETH`}
          target={`${formatEther(minWei)} ETH needed`}
          pct={ethPct}
        />
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[#8a8a8a]">
        {/* No "share of" anywhere: there is no pool left to take a share of, and
            saying so implies other referrers dilute you. What you earn depends
            only on what your own people bought (docs/prds/TOKEN-SALE-INTENT.md §10.2). */}
        {state.qualifiesNow
          ? `Both bars are full right now. Rewards are worked out when the sale closes: ${COMMISSION_BPS.referrerTokens / 100}% of the tokens your people receive, plus ${COMMISSION_BPS.referrerEth / 100}% of the ETH they put in.`
          : `Fill both bars and you earn ${COMMISSION_BPS.referrerTokens / 100}% of the tokens your people receive, plus ${COMMISSION_BPS.referrerEth / 100}% of the ETH they put in. Nobody else's referrals change your number. Only people who added your code before their first contribution count.`}
      </p>
      {state.mirrorUpdatedAt !== null && isStaleMirror(state.mirrorUpdatedAt) && (
        // The numbers above are summed from the contract's own census as of
        // the reconciler's last pass. When that pass is old, a contribution
        // that has genuinely happened is not in them yet — the page says so
        // rather than showing a total that looks wrong to the person who
        // just referred someone.
        <p className="mt-2 text-[11px] text-[#d9c96a]">
          These numbers are from {mirrorAgeLabel(state.mirrorUpdatedAt)}. A contribution from the
          last few minutes may not be counted yet.
        </p>
      )}
    </div>
  );
}

function Gauge({ label, value, target, pct }: { label: string; value: string; target: string; pct: number }) {
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] p-3">
      <p className="text-[11px] text-[#8a8a8a]">{label}</p>
      <p className="mt-1 text-[17px] font-semibold text-[#ededea]">{value}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#2a2a2a]">
        <div className="h-full rounded-full bg-[#ccff00]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-[#4a4a4a]">{target}</p>
    </div>
  );
}

/** The mirror is stale once its last pass is older than two reconciler cycles. */
function isStaleMirror(updatedAtIso: string): boolean {
  const t = Date.parse(updatedAtIso);
  if (!Number.isFinite(t)) return false; // unparseable says nothing; do not warn
  return Date.now() - t > 120_000;
}

/** "3 minutes ago" shaped labels, never a timestamp the reader must parse. */
function mirrorAgeLabel(updatedAtIso: string): string {
  const t = Date.parse(updatedAtIso);
  if (!Number.isFinite(t)) return "an earlier check";
  const mins = Math.max(1, Math.round((Date.now() - t) / 60_000));
  return mins === 1 ? "a minute ago" : `${mins} minutes ago`;
}
