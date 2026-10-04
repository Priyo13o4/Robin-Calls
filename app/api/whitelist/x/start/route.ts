import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { isXConfigured } from "@/lib/x/config";
import { buildAuthorizeUrl, generatePkce, randomState } from "@/lib/x/oauth";
import {
  X_PKCE_COOKIE,
  X_PKCE_TTL_SECONDS,
  cookieOptions,
  sealPkce,
} from "@/lib/x/session";

/**
 * GET /api/whitelist/x/start
 * Kicks off OAuth 2.0: generate PKCE + CSRF state, stash them in a short-lived
 * encrypted cookie, and 302 the browser to X's consent screen.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!flags.whitelist) {
    return NextResponse.json(
      { error: "Whitelist onboarding isn't open yet." },
      { status: 503 }
    );
  }
  if (!isXConfigured()) {
    return NextResponse.json(
      { error: "X sign-in isn't configured yet." },
      { status: 503 }
    );
  }

  const origin = req.nextUrl.origin;
  const { verifier, challenge } = generatePkce();
  const state = randomState();

  const res = NextResponse.redirect(buildAuthorizeUrl({ origin, state, challenge }));
  res.cookies.set(
    X_PKCE_COOKIE,
    sealPkce({ state, verifier, origin }),
    cookieOptions(req.nextUrl.protocol === "https:", X_PKCE_TTL_SECONDS)
  );
  return res;
}
