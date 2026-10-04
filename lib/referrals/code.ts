import { keccak256, stringToHex } from "viem";

/**
 * Referral codes: what they are, and what they are not.
 *
 * A code is a PUBLIC handle for a wallet — it is meant to be posted, screenshot
 * and read aloud. It grants nothing to whoever holds it; the only thing you can
 * do with someone's code is credit them. So it is derived, not random, and it
 * carries no secret: one wallet, one code, forever, re-derivable by anyone
 * including support.
 *
 * Crockford base32 (no I, L, O or U) so the shapes that get confused on a phone
 * screen normalise back to one code rather than to a different wallet's.
 */

/** 32 symbols. Index = value; the order is the encoding, do not sort it. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const CODE_LENGTH = 8;

/** The shape the database check constraint enforces (migration 0087). */
export const CODE_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/**
 * What a human typed → the canonical code, or null when it cannot be one.
 *
 * Crockford's substitutions, and they are the whole reason for this alphabet:
 * O reads as 0, I and L read as 1. Hyphens and spaces are stripped because
 * people insert them when copying. Anything left that is not in the alphabet
 * makes the input invalid — we never "best effort" a code into existence, since
 * a silently corrected code credits the WRONG referrer, which is worse than a
 * "that code doesn't exist" message.
 */
export function normaliseCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return CODE_PATTERN.test(cleaned) ? cleaned : null;
}

/**
 * The code for a wallet. `attempt` exists only for collision resolution and is
 * 0 for every code that will ever be issued in practice: 32^8 is 1.1e12 codes,
 * so a few thousand wallets collide with probability around 1e-5. The caller
 * (lib/data/sale-referrals.ts) walks attempts until the unique index accepts
 * one, rather than assuming.
 */
export function deriveReferralCode(walletAddress: string, attempt = 0): string {
  const seed = `robincalls-referral:v1:${walletAddress.toLowerCase()}:${attempt}`;
  // keccak over the seed, then read the digest 5 bits at a time. Taking the
  // low bits of a BigInt modulo would work too but biases nothing here either
  // way — 32 divides 2^256 exactly.
  let acc = BigInt(keccak256(stringToHex(seed)));
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out = CODE_ALPHABET[Number(acc & 31n)] + out;
    acc >>= 5n;
  }
  return out;
}

/**
 * The share link. One shape everywhere — the sale page reads `ref` and nothing
 * else, so a link built by hand with a different parameter name silently
 * credits nobody.
 */
export function referralLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/token-sale?ref=${code}`;
}

export const REFERRAL_QUERY_PARAM = "ref";
