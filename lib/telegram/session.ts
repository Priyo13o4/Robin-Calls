import { makeSealer } from "@/lib/security/cookie-seal";
import { cookieOptions } from "@/lib/x/session";

/**
 * The Telegram onboarding session — the verified TG identity + current group-
 * membership state, carried in one encrypted, key-separated cookie between the
 * Login-Widget verify step and the final wallet signature. Like the X session,
 * nothing here touches the DB until the wallet signs; the cookie is browser-
 * session-scoped so an abandoned onboarding clears on browser close.
 *
 * Cookie options (httpOnly/lax/session-scoped) are shared with the X module —
 * one definition, both domains.
 */

const sealer = makeSealer({ secretEnv: "TG_SESSION_SECRET", salt: "robincalls-telegram" });

export interface TgOnboardingSession {
  userId: string;
  username: string | null;
  firstName: string | null;
  /** true once getChatMember confirmed the user is in the group. */
  isMember: boolean;
  /** epoch ms of the last membership check. */
  checkedAt: number;
}

export const TG_SESSION_COOKIE = "rc_tg_session";

export const sealTgSession = (s: TgOnboardingSession): string => sealer.seal(s);
export const readTgSession = (raw: string | undefined | null): TgOnboardingSession | null =>
  sealer.open<TgOnboardingSession>(raw);

/** Re-export the shared cookie options so callers don't reach into the X module. */
export { cookieOptions };
