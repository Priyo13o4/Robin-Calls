import { isAddress, type Address } from "viem";
import { isDatabaseConfigured } from "@/lib/db/client";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import { reportError } from "@/lib/observability/reporter";
import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";

/**
 * Server-side resolution of the sale contract address — the ONE reader that
 * decides what /token-sale and /admin/token-sale point at. Deliberately NOT in
 * `PUBLIC_KEYS` on /api/site-config and never a NEXT_PUBLIC_ var: that route
 * is public, un-matched by the rate limiter, and a DB-hitting amplification
 * surface (KNOWN-PROBLEMS L89). The browser never asks for this; the page's own
 * server render resolves it.
 */

export const TOKEN_SALE_ADDRESS_KEY = "token_sale_address";
export const TOKEN_SALE_CHAIN_ID_KEY = "token_sale_chain_id";

/**
 * Three states, not two. `readSiteConfigKeys` returns `{}` both when the row
 * is genuinely absent AND when `DATABASE_URL` is unset — and a thrown read
 * covers "DB up but unreachable". Collapsing those into one value is §8 #9
 * verbatim: the page would say "the sale has not been configured" when the
 * truth is "we could not look", an all-clear-shaped lie about our own state.
 */
export type SaleAddress =
  | { kind: "address"; address: Address; chainId: number }
  | { kind: "unconfigured" }
  | { kind: "unavailable" };

const toAddress = (v: string | undefined): Address | null => {
  const t = v?.trim().toLowerCase();
  return t && isAddress(t) ? (t as Address) : null;
};

/**
 * site_config is the ONLY source. There was a `TOKEN_SALE_ADDRESS` env
 * fallback; it was removed 2026-09-08 because it made the two states
 * indistinguishable in the direction that matters. Clearing the DB row is how
 * an operator says "no sale is configured", and a set env silently answered
 * with an address anyway — so the panel could not be pointed at nothing, and
 * the only way to change the pin was a redeploy, which is the thing a
 * runtime config row exists to avoid.
 */
export async function resolveSaleAddress(): Promise<SaleAddress> {
  if (!isDatabaseConfigured()) return { kind: "unavailable" };

  let keys: Record<string, string | undefined>;
  try {
    keys = await readSiteConfigKeys([TOKEN_SALE_ADDRESS_KEY, TOKEN_SALE_CHAIN_ID_KEY]);
  } catch (error) {
    void reportError({
      code: "RC_CONFIG_INVALID",
      message: error instanceof Error ? error.message : "token_sale site_config read failed",
      operation: "sale.resolveSaleAddress",
      error,
    });
    return { kind: "unavailable" };
  }

  const dbAddr = toAddress(keys[TOKEN_SALE_ADDRESS_KEY]);
  if (!dbAddr) return { kind: "unconfigured" };

  const rawChain = keys[TOKEN_SALE_CHAIN_ID_KEY]?.trim();
  const parsedChain = rawChain ? Number(rawChain) : NaN;
  const chainId = Number.isInteger(parsedChain) && parsedChain > 0 ? parsedChain : ROBINHOOD_CHAIN_ID;

  return { kind: "address", address: dbAddr, chainId };
}
