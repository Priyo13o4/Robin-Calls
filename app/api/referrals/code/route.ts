import { NextRequest, NextResponse } from "next/server";

import { readParticipantByCode } from "@/lib/data/sale-referrals";
import { referralsUnavailable } from "@/lib/referrals/http";
import { normaliseCode } from "@/lib/referrals/code";

export const dynamic = "force-dynamic";

/**
 * GET /api/referrals/code?code=ABCD2345
 *
 * Is this a real code, and whose? Called on page load when a share link carries
 * `?ref=`, and again when someone types a code by hand.
 *
 * THREE answers, never two. "valid" and "unknown" are facts about the code;
 * `503` from the guard is a fact about US. Collapsing the third into "unknown"
 * would tell a user holding a perfectly good code that their friend's code is
 * fake, and they would then contribute without it and lose the airdrop
 * permanently — there is no second chance after the first contribution.
 *
 * Returns the referrer's truncated address alongside the display identity.
 * lib/referrals/display.ts's rule is that the address is ALWAYS shown next to a
 * name, because nicknames are neither unique nor verified; the invite
 * confirmation is exactly the place an impostor's nickname would be trusted
 * with nothing to check it against (issue 9). The address is public on chain.
 */
export async function GET(req: NextRequest) {
  const blocked = referralsUnavailable();
  if (blocked) return blocked;

  const raw = req.nextUrl.searchParams.get("code") ?? "";
  const code = normaliseCode(raw);
  if (!code) {
    return NextResponse.json({ valid: false, reason: "malformed" });
  }

  const read = await readParticipantByCode(code);
  if (read.kind === "unavailable") {
    return NextResponse.json({ error: "Could not check that code right now." }, { status: 503 });
  }
  if (read.kind === "absent") {
    return NextResponse.json({ valid: false, reason: "unknown", code });
  }

  return NextResponse.json({
    valid: true,
    code,
    referrer: {
      nickname: read.participant.nickname,
      emoji: read.participant.emoji,
      address: read.participant.walletAddress,
    },
  });
}
