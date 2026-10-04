import { NextResponse } from "next/server";
import { X_PKCE_COOKIE, X_SESSION_COOKIE } from "@/lib/x/session";

/**
 * POST /api/whitelist/x/disconnect
 *
 * "Start over" — drops the X onboarding session (and any stray PKCE cookie) so
 * the modal falls back to the Connect-X step. Clears only the caller's own
 * cookies, so it needs no auth. Idempotent: fine to call with nothing set.
 */
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(X_SESSION_COOKIE);
  res.cookies.delete(X_PKCE_COOKIE);
  return res;
}
