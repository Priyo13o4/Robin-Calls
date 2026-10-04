import { readSiteConfigKeys } from "@/lib/data/site-config";
import { DEFAULT_REFERRAL_RULES, type ReferralRules } from "./rules";
import { REFERRAL_MIN_WALLETS_KEY, REFERRAL_MIN_WEI_KEY } from "./config-keys";

/**
 * Operator dials for the referral plane. Every one of them has a code default
 * that is the SAFE branch, because the pin is the part that can go missing
 * (CLAUDE.md §8 #20) — a `site_config` row that is never written, or a database
 * we could not read, must leave the system correct rather than convenient.
 *
 * The walker's dials (start block, confirmation lag) were removed with the
 * walker: there is no block range to start or to stay behind, and leaving them
 * would be a control that controls nothing. Safe here means the thresholds are
 * the published rules, unchanged.
 */

// Declared in `./config-keys`, a leaf with no imports, and re-exported here so
// server callers keep one import. A CLIENT component must take them from the
// leaf: this module reaches the database and would follow it into the bundle.
export { REFERRAL_MIN_WALLETS_KEY, REFERRAL_MIN_WEI_KEY } from "./config-keys";

export interface ReferralConfig {
  rules: ReferralRules;
  /**
   * Where these values came from. `unavailable` means the read faulted and
   * every field above is a fallback — NOT that the dials are unset.
   *
   * The distinction is the whole point (§4). A read that succeeds and finds no
   * rows really does mean the defaults are in force, and is a fine basis for a
   * final snapshot. A read that threw means we do not know what the rules are,
   * and paying out under a guess is not the same thing at all.
   */
  source: "stored" | "unavailable";
  /**
   * Dials that were SET and could not be parsed, so a fallback is standing in
   * for an operator's explicit value. Worse than an unset dial, because
   * somebody believes this number is in force.
   */
  invalidKeys: string[];
}

/**
 * Parse a dial. A set-but-invalid value (including a rejected 0) is REPORTED
 * through `invalid`, never silently swapped for the fallback — somebody
 * believes that number is in force, and `invalidKeys` is what stops a final
 * snapshot from paying out under the fallback (issue 14).
 *
 * `min` is per dial: a minimum of 0 wallets or wei would switch its gate off
 * entirely — a dial that means "nobody has to qualify" is not a dial, it is
 * the pool being disabled by typo. Same floor the admin UI enforces.
 *
 * Exported for tests (tests/referral-config.test.ts).
 */
export const positiveInt = (
  raw: string | undefined,
  fallback: number,
  key: string,
  invalid: string[],
  min = 0,
): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw.trim());
  if (Number.isInteger(n) && n >= min) return n;
  invalid.push(key);
  return fallback;
};

export const positiveBigint = (
  raw: string | undefined,
  fallback: bigint,
  key: string,
  invalid: string[],
  min = 0n,
): bigint => {
  if (raw === undefined) return fallback;
  try {
    const n = BigInt(raw.trim());
    if (n >= min) return n;
  } catch {
    // falls through to the same report as an out-of-range value
  }
  invalid.push(key);
  return fallback;
};

/**
 * Reads the dials. A failed read still returns usable values rather than
 * throwing — the mirror must keep running through a config blip — but it says
 * so in `source`, and a caller that is about to publish a number people are
 * paid from is expected to check.
 *
 * That caller is `buildAirdropSnapshot`. Without the flag, a `site_config` read
 * that threw at the close would silently revert a raised threshold, store the
 * fallback in the snapshot's own `rules` column, and leave the run internally
 * consistent and wrong.
 */
export async function readReferralConfig(): Promise<ReferralConfig> {
  let rows: Record<string, string> = {};
  let source: ReferralConfig["source"] = "stored";
  try {
    rows = await readSiteConfigKeys([
      REFERRAL_MIN_WALLETS_KEY,
      REFERRAL_MIN_WEI_KEY,
    ]);
  } catch {
    rows = {};
    source = "unavailable";
  }
  const invalidKeys: string[] = [];
  return {
    rules: {
      minReferredWallets: positiveInt(
        rows[REFERRAL_MIN_WALLETS_KEY],
        DEFAULT_REFERRAL_RULES.minReferredWallets,
        REFERRAL_MIN_WALLETS_KEY,
        invalidKeys,
        1,
      ),
      minReferredWei: positiveBigint(
        rows[REFERRAL_MIN_WEI_KEY],
        DEFAULT_REFERRAL_RULES.minReferredWei,
        REFERRAL_MIN_WEI_KEY,
        invalidKeys,
        1n,
      ),
    },
    source,
    invalidKeys,
  };
}
