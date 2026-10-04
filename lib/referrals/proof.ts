/**
 * Wallet-control proof for the two referral writes that a stranger must not be
 * able to make on someone else's behalf.
 *
 * BINDING is the one that matters. Without a signature, anyone who knows an
 * address — every address is public — could bind THEIR code to a wallet before
 * that wallet contributes, and collect 4% credit for money they never brought.
 * The binding is permanent from the first contribution onward, so there is no
 * undo. Nicknames go through the same door because the alternative is a second
 * auth story for one field.
 *
 * The message NAMES THE ACTION AND ITS PAYLOAD. A single "prove you own this
 * wallet" signature would be a bearer token for every write on this surface: a
 * signature collected to set a nickname could be replayed to bind a code. Same
 * reason the prefix differs from the whitelist surface's — one surface's proof
 * must not open another's.
 *
 * BROWSER SAFE ON PURPOSE: this file holds only the message builder. The
 * verifier lives in `verify.ts` (server only), because it needs the RPC pool,
 * and importing that from here would drag it into the client bundle.
 */

/** ±10 minutes, matching the whitelist route: covers clock skew and a user who
 *  signs, gets distracted, and confirms a few minutes later. */
export const FRESHNESS_MS = 10 * 60 * 1000;

export type ReferralAction =
  | { kind: "bind"; code: string }
  | { kind: "profile"; nickname: string; emoji: string; socials: string };

/**
 * The exact string the wallet signs. Client and server both build it here — a
 * second copy in the browser is how the two drift into producing signatures
 * that verify against nothing.
 */
export function referralMessage(walletLower: string, action: ReferralAction, issuedAt: string): string {
  const lines = [`RobinCalls referral`, `Wallet: ${walletLower}`, `Action: ${action.kind}`];
  if (action.kind === "bind") {
    lines.push(`Code: ${action.code}`);
  } else {
    // Empty is a real value here — it is how a nickname is cleared — so the
    // lines are always present and the payload is unambiguous either way.
    lines.push(`Nickname: ${action.nickname}`, `Emoji: ${action.emoji}`, `Socials: ${action.socials}`);
  }
  lines.push(`Issued: ${issuedAt}`);
  return lines.join("\n");
}
