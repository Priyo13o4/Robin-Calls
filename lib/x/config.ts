/**
 * X (Twitter) OAuth 2.0 + API configuration — one place, no secrets in code.
 *
 * This is the identity layer for the whitelist onboarding: users authenticate
 * with X (OAuth 2.0 Authorization Code + PKCE) and authorise us to run three
 * onboarding actions on their own account — follow, like, post — which we then
 * record as verified. Better Auth stays admin-only; end users are identified by
 * their X account + their wallet, never a RobinCalls password.
 *
 * Everything degrades gracefully: with no TWITTER_CLIENT_ID set, `isConfigured`
 * is false and the routes return 503 instead of throwing, so the app still
 * builds and runs before the credentials exist.
 */

export const X_OAUTH = {
  authorizeUrl: "https://twitter.com/i/oauth2/authorize",
  tokenUrl: "https://api.twitter.com/2/oauth2/token",
  apiBase: "https://api.twitter.com/2",
} as const;

/** Path the X app's "Callback URI / Redirect URL" must be registered against. */
export const X_CALLBACK_PATH = "/api/whitelist/x/callback";

/**
 * Scopes — identity only, deliberately minimal (X API COST):
 *  - users.read / tweet.read → read the connecting account's identity via
 *    GET /2/users/me. That is the ONLY metered X API call we ever make, and
 *    it's within the free tier (no billing exists on Free — over-quota just
 *    429s). Follow/like/post are done through x.com/intent/* links in the
 *    user's own browser — honor-system, zero API calls, zero cost — so we
 *    request NO write scopes and need no paid tier. See docs/prds/optimizations.md §1.
 */
const DEFAULT_SCOPES = ["users.read", "tweet.read"];

export function xScopes(): string[] {
  const raw = process.env.X_OAUTH_SCOPES?.trim();
  return raw ? raw.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES;
}

export function xClientId(): string | null {
  const id = process.env.TWITTER_CLIENT_ID?.trim();
  return id && !id.includes("xxxx") ? id : null;
}

/** Present only for a Confidential (Web App) client. Absent → public + PKCE. */
export function xClientSecret(): string | null {
  const s = process.env.TWITTER_CLIENT_SECRET?.trim();
  return s && !s.includes("xxxx") ? s : null;
}

export function isXConfigured(): boolean {
  return xClientId() !== null;
}

/**
 * The exact redirect_uri handed to X. It must byte-match the value registered
 * in the X app AND be identical between the authorize and token-exchange calls,
 * so we derive it from the live request origin (localhost in dev, the real
 * domain in prod). An explicit override wins when the deploy sits behind a
 * proxy that rewrites the origin.
 */
export function xRedirectUri(origin: string): string {
  const override = process.env.X_OAUTH_REDIRECT_URI?.trim();
  return override && override.length > 0 ? override : `${origin}${X_CALLBACK_PATH}`;
}

/** The tweet users post at the "share" step. Admin/env overridable. */
export function onboardingPostText(): string {
  return (
    process.env.X_ONBOARDING_POST_TEXT?.trim() ||
    "Just joined the @RobinCalls whitelist — the permanent record of Robinhood Chain. 🏹\n\nAnswer the Call. 🟢"
  );
}

/** Parse an X handle out of a profile URL or a raw @handle. */
export function parseXUsername(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  const at = s.replace(/^@/, "");
  if (/^[A-Za-z0-9_]{1,15}$/.test(at)) return at;
  const m = s.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i);
  return m ? m[1] : null;
}

/** Parse a tweet id out of a status URL (…/status/1234567890). */
export function parseTweetId(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.match(/status\/(\d{5,25})/);
  return m ? m[1] : null;
}

/**
 * X Web Intent URLs — the free path for the three onboarding actions. Each
 * opens x.com in the user's own logged-in browser with the action pre-filled;
 * the user confirms it there. No API call, no scope, no quota. The trade-off
 * (accepted deliberately, see docs/prds/optimizations.md §1) is that completion is
 * user-attested, not API-verified — identity stays hard-verified via OAuth.
 */
export const xIntents = {
  follow: (username: string) =>
    `https://x.com/intent/follow?screen_name=${encodeURIComponent(username)}`,
  like: (tweetId: string) =>
    `https://x.com/intent/like?tweet_id=${encodeURIComponent(tweetId)}`,
  post: (text: string) =>
    `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`,
} as const;
