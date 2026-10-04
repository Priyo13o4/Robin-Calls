import { NextResponse } from "next/server";

import { flags } from "@/lib/config/flags";
import { isDatabaseConfigured } from "@/lib/db/client";

/**
 * The two gates every /api/referrals route opens with, in one place so a new
 * route cannot ship with only one of them (§2 — eight copies of a check is
 * eight places for one to drift).
 *
 * Returns the response to send, or null to proceed.
 */
export function referralsUnavailable(): NextResponse | null {
  // Referrals ride the sale's own switch — see lib/config/flags.ts.
  if (!flags.tokenSale) {
    return NextResponse.json({ error: "Referrals are not enabled." }, { status: 404 });
  }
  // 503, not an empty answer. Without a database this surface cannot tell a
  // code that does not exist from one it could not look up, and the second
  // dressed as the first costs a real user their airdrop (§8 #9).
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Referrals are temporarily unavailable." }, { status: 503 });
  }
  return null;
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** A wallet address from a request, lowercased, or null. */
export function walletParam(value: unknown): string | null {
  return typeof value === "string" && ADDRESS.test(value) ? value.toLowerCase() : null;
}
