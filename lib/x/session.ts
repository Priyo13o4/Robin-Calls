import { seal, open } from "./crypto";
import { refreshAccessToken } from "./oauth";

/**
 * The X onboarding session — everything we need between "Connect X" and the
 * final wallet signature, carried in one encrypted httpOnly cookie. Tokens live
 * ONLY here (never in the database): onboarding is a single sitting, so when the
 * wallet signs at the end we persist the *results* (identity + which tasks were
 * verified) and let the cookie expire. Nothing long-lived to leak.
 */

export interface XTasks {
  follow: boolean;
  like: boolean;
  post: boolean;
}

export interface XOnboardingSession {
  userId: string;
  username: string;
  name: string;
  accessToken: string;
  refreshToken?: string;
  /** epoch ms when the access token expires */
  expiresAt: number;
  tasks: XTasks;
  postedTweetId?: string;
}

/** Short-lived state carried across the authorize→callback redirect (CSRF + PKCE). */
export interface XPkceState {
  state: string;
  verifier: string;
  origin: string;
}

export const X_PKCE_COOKIE = "rc_x_oauth";
export const X_SESSION_COOKIE = "rc_x_session";

export const X_PKCE_TTL_SECONDS = 10 * 60; // authorize round-trip window
// The onboarding session cookie is now browser-session-scoped (no maxAge — see
// cookieOptions), so it clears on browser close rather than after a fixed hour.

/**
 * Cookie options. Pass a `maxAge` for a persistent cookie (the short-lived PKCE
 * cookie uses this), or omit it for a **browser-session cookie** — no expiry
 * attribute, so the browser drops it when it fully closes. The onboarding
 * session cookie uses the session-scoped form on purpose: an incomplete
 * onboarding shouldn't linger for an hour, but it still survives the OAuth
 * redirect and tab reopens while the browser stays open (resume UX). A
 * lax/session cookie still rides the top-level redirect back from X.
 */
export function cookieOptions(secure: boolean, maxAge?: number | null) {
  const base = {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
  };
  return maxAge == null ? base : { ...base, maxAge };
}

export const sealSession = (s: XOnboardingSession): string => seal(s);
export const readSession = (raw: string | undefined | null): XOnboardingSession | null =>
  open<XOnboardingSession>(raw);

export const sealPkce = (s: XPkceState): string => seal(s);
export const readPkce = (raw: string | undefined | null): XPkceState | null =>
  open<XPkceState>(raw);

export const emptyTasks = (): XTasks => ({ follow: false, like: false, post: false });

/**
 * Return a valid access token, refreshing first if it's within 60s of expiry.
 * Mutates and returns the session so the caller can re-seal the cookie when the
 * token rotated. Throws if the token is expired and unrefreshable.
 *
 * Currently DORMANT: scopes are identity-only (no offline.access), so no
 * refresh token is ever issued and nothing calls this. Kept because it's the
 * piece you re-wire first if API-verified tasks ever come back.
 */
export async function ensureFreshToken(
  session: XOnboardingSession
): Promise<{ session: XOnboardingSession; rotated: boolean }> {
  if (Date.now() < session.expiresAt - 60_000) {
    return { session, rotated: false };
  }
  if (!session.refreshToken) {
    throw new Error("X access token expired and no refresh token available");
  }
  const tok = await refreshAccessToken(session.refreshToken);
  const next: XOnboardingSession = {
    ...session,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? session.refreshToken,
    expiresAt: Date.now() + tok.expires_in * 1000,
  };
  return { session: next, rotated: true };
}
