import { NextRequest, NextResponse } from "next/server";

import { setParticipantProfile } from "@/lib/data/sale-referrals";
import { referralsUnavailable, walletParam } from "@/lib/referrals/http";
import { cleanEmoji, cleanNickname, nicknameHasLink } from "@/lib/referrals/profile";
import { SOCIALS_MAX, cleanSocials, socialsSigned } from "@/lib/referrals/socials";
import { UNAVAILABLE_SENTENCE, verifyReferralProof } from "@/lib/referrals/verify";

export const dynamic = "force-dynamic";

/**
 * POST /api/referrals/profile
 *   { wallet, nickname, emoji, issuedAt, signature }
 *
 * The display name on the leaderboards. Signature-gated for the same reason as
 * binding: a wallet address is public, so without a proof anyone could put any
 * name against anyone's row.
 *
 * The signature covers the RAW submitted values, before cleaning. Signing the
 * cleaned form would mean the client had to reproduce the cleaning exactly to
 * make a matching message, and any drift between the two implementations would
 * surface as signatures that verify against nothing.
 */
export async function POST(req: NextRequest) {
  const blocked = referralsUnavailable();
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const wallet = walletParam(body.wallet);
  if (!wallet) return NextResponse.json({ error: "Missing or invalid wallet address." }, { status: 400 });

  const rawNickname = typeof body.nickname === "string" ? body.nickname : "";
  const rawEmoji = typeof body.emoji === "string" ? body.emoji : "";

  // Refused rather than stripped: silently deleting half a name would store
  // something the person did not type. Checked before the signature so a bad
  // name costs nothing.
  if (nicknameHasLink(rawNickname)) {
    return NextResponse.json({ error: "Names cannot contain links." }, { status: 400 });
  }
  if (Array.isArray(body.socials) && body.socials.length > SOCIALS_MAX) {
    return NextResponse.json({ error: `You can add up to ${SOCIALS_MAX} socials.` }, { status: 400 });
  }
  const rawSocials = Array.isArray(body.socials) ? body.socials : [];

  const proofError = await verifyReferralProof(
    wallet,
    { kind: "profile", nickname: rawNickname, emoji: rawEmoji, socials: socialsSigned(rawSocials) },
    body.issuedAt,
    body.signature,
  );
  if (proofError) {
    // 503 for the chain-fault sentence, 401 for everything else. Same split as
    // the bind route; the reasoning lives there and on UNAVAILABLE_SENTENCE.
    return NextResponse.json({ error: proofError }, { status: proofError === UNAVAILABLE_SENTENCE ? 503 : 401 });
  }

  const nickname = cleanNickname(rawNickname);
  const emoji = cleanEmoji(rawEmoji);
  const socials = cleanSocials(rawSocials);
  if (socials.length !== rawSocials.length) {
    return NextResponse.json(
      { error: "One of those links is not a valid profile link for its platform." },
      { status: 400 },
    );
  }

  try {
    await setParticipantProfile(wallet, nickname, emoji, socials);
  } catch {
    return NextResponse.json({ error: "Could not save that. Please try again." }, { status: 503 });
  }

  // Echo what was STORED, not what was sent: cleaning can change both fields
  // (an emoji field with no emoji in it is dropped), and a UI that kept showing
  // the submitted text would disagree with the leaderboard.
  return NextResponse.json({ ok: true, nickname, emoji, socials });
}
