import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { groupChatId, isTgConfigured } from "@/lib/telegram/config";
import { isChatMember } from "@/lib/telegram/client";
import {
  TG_SESSION_COOKIE,
  cookieOptions,
  readTgSession,
  sealTgSession,
} from "@/lib/telegram/session";

/**
 * POST /api/whitelist/telegram/recheck
 * Re-runs the group-membership check after the user says they've joined, and
 * re-seals the session cookie with the fresh result. Free Bot API call.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!flags.whitelist || !isTgConfigured()) {
    return NextResponse.json({ error: "Telegram onboarding isn't available." }, { status: 503 });
  }

  const session = readTgSession(req.cookies.get(TG_SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json(
      { error: "Connect Telegram first.", reconnect: true },
      { status: 401 }
    );
  }

  let isMember: boolean;
  try {
    isMember = await isChatMember(groupChatId(), session.userId);
  } catch (err) {
    console.error("[whitelist/telegram/recheck]", err);
    return NextResponse.json(
      { error: "Couldn't check membership right now. Try again in a moment." },
      { status: 502 }
    );
  }

  session.isMember = isMember;
  session.checkedAt = Date.now();

  const res = NextResponse.json({ ok: true, isMember });
  res.cookies.set(
    TG_SESSION_COOKIE,
    sealTgSession(session),
    cookieOptions(req.nextUrl.protocol === "https:")
  );
  return res;
}
