import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";

import { bindReferralCode } from "@/lib/data/sale-referrals";
import { referralsUnavailable, walletParam } from "@/lib/referrals/http";
import { normaliseCode } from "@/lib/referrals/code";
import { UNAVAILABLE_SENTENCE, verifyReferralProof } from "@/lib/referrals/verify";
import { resolveSaleAddress } from "@/lib/sale/address";
import { saleReader, readContributed } from "@/lib/referrals/census";

export const dynamic = "force-dynamic";

const RPC_UNAVAILABLE_SENTENCE = "RPC unavailable. We could not check this wallet on chain, so the code was not applied. Please try again in a moment.";

/** Two reads through the server's provider pool (mainnet `rpc()` fails over
 *  between providers), the second after a short pause. Undefined = unread. */
async function readContributedWithRetry(chainId: number, sale: Address, wallet: Address): Promise<bigint | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 750));
    try {
      const paid = await readContributed(saleReader(chainId), sale, wallet);
      if (paid !== undefined) return paid;
    } catch {
      // saleReader throws only for an unsupported chain id; retrying cannot fix it,
      // but the loop is bounded and the caller refuses on undefined either way.
    }
  }
  return undefined;
}

/**
 * POST /api/referrals/bind
 *   { wallet, code, issuedAt, signature }
 *
 * Apply a referral code to a wallet. Signature-gated: without it, anyone who
 * knows an address — every address is public — could bind their own code to a
 * wallet before it contributes and collect referral credit for money they never
 * brought. The binding becomes permanent the moment that wallet's first
 * contribution is indexed, so there is no undo to fall back on.
 *
 * The freeze itself is enforced in `bindReferralCode`, against the one fact
 * that decides it (first_contribution_block is null), rather than by a check here
 * that a second caller could skip.
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

  const code = normaliseCode(typeof body.code === "string" ? body.code : "");
  if (!code) return NextResponse.json({ error: "That is not a valid code." }, { status: 400 });

  // The signature covers the CODE, so a proof collected for one code cannot be
  // replayed to bind a different one.
  const proofError = await verifyReferralProof(wallet, { kind: "bind", code }, body.issuedAt, body.signature);
  if (proofError) {
    // The chain-fault sentence is a 503 (retry can fix it), every other refusal
    // is a 401. A contract wallet signing during an RPC blip must not read as
    // "your signature is wrong" — the binding after the first contribution is
    // permanent, so the retry has to be offered, not implied.
    return NextResponse.json({ error: proofError }, { status: proofError === UNAVAILABLE_SENTENCE ? 503 : 401 });
  }

  // The chain decides the bind window. A failed read REFUSES (503) rather than
  // binding: our mirror can lag a purchase by a minute, and a code accepted in
  // that gap earns a bonus the rules say it cannot.
  const sale = await resolveSaleAddress();
  if (sale.kind === "unavailable") {
    return NextResponse.json({ error: RPC_UNAVAILABLE_SENTENCE, reason: "rpc-unavailable" }, { status: 503 });
  }
  if (sale.kind === "address") {
    const paid = await readContributedWithRetry(sale.chainId, sale.address as Address, wallet as Address);
    if (paid === undefined) {
      return NextResponse.json({ error: RPC_UNAVAILABLE_SENTENCE, reason: "rpc-unavailable" }, { status: 503 });
    }
    if (paid > 0n) {
      return NextResponse.json(
        {
          error: "This wallet has already contributed, so its referral code is locked. A code has to be added before the first contribution.",
          reason: "already-contributed",
        },
        { status: 409 },
      );
    }
  }

  let outcome;
  try {
    outcome = await bindReferralCode(wallet, code);
  } catch {
    // The user signed and is waiting: a write that failed must say so, never
    // return a success shape the UI renders as "applied" (§1).
    return NextResponse.json({ error: "Could not apply that code. Please try again." }, { status: 503 });
  }

  if (!outcome.ok) {
    const sentence = {
      "unknown-code": "We do not have that code. Please check it and try again.",
      "own-code": "That is your own code. You cannot refer yourself.",
      "already-contributed":
        "This wallet has already contributed, so its referral code is locked. A code has to be added before the first contribution.",
    }[outcome.reason];
    // 409 for the settled case: it is not a bad request and retrying changes
    // nothing, and the UI has to state it as a fact rather than offer a retry.
    return NextResponse.json(
      { error: sentence, reason: outcome.reason },
      { status: outcome.reason === "already-contributed" ? 409 : 400 },
    );
  }

  return NextResponse.json({ ok: true, code: outcome.code, referralStatus: "pending" });
}
