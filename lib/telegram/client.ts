import { botToken, isMemberStatus } from "./config";

/**
 * Minimal Telegram Bot API client — one call, `getChatMember`, to confirm a
 * user is in our group. The Bot API is FREE (no per-call cost), unlike X. The
 * bot must be an admin in the group for this to see non-admin members.
 */

export class TgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "TgApiError";
  }
}

interface ChatMemberResult {
  ok: boolean;
  result?: { status?: string };
  description?: string;
  error_code?: number;
}

/**
 * True iff `userId` is currently a member (creator/administrator/member) of
 * `chatId`. Throws TgApiError on transport/API failure so the caller can tell
 * "not a member" (false) apart from "couldn't check" (throw).
 */
export async function isChatMember(
  chatId: string,
  userId: string
): Promise<boolean> {
  const token = botToken();
  if (!token) throw new TgApiError("Telegram not configured", 503);

  const url = new URL(`https://api.telegram.org/bot${token}/getChatMember`);
  url.searchParams.set("chat_id", chatId);
  url.searchParams.set("user_id", userId);

  const res = await fetch(url, { method: "GET" });
  const json = (await res.json().catch(() => null)) as ChatMemberResult | null;

  if (!json) {
    throw new TgApiError(`Telegram API ${res.status}`, res.status);
  }
  if (!json.ok) {
    // "user not found" / "PARTICIPANT_ID_INVALID" ⇒ genuinely not in the chat.
    const desc = (json.description ?? "").toLowerCase();
    if (desc.includes("not found") || desc.includes("participant")) {
      return false;
    }
    throw new TgApiError(json.description ?? "Telegram API error", res.status, json);
  }
  return isMemberStatus(json.result?.status);
}
