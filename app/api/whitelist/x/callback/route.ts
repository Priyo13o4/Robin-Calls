import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { isXConfigured } from "@/lib/x/config";
import { exchangeCode } from "@/lib/x/oauth";
import { getMe } from "@/lib/x/client";
import {
  X_PKCE_COOKIE,
  X_SESSION_COOKIE,
  cookieOptions,
  emptyTasks,
  readPkce,
  sealSession,
} from "@/lib/x/session";

/**
 * GET /api/whitelist/x/callback
 * X redirects here with ?code&state. We validate state against the PKCE cookie,
 * exchange the code for tokens, read the user's identity, and store it in the
 * encrypted onboarding-session cookie. Then bounce back to the landing page
 * with the whitelist modal re-opened.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const secure = req.nextUrl.protocol === "https:";

  const back = (status: "connected" | "error", reason?: string) => {
    const url = new URL("/", origin);
    url.searchParams.set("x", status);
    if (reason) url.searchParams.set("reason", reason);
    url.hash = "whitelist";
    return url.toString();
  };

  if (!flags.whitelist || !isXConfigured()) {
    return NextResponse.redirect(back("error", "unavailable"));
  }

  const params = req.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

  const pkce = readPkce(req.cookies.get(X_PKCE_COOKIE)?.value);

  // User declined on X's consent screen.
  if (oauthError) {
    const res = NextResponse.redirect(back("error", "denied"));
    res.cookies.delete(X_PKCE_COOKIE);
    return res;
  }
  // CSRF / integrity: state must match the sealed cookie exactly.
  if (!code || !state || !pkce || pkce.state !== state) {
    const res = NextResponse.redirect(back("error", "state"));
    res.cookies.delete(X_PKCE_COOKIE);
    return res;
  }

  try {
    const tok = await exchangeCode({
      origin: pkce.origin, // same origin used to build the authorize URL
      code,
      verifier: pkce.verifier,
    });
    const me = await getMe(tok.access_token);

    const res = NextResponse.redirect(back("connected"));
    res.cookies.set(
      X_SESSION_COOKIE,
      sealSession({
        userId: me.id,
        username: me.username,
        name: me.name,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        expiresAt: Date.now() + tok.expires_in * 1000,
        tasks: emptyTasks(),
      }),
      // Session-scoped: clears on browser close; an unfinished onboarding
      // doesn't linger. Still survives this redirect and same-browser reopens.
      cookieOptions(secure)
    );
    res.cookies.delete(X_PKCE_COOKIE);
    return res;
  } catch (err) {
    console.error("[whitelist/x/callback]", err);
    const res = NextResponse.redirect(back("error", "exchange"));
    res.cookies.delete(X_PKCE_COOKIE);
    return res;
  }
}
