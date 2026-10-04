import { NextResponse } from "next/server";
import { TG_SESSION_COOKIE } from "@/lib/telegram/session";

/**
 * POST /api/whitelist/telegram/disconnect
 * "Start over" for the Telegram path — drops the TG onboarding session so the
 * modal falls back to the connect step. Clears only the caller's own cookie.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(TG_SESSION_COOKIE);
  return res;
}
