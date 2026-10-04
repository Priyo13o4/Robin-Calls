import { formatEther } from "viem";

/**
 * Formatting shared by the sale panel and the leaderboards, so the same wallet
 * cannot appear under two different names on two pages.
 */

/** `0x1234…cdef`. The fallback identity when nobody has set a nickname. */
export function shortWallet(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * What to print for a participant.
 *
 * The wallet is ALWAYS shown, even when a nickname is set. Nicknames are not
 * unique and are not verified, so a name on its own would let anyone put
 * someone else's name against their own row on a public board — the address is
 * what makes the row identifiable, and it is public on chain regardless.
 */
export function displayName(nickname: string | null, emoji: string | null, address: string): {
  primary: string;
  secondary: string | null;
  emoji: string | null;
} {
  const short = shortWallet(address);
  return nickname
    ? { primary: nickname, secondary: short, emoji }
    : { primary: short, secondary: null, emoji };
}

/**
 * Wei as ETH, at a readable precision.
 *
 * Absence prints as an em dash, never as `0` — a number we could not read and a
 * contribution of nothing are different facts, and this is the layer where the
 * two get confused (§4).
 */
export function formatEth(wei: bigint | string | null | undefined, maxFractionDigits = 4): string {
  if (wei === null || wei === undefined) return "—";
  let value: bigint;
  try {
    value = typeof wei === "bigint" ? wei : BigInt(wei);
  } catch {
    return "—";
  }
  return Number(formatEther(value)).toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

/**
 * How the four referral states read to the person in them.
 *
 * Plain words, and no jargon the reader has to decode. "credited" and "missed"
 * are our words for our own bookkeeping; what the buyer needs to know is whether
 * they earn the bonus, and if not, why not.
 *
 * The bonus is a percentage of THEIR OWN purchase, so these sentences must never
 * describe it as a share of supply or of a pool. Those are different promises
 * and only one of them is true (docs/prds/TOKEN-SALE-INTENT.md §10.1).
 */
export const REFERRAL_STATUS_COPY: Record<string, { label: string; tone: "good" | "warn" | "bad" | "muted"; detail: string }> = {
  none: {
    label: "NO CODE YET",
    tone: "muted",
    detail: "Add a referral code before your first contribution to earn 2% more tokens than you buy.",
  },
  pending: {
    label: "CODE ADDED",
    tone: "warn",
    detail: "Your code is saved. It counts as soon as your first contribution goes through on chain.",
  },
  credited: {
    label: "BONUS EARNED",
    tone: "good",
    detail: "You added a code before you contributed, so this wallet earns 2% more tokens on top of what it buys.",
  },
  missed: {
    label: "NO CODE ADDED",
    tone: "bad",
    detail:
      "This wallet contributed before a code was added, so it does not earn the buyer bonus. The code has to come first, and it locks in once you contribute.",
  },
};
