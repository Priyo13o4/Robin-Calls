import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram identity config — the second verified social path (for users who
 * can't use X). This is the Telegram **Login Widget**, NOT an OAuth2 flow and
 * NOT a paid API: the widget hands us a payload signed with the bot token,
 * which we verify locally (free), then a single free Bot API `getChatMember`
 * call confirms the user actually joined our group.
 *
 * Everything degrades gracefully: with no TELEGRAM_BOT_TOKEN, `isTgConfigured`
 * is false and the routes 503 instead of throwing, so the app builds and runs
 * before the bot exists (mirrors the X module).
 */

export function botToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return t && !t.includes("xxxx") ? t : null;
}

export function isTgConfigured(): boolean {
  return botToken() !== null;
}

/** The public @username of the login bot — needed to render the Login Widget. */
export function botUsername(): string | null {
  const u = process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "");
  return u ? u : null;
}

/**
 * The group users must join to be eligible. Accepts a numeric id (e.g.
 * -1001234567890 for a supergroup) or an @publicname — getChatMember takes
 * either. Falls back to the public @RobinCallsChat handle.
 */
export function groupChatId(): string {
  const raw = process.env.TELEGRAM_GROUP_CHAT_ID?.trim();
  return raw && raw.length > 0 ? raw : "@RobinCallsChat";
}

/** Human-facing invite link shown in the modal ("Join our Telegram"). */
export function groupInviteUrl(): string {
  const raw = process.env.TELEGRAM_GROUP_URL?.trim();
  if (raw) return raw;
  const id = groupChatId();
  return id.startsWith("@") ? `https://t.me/${id.slice(1)}` : "https://t.me/RobinCallsChat";
}

/** getChatMember statuses that count as "in the group". */
const MEMBER_STATUSES = new Set(["creator", "administrator", "member"]);
export function isMemberStatus(status: string | undefined): boolean {
  return status ? MEMBER_STATUSES.has(status) : false;
}

/** Login Widget payload (all values arrive as strings on the redirect). */
export interface TgLoginPayload {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
}

const AUTH_FRESHNESS_SECONDS = 24 * 60 * 60; // reject stale widget payloads

/**
 * Verify a Login Widget payload per Telegram's spec:
 *   secret = SHA256(bot_token)
 *   check  = HMAC-SHA256(data_check_string, secret) === payload.hash
 * where data_check_string is every field except `hash`, as "k=v" sorted by key
 * and joined by "\n". Also rejects a payload older than 24h (replay bound).
 * Constant-time hash compare. Returns null when it can't be configured.
 */
export function verifyLoginPayload(payload: TgLoginPayload): boolean {
  const token = botToken();
  if (!token) return false;
  const { hash, ...fields } = payload;
  if (!hash) return false;

  const dataCheckString = Object.keys(fields)
    .filter((k) => (fields as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map((k) => `${k}=${(fields as Record<string, string>)[k]}`)
    .join("\n");

  const secret = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secret).update(dataCheckString).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return false;
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  return ageSeconds >= 0 && ageSeconds <= AUTH_FRESHNESS_SECONDS;
}
