"use client";

import { useState } from "react";

import { CODE_LENGTH, normaliseCode } from "@/lib/referrals/code";
import { shortWallet } from "@/lib/referrals/display";
import type { ApplyPhase, LinkCode, ReferralState } from "@/lib/referrals/useReferral";
import { REFERRAL_STATUS_COPY } from "@/lib/referrals/display";

/**
 * Applying a referral code.
 *
 * The whole screen has one job: make sure a code is in place BEFORE the first
 * contribution, because after it there is no second chance — the binding is
 * frozen the moment the contribution is indexed.
 *
 * A code that arrived through a share link is rendered read-only with no way to
 * clear it. That is deliberate and it is the operator's decision: the person who
 * clicked the link should not be able to mistype away their friend's credit. To
 * use a different code you open the site without the `ref` parameter.
 *
 * A link code we could not verify is a different thing: it fills the field as a
 * starting value and stays editable. See `prefillCode`.
 */
export function ReferralCodeBox({
  state,
  bindWindow,
  linkCode,
  lockedCode,
  prefillCode,
  busy,
  error,
  onApply,
}: {
  state: ReferralState | null;
  /** From `useReferral`. Chain-aware, unlike the mirror's own flag. */
  bindWindow: "open" | "closed" | "unknown";
  linkCode: LinkCode;
  lockedCode: string | null;
  /** An unverified link code: the field's starting value, never locked. */
  prefillCode: string | null;
  busy: ApplyPhase;
  error: string | null;
  onApply: (code: string) => Promise<boolean>;
}) {
  // `null` is UNTOUCHED, not empty. Once the user has typed, their value wins
  // even when it is "" — otherwise clearing the box would resurrect the
  // prefill under their cursor.
  const [typed, setTyped] = useState<string | null>(null);

  // DERIVED, not copied into state by an effect. A locked code IS the field's
  // value, so there is no moment where the box is empty while an effect catches
  // up, and no way for the two to disagree. An unverified link code never gets
  // here: pre-filling a code we could not check would show it as applied when it
  // may not exist.
  const value = lockedCode ?? typed ?? prefillCode ?? "";

  const applied = state?.usedCode ?? null;
  const status = state?.referralStatus ?? "none";
  const copy = REFERRAL_STATUS_COPY[status] ?? REFERRAL_STATUS_COPY.none;

  // Already bound, or frozen by a contribution: this is a statement of fact, not
  // a form. Showing an editable field here would invite an attempt that the
  // server can only refuse.
  //
  // Keyed on an explicitly closed window: the mirror alone cannot see a
  // contribution from the last minute. A window we cannot read still shows the
  // form, because a missed binding is permanent and a redundant one is refused.
  if (applied || bindWindow === "closed") {
    const tone =
      copy.tone === "good"
        ? "border-[#3d5c3d] bg-[#141c14] text-[#8fbf6a]"
        : copy.tone === "bad"
          ? "border-[#8a3a30] bg-[#1c1414] text-[#e0897a]"
          : copy.tone === "warn"
            ? "border-[#5c552d] bg-[#1c1a14] text-[#d9c96a]"
            : "border-[#2a2a2a] bg-[#0a0a0a] text-[#8a8a8a]";
    return (
      <div className={`rounded-2xl border px-4 py-3 ${tone}`}>
        <p className="font-mono text-[10px] tracking-[0.22em]">{copy.label}</p>
        {applied && (
          <p className="mt-1 font-mono text-[15px] tracking-[0.18em] text-[#ededea]">{applied}</p>
        )}
        <p className="mt-2 text-[12px] leading-relaxed opacity-90">{copy.detail}</p>
      </div>
    );
  }

  const candidate = normaliseCode(value);
  const canApply = candidate !== null && busy === "idle";

  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
      <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">REFERRAL CODE</p>
      <p className="mt-1 text-[12px] leading-relaxed text-[#8a8a8a]">
        Add one before your first contribution to earn 2% more tokens. You cannot add it
        later.
      </p>

      {linkCode.kind === "valid" && (
        <p className="mt-3 text-[12px] text-[#8fbf6a]">
          Code from your invite link
          {linkCode.nickname ? (
            <>
              , sent by{" "}
              <span className="text-[#ededea]">{linkCode.emoji ?? ""}{linkCode.nickname}</span>
            </>
          ) : null}
          {/* The address ALWAYS shows with a name (lib/referrals/display.ts).
              Names are not verified; this line is what an impostor's borrowed
              nickname cannot reproduce. */}
          {linkCode.address ? (
            <span className="font-mono text-[#4a4a4a]"> ({shortWallet(linkCode.address)})</span>
          ) : null}
          .
        </p>
      )}
      {linkCode.kind === "unknown" && (
        <p className="mt-3 text-[12px] text-[#e0897a]">
          We do not have the code from your link ({linkCode.code}). Check it with whoever sent it to
          you.
        </p>
      )}
      {linkCode.kind === "uncheckable" && (
        // NOT "invalid". We could not look, and saying otherwise would send
        // someone into a contribution without a code they actually hold.
        <p className="mt-3 text-[12px] text-[#d9c96a]">
          We could not check your code just now. Please try again in a moment, before you
          contribute.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={value}
          readOnly={lockedCode !== null}
          onChange={(e) => setTyped(e.target.value.toUpperCase())}
          maxLength={CODE_LENGTH + 4}
          spellCheck={false}
          autoComplete="off"
          placeholder="ABCD2345"
          aria-label="Referral code"
          className={`min-w-0 flex-1 rounded-xl border px-3 py-3 font-mono text-[15px] tracking-[0.18em] text-[#ededea] outline-none placeholder:text-[#4a4a4a] ${
            lockedCode !== null
              ? "cursor-not-allowed border-[#3d5c3d] bg-[#141c14]"
              : "border-[#2a2a2a] bg-[#141414] focus:border-[#4a4a4a]"
          }`}
        />
        <button
          type="button"
          disabled={!canApply}
          onClick={() => void onApply(value)}
          className="rounded-xl border-2 border-[#ccff00] bg-[#1a1f0a] px-5 py-3 text-[12px] font-bold tracking-[0.14em] text-[#ccff00] transition-colors hover:bg-[#232a0e] disabled:cursor-not-allowed disabled:opacity-30"
        >
          {busy === "checking" ? "CHECKING…" : busy === "signing" ? "SIGNING…" : "APPLY"}
        </button>
      </div>

      {lockedCode !== null && (
        <p className="mt-2 text-[11px] text-[#8a8a8a]">
          This is the code from your invite link. It is locked so it cannot be changed by mistake.
        </p>
      )}
      {value.length > 0 && candidate === null && lockedCode === null && (
        <p className="mt-2 text-[11px] text-[#e0897a]">
          Codes are {CODE_LENGTH} characters long. Check for a typo.
        </p>
      )}
      <p className="mt-2 text-[11px] text-[#8a8a8a]">
        We check the code first. If it is real, your wallet asks you to sign. That costs no gas and
        moves no money. It only proves the wallet is yours.
      </p>
      {error && <p className="mt-2 text-[11px] text-[#e0897a]">{error}</p>}
    </div>
  );
}
