"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { EMOJI_MAX, NICKNAME_MAX, cleanEmoji, cleanNickname, nicknameHasLink } from "@/lib/referrals/profile";
import {
  SOCIALS_MAX,
  SOCIAL_PROVIDERS,
  cleanSocialUrl,
  cleanSocials,
  type Social,
  type SocialProviderId,
} from "@/lib/referrals/socials";
import { SocialGlyph } from "./SocialIcons";
import { shortWallet } from "@/lib/referrals/display";
import type { ReferralState } from "@/lib/referrals/useReferral";

/**
 * The name and emoji shown on the leaderboards.
 *
 * The SAME cleaning functions the server uses run here, so the preview under
 * the field is the row the board will actually render — a client with its own
 * looser rules would show one thing and store another. The server still cleans
 * independently; this is a preview, never the enforcement.
 */
export function ProfileEditor({
  state,
  busy,
  onSave,
}: {
  state: ReferralState;
  busy: boolean;
  onSave: (nickname: string, emoji: string, socials: Social[]) => Promise<boolean>;
}) {
  const [nickname, setNickname] = useState(state.nickname ?? "");
  const [emoji, setEmoji] = useState(state.emoji ?? "");
  const [socials, setSocials] = useState<Social[]>(state.socials ?? []);
  const [socialsOpen, setSocialsOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seeded when the editor OPENS rather than by an effect watching the props.
  // Same outcome without the extra render, and it is the stricter one: a name
  // saved in another tab cannot be overwritten by a draft this form has been
  // holding since before that save.
  const open_ = () => {
    setNickname(state.nickname ?? "");
    setEmoji(state.emoji ?? "");
    setSocials(state.socials ?? []);
    setOpen(true);
  };

  const previewName = cleanNickname(nickname);
  const previewEmoji = cleanEmoji(emoji);
  const nameHasLink = nicknameHasLink(nickname);
  const dirty =
    (previewName ?? "") !== (state.nickname ?? "") ||
    (previewEmoji ?? "") !== (state.emoji ?? "") ||
    JSON.stringify(socials) !== JSON.stringify(state.socials ?? []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={open_}
        className="flex w-full items-center justify-between rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3 text-left transition-colors hover:border-[#4a4a4a]"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[12px] font-bold tracking-[0.22em] text-white">
            HOW YOU APPEAR
          </span>
          <span className="mt-1 flex items-center gap-2 text-[14px] text-[#ededea]">
            <span className="truncate">
              {state.emoji ? `${state.emoji} ` : ""}
              {state.nickname ?? shortWallet(state.wallet)}
            </span>
            {/* A span, not an anchor: this whole card is a button, and a link
                inside a button is invalid and unclickable in some browsers. */}
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[#6f6f6f]">
              {(state.socials ?? []).map((x) => (
                <SocialGlyph key={x.provider} provider={x.provider} className="size-3.5" />
              ))}
            </span>
          </span>
        </span>
        <span className="ml-3 shrink-0 text-[12px] text-[#8a8a8a]">
          {state.nickname ? "Edit" : "Add a name"}
        </span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-4">
      <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">HOW YOU APPEAR</p>
      <div className="mt-3 flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          placeholder="🎩"
          aria-label="Emoji"
          className="w-16 rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 py-3 text-center text-[16px] text-[#ededea] outline-none focus:border-[#4a4a4a]"
        />
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={NICKNAME_MAX * 2}
          placeholder="A name for the leaderboard"
          aria-label="Nickname"
          aria-invalid={nameHasLink}
          className={`min-w-0 flex-1 rounded-xl border bg-[#141414] px-3 py-3 text-[14px] text-[#ededea] outline-none placeholder:text-[#4a4a4a] ${
            nameHasLink ? "border-[#ff4444]/60" : "border-[#2a2a2a] focus:border-[#4a4a4a]"
          }`}
        />
      </div>
      {nameHasLink && (
        <p className="mt-2 text-[11px] text-[#ff6666]">
          Names cannot contain links. Add your socials below instead.
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {socials.length === 0 ? (
            <span className="text-[11px] text-[#8a8a8a]">No socials added</span>
          ) : (
            <span className="inline-flex items-center gap-2 text-[#ededea]">
              {socials.map((x) => (
                <SocialGlyph key={x.provider} provider={x.provider} className="size-4" />
              ))}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSocialsOpen(true)}
          className="shrink-0 rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-[12px] text-[#ededea] transition-colors hover:border-[#4a4a4a]"
        >
          {socials.length === 0 ? "+ Add social" : "Edit socials"}
        </button>
      </div>
      {socialsOpen && (
        <SocialsModal
          initial={socials}
          onCancel={() => setSocialsOpen(false)}
          onDone={(next) => {
            setSocials(next);
            setSocialsOpen(false);
          }}
        />
      )}

      <p className="mt-2 text-[11px] text-[#8a8a8a]">
        Shown as{" "}
        <span className="text-[#ededea]">
          {previewEmoji ? `${previewEmoji} ` : ""}
          {previewName ?? shortWallet(state.wallet)}
        </span>
        {previewName && <span className="text-[#4a4a4a]"> · {shortWallet(state.wallet)}</span>}
      </p>
      <p className="mt-1 text-[11px] text-[#8a8a8a]">
        Up to {NICKNAME_MAX} characters and {EMOJI_MAX} emoji. Up to {SOCIALS_MAX} socials, shown as icons. Your address is always shown next to your
        name. Names are not unique and we do not check them, so the address is what identifies you.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || !dirty || nameHasLink}
          onClick={async () => {
            const ok = await onSave(nickname, emoji, socials);
            if (ok) {
              setSaved(true);
              setTimeout(() => setSaved(false), 1800);
              setOpen(false);
            }
          }}
          className="rounded-xl border border-[#4a4a4a] bg-[#141414] px-5 py-2 text-[12px] tracking-[0.1em] text-[#ededea] transition-colors hover:border-[#8a8a8a] disabled:opacity-30"
        >
          {busy ? "Signing…" : saved ? "Saved" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl px-4 py-2 text-[12px] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
        >
          Cancel
        </button>
      </div>
      <p className="mt-2 text-[11px] text-[#8a8a8a]">
        Saving asks your wallet to sign. No gas, and no money moves.
      </p>
    </div>
  );
}

interface Draft {
  provider: SocialProviderId;
  url: string;
}

/**
 * Provider and link, one row per social, plus to add the next.
 *
 * Nothing is stored here. "Done" hands the cleaned list back to the editor and
 * the wallet signs it with the rest of the profile on Save.
 */
function SocialsModal({
  initial,
  onCancel,
  onDone,
}: {
  initial: Social[];
  onCancel: () => void;
  onDone: (next: Social[]) => void;
}) {
  const [rows, setRows] = useState<Draft[]>(
    initial.length > 0 ? initial.map((x) => ({ ...x })) : [{ provider: "x", url: "" }],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onCancel]);

  const filled = rows.filter((r) => r.url.trim() !== "");
  const errors = rows.map((r, i) => {
    if (r.url.trim() === "") return null;
    if (cleanSocialUrl(r.provider, r.url) === null) return "That is not a profile link for this platform.";
    if (rows.findIndex((o) => o.provider === r.provider && o.url.trim() !== "") !== i)
      return "One link per platform.";
    return null;
  });
  const valid = errors.every((e) => e === null);
  const patch = (i: number, p: Partial<Draft>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add socials"
        className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#0a0a0a] p-5 shadow-2xl"
      >
        <p className="font-mono text-[12px] font-bold tracking-[0.22em] text-white">ADD SOCIALS</p>
        <p className="mt-1 text-[11px] text-[#8a8a8a]">
          Up to {SOCIALS_MAX}. The leaderboard shows icons only.
        </p>

        <div className="mt-4 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]">
          <span>PROVIDER</span>
          <span>LINK</span>
        </div>
        <ul className="mt-1.5 flex list-none flex-col gap-2 p-0">
          {rows.map((r, i) => (
            <li key={i}>
              <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2">
                <select
                  value={r.provider}
                  onChange={(e) => patch(i, { provider: e.target.value as SocialProviderId })}
                  aria-label="Provider"
                  className="rounded-xl border border-[#2a2a2a] bg-[#141414] px-2 py-2.5 text-[13px] text-[#ededea] outline-none focus:border-[#4a4a4a]"
                >
                  {SOCIAL_PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    value={r.url}
                    onChange={(e) => patch(i, { url: e.target.value })}
                    placeholder="Profile link"
                    aria-label="Link"
                    aria-invalid={errors[i] !== null}
                    className={`min-w-0 flex-1 rounded-xl border bg-[#141414] px-3 py-2.5 text-[13px] text-[#ededea] outline-none placeholder:text-[#4a4a4a] ${
                      errors[i] ? "border-[#ff4444]/60" : "border-[#2a2a2a] focus:border-[#4a4a4a]"
                    }`}
                  />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      aria-label="Remove this social"
                      className="shrink-0 rounded-xl px-2 text-[16px] text-[#6f6f6f] transition-colors hover:text-[#ff6666]"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
              {errors[i] && <p className="mt-1 text-[11px] text-[#ff6666]">{errors[i]}</p>}
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={rows.length >= SOCIALS_MAX}
          onClick={() => {
            const used = new Set(rows.map((r) => r.provider));
            const next = SOCIAL_PROVIDERS.find((p) => !used.has(p.id))?.id ?? "x";
            setRows((rs) => [...rs, { provider: next, url: "" }]);
          }}
          className="mt-3 inline-flex items-center gap-2 rounded-xl border border-dashed border-[#3a3a3a] px-3 py-2 text-[12px] text-[#ededea] transition-colors hover:border-[#8a8a8a] disabled:opacity-30"
        >
          <span aria-hidden className="text-[16px] leading-none">+</span>
          {rows.length >= SOCIALS_MAX ? `Max ${SOCIALS_MAX} socials` : "Add another"}
        </button>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl px-4 py-2 text-[12px] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onDone(cleanSocials(filled))}
            className="rounded-xl border border-[#4a4a4a] bg-[#141414] px-5 py-2 text-[12px] tracking-[0.1em] text-[#ededea] transition-colors hover:border-[#8a8a8a] disabled:opacity-30"
          >
            Done
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[#8a8a8a]">Nothing is saved until you press Save on your profile.</p>
      </div>
    </div>,
    document.body,
  );
}
