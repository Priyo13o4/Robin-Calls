"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { REFERRAL_QUERY_PARAM, normaliseCode } from "./code";
import { bindWindowState } from "./rules";
import { socialsSigned, type Social } from "./socials";
import { referralMessage, type ReferralAction } from "./proof";
import { toast, ONE_SHOT_MS } from "@/components/ui/use-toast";

/**
 * The client half of the referral surface (docs/prds/REFERRALS.md).
 *
 * Owns three things and nothing else — rendering lives in the components:
 *   1. this wallet's referral state, refetched when the wallet changes
 *   2. the code carried in `?ref=`, validated against the database before it is
 *      ever shown as applied
 *   3. the two signed writes
 *
 * THREE load states, not two (§4 at the presentation layer). "we have not asked
 * yet" is not "we asked and it failed", and a panel that says "couldn't load
 * your code" on first paint, before its own first request, has published a
 * fault that never happened.
 */

export type ReferralStatus = "none" | "pending" | "credited" | "missed";

/** The server's mirror answer, three states. The chain's own read
 *  (`contributedOnChain`) still outranks it for the bind window — our mirror
 *  can lag a contribution the contract already counts. */
export type ContributionState = "none" | "confirming" | "confirmed";

export interface ReferralState {
  wallet: string;
  nickname: string | null;
  emoji: string | null;
  socials: Social[];
  /** This wallet's own code. Null until its first contribution is confirmed. */
  myCode: string | null;
  usedCode: string | null;
  referralStatus: ReferralStatus;
  /** False once a contribution is on chain — the binding is frozen from then. */
  canBind: boolean;
  /** The MIRROR's contribution answer. "confirming" is the third state the
   *  panel renders instead of a bind prompt. */
  contributionState: ContributionState;
  contributedWei: string;
  referredCount: number;
  referredWei: string;
  /** A reading of RIGHT NOW, never a promise. Settled only at the close. */
  qualifiesNow: boolean;
  rules: { minReferredWallets: number; minReferredWei: string };
  /** When the reconciler last refreshed the census totals, ISO. Null = the
   *  mirror has never run or could not be read. */
  mirrorUpdatedAt: string | null;
}

/** The code a share link carried, once we know whether it is real. */
export type LinkCode =
  | { kind: "none" }
  | { kind: "checking"; code: string }
  | {
      kind: "valid";
      code: string;
      nickname: string | null;
      emoji: string | null;
      /** The code owner's address. Always rendered next to the nickname — names
       *  are not verified, and the invite confirmation is where a borrowed name
       *  would otherwise be trusted with nothing to check it against. */
      address: string;
    }
  | { kind: "unknown"; code: string }
  /** We could not check. NOT "unknown" — telling someone their friend's real
   *  code is fake makes them contribute without it, and there is no second
   *  chance after the first contribution. */
  | { kind: "uncheckable"; code: string };

interface SignFn {
  (message: string): Promise<string | null>;
}

/** What the APPLY button is doing. "checking" is the free question we ask the
 *  server before the wallet prompt; "signing" is the prompt itself. */
export type ApplyPhase = "idle" | "checking" | "signing";

/**
 * Is this code real, and whose? TWO callers, and both matter: the `?ref=` check
 * on mount, and the pre-check that stands in front of the wallet prompt. Before
 * the second one existed a typo cost a signature and came back refused.
 *
 * Three answers, never two (§4). A 503 is a fact about US, and calling it
 * "unknown" tells someone holding a real code that it is fake.
 */
async function fetchCode(code: string): Promise<LinkCode> {
  try {
    const res = await fetch(`/api/referrals/code?code=${code}`, { cache: "no-store" });
    if (!res.ok) return { kind: "uncheckable", code };
    const body = (await res.json()) as {
      valid: boolean;
      referrer?: { nickname: string | null; emoji: string | null; address?: string };
    };
    return body.valid
      ? {
          kind: "valid",
          code,
          nickname: body.referrer?.nickname ?? null,
          emoji: body.referrer?.emoji ?? null,
          address: body.referrer?.address ?? "",
        }
      : { kind: "unknown", code };
  } catch {
    return { kind: "uncheckable", code };
  }
}

/** The server's own sentence for a code it does not hold, so the pre-check and
 *  the bind refusal cannot drift into saying two different things. */
const UNKNOWN_CODE_SENTENCE = "We do not have that code. Please check it and try again.";

export function useReferral(opts: {
  walletAddress: string | null;
  sign: SignFn;
  /**
   * The CONTRACT's answer to "has this wallet contributed", straight off chain.
   * `undefined` is unread, never zero (§4). Our mirror runs a minute behind the
   * chain, so it can confirm a binding is closed but can never confirm one is
   * still open — only this can.
   */
  contributedOnChain: bigint | undefined;
}) {
  const { walletAddress, sign, contributedOnChain } = opts;

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [state, setState] = useState<ReferralState | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCode>({ kind: "none" });
  const [busy, setBusy] = useState<null | "checking" | "bind" | "profile">(null);
  const [error, setError] = useState<string | null>(null);

  /** One in-flight refresh at a time; a skipped tick loses nothing (§5). */
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!walletAddress) {
      setState(null);
      setStatus("idle");
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const res = await fetch(`/api/referrals?wallet=${walletAddress}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setState((await res.json()) as ReferralState);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [walletAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * The link code, read once on mount.
   *
   * `window.location` rather than `useSearchParams` on purpose: the hook needs
   * no Suspense boundary this way, and the value is only ever read in the
   * browser. It is deliberately NOT re-read — the code is fixed for the life of
   * the page, which is what makes the locked field trustworthy.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get(REFERRAL_QUERY_PARAM);
    const code = normaliseCode(raw);
    if (!code) return;

    let cancelled = false;
    setLinkCode({ kind: "checking", code });
    void (async () => {
      const checked = await fetchCode(code);
      if (!cancelled) setLinkCode(checked);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A code that arrived by link is FIXED for this page. The field renders it
   * read-only and offers no way to clear it: the point of a share link is that
   * the person who clicked it cannot mistype away their friend's credit. To use
   * a different code they open the site without the `ref` parameter.
   *
   * A link code we could not verify does not lock anything — locking the field
   * to a code we cannot confirm would be worse than not filling it at all.
   */
  const lockedCode = useMemo(
    () => (linkCode.kind === "valid" || linkCode.kind === "checking" ? linkCode.code : null),
    [linkCode],
  );

  /**
   * A link code we did NOT verify, offered as the field's starting value and
   * nothing more.
   *
   * It does not lock, because we cannot vouch for it. It does not vanish
   * either: the field's value used to be the locked code alone, so a code that
   * came back `uncheckable` emptied the box at the exact moment we told the
   * user we could not check it, leaving them to retype from memory a code they
   * arrived holding. The fault was ours and the loss is permanent after the
   * first contribution (§4).
   */
  const prefillCode = useMemo(
    () => (linkCode.kind === "unknown" || linkCode.kind === "uncheckable" ? linkCode.code : null),
    [linkCode],
  );

  /** Chain-aware, three-state. The reasoning lives on `bindWindowState`. */
  const bindWindow = useMemo(
    () =>
      bindWindowState({
        mirrorSaysOpen: status === "ready" && state !== null ? state.canBind : null,
        contributedOnChain,
      }),
    [status, state, contributedOnChain],
  );

  const signed = useCallback(
    async (action: ReferralAction, endpoint: string, payload: Record<string, unknown>) => {
      if (!walletAddress) return false;
      const issuedAt = new Date().toISOString();
      const signature = await sign(referralMessage(walletAddress.toLowerCase(), action, issuedAt));
      // Null is a rejected or dismissed wallet prompt. The wallet layer already
      // surfaces its own message, so adding one here would show two.
      if (!signature) return false;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, wallet: walletAddress.toLowerCase(), issuedAt, signature }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (!res.ok) {
        setError(body.error ?? "That did not go through. Please try again.");
        if (body.reason === "rpc-unavailable") {
          toast({
            variant: "warning",
            title: "RPC unavailable",
            description: "Your code was not applied. Please try again in a moment.",
            duration: ONE_SHOT_MS,
          });
        }
        return false;
      }
      return true;
    },
    [walletAddress, sign],
  );

  const bind = useCallback(
    async (rawCode: string): Promise<boolean> => {
      const code = normaliseCode(rawCode);
      if (!code) {
        setError("That is not a valid code.");
        return false;
      }
      setError(null);
      try {
        // Ask the free question BEFORE the wallet prompt. The bind route checks
        // the code too and remains the authority; what it cannot do is check it
        // without a signature, so a typo used to cost a signature and come back
        // refused.
        //
        // Only `unknown` stops here. `uncheckable` goes on to sign: that is a
        // fault on our side, and refusing a real code because our own read
        // failed is unrecoverable once the first contribution lands (§4).
        // A code already verified as this page's link code is not re-asked.
        if (!(linkCode.kind === "valid" && linkCode.code === code)) {
          setBusy("checking");
          const checked = await fetchCode(code);
          if (checked.kind === "unknown") {
            setError(UNKNOWN_CODE_SENTENCE);
            return false;
          }
        }
        setBusy("bind");
        const ok = await signed({ kind: "bind", code }, "/api/referrals/bind", { code });
        if (ok) await refresh();
        return ok;
      } finally {
        setBusy(null);
      }
    },
    [signed, refresh, linkCode],
  );

  const saveProfile = useCallback(
    async (nickname: string, emoji: string, socials: Social[]): Promise<boolean> => {
      setError(null);
      setBusy("profile");
      try {
        // The RAW values are signed, before any cleaning — the server cleans,
        // and a client that had to reproduce the cleaning byte for byte would
        // produce signatures that verify against nothing the moment the two
        // drift.
        const ok = await signed(
          { kind: "profile", nickname, emoji, socials: socialsSigned(socials) },
          "/api/referrals/profile",
          { nickname, emoji, socials },
        );
        if (ok) await refresh();
        return ok;
      } finally {
        setBusy(null);
      }
    },
    [signed, refresh],
  );

  return {
    /** idle = no wallet. loading = first fetch in flight. error = it failed. */
    status,
    state,
    linkCode,
    lockedCode,
    prefillCode,
    bindWindow,
    busy,
    /** What the APPLY button should say. Derived here so no call site has to
     *  reproduce the mapping and none of them can disagree. */
    applyPhase: (busy === "checking" ? "checking" : busy === "bind" ? "signing" : "idle") as ApplyPhase,
    error,
    clearError: useCallback(() => setError(null), []),
    bind,
    saveProfile,
    refresh,
  };
}
