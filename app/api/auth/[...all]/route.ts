import { toNextJsHandler } from "better-auth/next-js";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";

/**
 * Better Auth HTTP handler. Sign-IN is exposed; public sign-UP is blocked —
 * the ONLY way an account gets created is the one-time seed script, which
 * calls auth.api.signUpEmail in-process (never over HTTP). This keeps the
 * console admin-only without disabling sign-up at the library level (the seed
 * needs it).
 */
const handler = toNextJsHandler(auth);

function blocksSignup(req: NextRequest) {
  return req.nextUrl.pathname.includes("/sign-up");
}

export async function POST(req: NextRequest) {
  if (blocksSignup(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return handler.POST(req);
}

export async function GET(req: NextRequest) {
  if (blocksSignup(req)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return handler.GET(req);
}
