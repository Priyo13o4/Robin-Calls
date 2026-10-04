"use client";

import Link from "next/link";

import { SkeletonReferralPanel } from "@/app/components/site/Skeleton";
import { ProfileEditor } from "./ProfileEditor";
import { ReferralCodeBox } from "./ReferralCodeBox";
import { ReferralShareCard } from "./ReferralShareCard";
import type { useReferral } from "@/lib/referrals/useReferral";

/**
 * The referral block on the sale page. Composition only — every piece it shows
 * is its own component, and the state comes from `useReferral` in the page.
 *
 * Order is deliberate: identity, then the code you were given, then the code you
 * give out. Someone arriving from a share link should meet the field their link
 * filled before anything asks them to share their own.
 */
export function ReferralPanel({
  referral,
  connected,
}: {
  referral: ReturnType<typeof useReferral>;
  connected: boolean;
}) {
  const {
    status,
    state,
    bindWindow,
    linkCode,
    lockedCode,
    prefillCode,
    busy,
    applyPhase,
    error,
    bind,
    saveProfile,
  } = referral;

  if (!connected) {
    return (
      <div className="rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-5">
        <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">REFERRALS</p>
        <p className="mt-2 text-[13px] leading-relaxed text-[#8a8a8a]">
          Connect a wallet to add a referral code, pick a name, and get a code of your own.
        </p>
        {linkCode.kind === "valid" && (
          <p className="mt-2 text-[13px] text-[#8fbf6a]">
            Your invite code {linkCode.code} is ready. We will fill it in for you.
          </p>
        )}
      </div>
    );
  }

  // "loading" is the first fetch, not a failure. Saying "we could not load your
  // referral status" before we have asked once publishes a fault that has not
  // happened (§4).
  if (status === "loading" || status === "idle") {
    // Shape only. Rendering the real panel here would show the bind prompt
    // ("add a code before your first contribution") to a wallet that has
    // already contributed, because the answer to that has not arrived yet.
    return <SkeletonReferralPanel />;
  }

  if (status === "error" || !state) {
    return (
      <div className="rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-5">
        <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">REFERRALS</p>
        <p className="mt-2 text-[13px] text-[#d9c96a]">
          We could not load your referral details. Your contribution still works as normal. But if you
          have a code to add, please wait for this to load before you contribute.
        </p>
        <button
          type="button"
          onClick={() => void referral.refresh()}
          className="mt-3 rounded-xl border border-[#4a4a4a] px-4 py-2 text-[12px] text-[#ededea] transition-colors hover:border-[#8a8a8a]"
        >
          Try again
        </button>
      </div>
    );
  }

  // The third state. A pending claim means the browser POSTed a receipt we
  // have not verified against the chain yet, so the wallet's binding window is
  // almost certainly closed and the panel must say so rather than invite a
  // binding the freeze will refuse. It renders INSTEAD of the code box, so
  // there is no field to type into while it shows.
  if (state.contributionState === "confirming") {
    return (
      <div className="rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-5">
        <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">REFERRALS</p>
        <p className="mt-2 text-[13px] leading-relaxed text-[#d9c96a]">
          Your contribution is confirmed on chain. Your referral code will appear here shortly.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-[#8a8a8a]">
          We check every contribution against the contract itself before handing out a code. That
          usually takes under a minute. You do not need to stay on this page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border-2 border-[#2a2a2a] bg-[#141414] p-5">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">REFERRALS</p>
        <Link
          href="/leaderboard"
          className="font-mono text-[10px] tracking-[0.14em] text-[#ccff00] underline underline-offset-4"
        >
          LEADERBOARD
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <ProfileEditor state={state} busy={busy === "profile"} onSave={saveProfile} />
        <ReferralCodeBox
          state={state}
          bindWindow={bindWindow}
          linkCode={linkCode}
          lockedCode={lockedCode}
          prefillCode={prefillCode}
          busy={applyPhase}
          error={error}
          onApply={bind}
        />
        <ReferralShareCard state={state} />
      </div>
    </div>
  );
}
