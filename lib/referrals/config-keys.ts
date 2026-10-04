/**
 * The two `site_config` keys for the referral dials, and nothing else.
 *
 * A LEAF: no imports, so a client component can name a key without dragging
 * `lib/referrals/config.ts` into the browser graph. That module imports
 * `lib/data/site-config`, which imports the Drizzle client, which imports `pg`
 * — and the admin panel importing the keys from there put `dns`, `fs`, `net`
 * and `tls` in a client bundle and broke `next build`. `tsc` sees none of it.
 */

export const REFERRAL_MIN_WALLETS_KEY = "referral_min_referred_wallets";
export const REFERRAL_MIN_WEI_KEY = "referral_min_referred_wei";
