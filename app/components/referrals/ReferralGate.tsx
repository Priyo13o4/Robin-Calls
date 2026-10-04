"use client";

import { useState } from "react";

import { ReferralCodeBox } from "./ReferralCodeBox";
import type { ApplyPhase, LinkCode, ReferralState } from "@/lib/referrals/useReferral";

/**
 * The two-step prompt that stands between a wallet's FIRST contribution and the
 * chain, when no referral code has been applied.
 *
 * It exists because the decision is irreversible in one direction only: a code
 * applied first can still be replaced right up to the contribution, but a
 * contribution made first can never gain a code. So the cost of asking is one
 * extra click, and the cost of not asking is somebody permanently locked out of
 * the buyer bonus who did not know it was on offer.
 *
 * It only ever appears once per wallet — the caller opens it only while the
 * binding window is known to be open — and never for a top-up.
 *
 * The CALLER mounts and unmounts it rather than passing an `open` flag, so the
 * step below resets by being a fresh component. With a flag and an early
 * return, dismissing on the red screen and reopening dropped the user straight
 * back onto a confirmation for a decision they never made.
 */
export function ReferralGate({
  state,
  bindWindow,
  linkCode,
  lockedCode,
  prefillCode,
  busy,
  error,
  onApply,
  onDismiss,
  onProceed,
}: {
  state: ReferralState | null;
  /** Threaded through rather than assumed "open": the caller's mount condition
   *  and the box's own rendering must not be able to disagree (§8 #11). */
  bindWindow: "open" | "closed" | "unknown";
  linkCode: LinkCode;
  lockedCode: string | null;
  prefillCode: string | null;
  busy: ApplyPhase;
  error: string | null;
  onApply: (code: string) => Promise<boolean>;
  /** Closed without a decision — the contribution does NOT go ahead. */
  onDismiss: () => void;
  /** Confirmed twice: send the contribution with no code. */
  onProceed: () => void;
}) {
  const [step, setStep] = useState<"ask" | "confirm">("ask");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-5 shadow-2xl">
        {step === "ask" ? (
          <>
            <p className="font-mono text-[10px] tracking-[0.22em] text-[#ccff00]">BEFORE YOU CONTRIBUTE</p>
            <h2 className="mt-2 text-[19px] font-semibold text-[#ededea]">Have a referral code?</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[#8a8a8a]">
              Adding one now earns this wallet 2% more tokens than it buys. You have to do it before
              your first contribution. You cannot add it later.
            </p>

            <div className="mt-4">
              <ReferralCodeBox
                state={state}
                bindWindow={bindWindow}
                linkCode={linkCode}
                lockedCode={lockedCode}
                prefillCode={prefillCode}
                busy={busy}
                error={error}
                onApply={onApply}
              />
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={onDismiss}
                className="rounded-2xl border border-[#4a4a4a] px-5 py-3 text-[12px] tracking-[0.12em] text-[#ededea] transition-colors hover:border-[#8a8a8a]"
              >
                I HAVE A CODE, LET ME FINISH
              </button>
              <button
                type="button"
                onClick={() => setStep("confirm")}
                className="rounded-2xl px-5 py-3 text-[12px] tracking-[0.12em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
              >
                CONTINUE WITHOUT A CODE
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-2xl border-2 border-[#8a3a30] bg-[#1c1414] p-4">
              <p className="font-mono text-[10px] tracking-[0.22em] text-[#e0897a]">
                THIS CANNOT BE UNDONE
              </p>
              <h2 className="mt-2 text-[19px] font-semibold text-[#ededea]">
                Contribute without a referral code?
              </h2>
              {/* Says what is lost and what is NOT, so nobody reads this as a
                  threat to their contribution or their tokens. */}
              <p className="mt-2 text-[13px] leading-relaxed text-[#e0897a]">
                Your contribution and your tokens are not affected. What you give up is the 2% bonus
                on top of them. Once this contribution is on chain, this wallet can never earn that
                bonus, not on this contribution and not on any later one.
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-[#8a8a8a]">
                You can still share your own code afterwards and earn the referrer commission.
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setStep("ask")}
                className="rounded-2xl border-2 border-[#ccff00] bg-[#1a1f0a] px-5 py-3 text-[12px] font-bold tracking-[0.12em] text-[#ccff00] transition-colors hover:bg-[#232a0e]"
              >
                GO BACK AND ADD A CODE
              </button>
              <button
                type="button"
                onClick={onProceed}
                className="rounded-2xl px-5 py-3 text-[12px] tracking-[0.12em] text-[#8a8a8a] transition-colors hover:text-[#e0897a]"
              >
                CONTINUE ANYWAY
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
