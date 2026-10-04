import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import {
  groupChatId,
  isTgConfigured,
  verifyLoginPayload,
  type TgLoginPayload,
} from "@/lib/telegram/config";
import { isChatMember } from "@/lib/telegram/client";
import {
  TG_SESSION_COOKIE,
  cookieOptions,
  sealTgSession,
} from "@/lib/telegram/session";

/**
 * GET /api/whitelist/telegram/verify
 * The Telegram Login Widget (redirect mode, data-auth-url) sends the signed
 * login payload here as query params. We verify the HMAC signature locally,
 * check group membership once (free Bot API call), stash the identity + member
 * state in the encrypted session cookie, and bounce back to the modal.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const secure = req.nextUrl.protocol === "https:";

  const back = (status: "connected" | "error", reason?: string) => {
    const url = new URL("/", origin);
    url.searchParams.set("tg", status);
    if (reason) url.searchParams.set("reason", reason);
    url.hash = "whitelist";
    return url.toString();
  };

  if (!flags.whitelist || !isTgConfigured()) {
    return NextResponse.redirect(back("error", "unavailable"));
  }

  const p = req.nextUrl.searchParams;
  const id = p.get("id");
  const hash = p.get("hash");
  const authDate = p.get("auth_date");
  if (!id || !hash || !authDate) {
    return NextResponse.redirect(back("error", "payload"));
  }

  const payload: TgLoginPayload = {
    id,
    auth_date: authDate,
    hash,
    first_name: p.get("first_name") ?? undefined,
    last_name: p.get("last_name") ?? undefined,
    username: p.get("username") ?? undefined,
    photo_url: p.get("photo_url") ?? undefined,
  };

  if (!verifyLoginPayload(payload)) {
    return NextResponse.redirect(back("error", "signature"));
  }

  // Membership is best-effort here: if the check itself fails (e.g. the bot
  // isn't an admin yet), we still connect the identity with isMember=false so
  // the modal shows the "join then re-check" step rather than dead-ending.
  let isMember = false;
  try {
    isMember = await isChatMember(groupChatId(), id);
  } catch (err) {
    console.error("[whitelist/telegram/verify] membership check failed:", err);
  }

  const res = NextResponse.redirect(back("connected"));
  res.cookies.set(
    TG_SESSION_COOKIE,
    sealTgSession({
      userId: id,
      username: payload.username ?? null,
      firstName: payload.first_name ?? null,
      isMember,
      checkedAt: Date.now(),
    }),
    cookieOptions(secure)
  );
  return res;
}
