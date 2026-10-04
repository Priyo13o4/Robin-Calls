import { NextRequest, NextResponse } from "next/server";
import { botUsername, groupInviteUrl, isTgConfigured } from "@/lib/telegram/config";
import { TG_SESSION_COOKIE, readTgSession } from "@/lib/telegram/session";

/**
 * GET /api/whitelist/telegram/session
 * The modal reads this to render the Telegram path: the bot @username (needed
 * to mount the Login Widget) and the group link before connecting, then the
 * connected identity + membership state after. Never exposes anything secret.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isTgConfigured()) {
    return NextResponse.json({ configured: false, connected: false, botUsername: null });
  }
  const base = {
    configured: true,
    botUsername: botUsername(),
    groupUrl: groupInviteUrl(),
  };
  const session = readTgSession(req.cookies.get(TG_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ ...base, connected: false });
  }
  return NextResponse.json({
    ...base,
    connected: true,
    username: session.username,
    firstName: session.firstName,
    isMember: session.isMember,
  });
}
