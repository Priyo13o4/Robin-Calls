import { explorerWebUrl } from "@/lib/config/chain";

/**
 * The deployed token, hardcoded (operator decision 2026-09-30). Source is
 * verified on all three explorers below (contracts/README.md, "Deployed
 * addresses"; Sourcify reports exact_match).
 */
export const TOKEN_NAME = "RobinCalls";
export const TOKEN_SYMBOL = "ROBINCALLS";
export const TOKEN_ADDRESS = "0xf53c0ec24a6e2ae4bbd58e32746add7e3eb6c71b";

export const TOKEN_EXPLORER_URL = `${explorerWebUrl}/token/${TOKEN_ADDRESS}`;

export const TOKEN_VERIFIERS = [
  { name: "Blockscout", href: `${explorerWebUrl}/address/${TOKEN_ADDRESS}?tab=contract` },
  { name: "Sourcify", href: `https://repo.sourcify.dev/4663/${TOKEN_ADDRESS}` },
  { name: "robin.etherscan.io", href: `https://robin.etherscan.io/address/${TOKEN_ADDRESS}#code` },
];

export const TOKEN_DECIMALS = 18;

/**
 * Hardcoded (operator decision 2026-09-30): total supply minus what PinkLock
 * holds. Re-check with totalSupply - balanceOf(PinkLock 0xbe0b…c8d9).
 */
export const CIRCULATING_SUPPLY = 6_150_000;

/**
 * Operator decision 2026-09-30: we issued this token, so no public surface shows
 * its score, tier or deductions. The ledger row itself is still written and hashed.
 */
export const isOwnToken = (address: string | null | undefined): boolean =>
  typeof address === "string" && address.toLowerCase() === TOKEN_ADDRESS;

export const OWN_TOKEN_NOT_SCORED = "RobinCalls issued this token, so it does not score it.";

/**
 * A stored verdict row as a public reader may see it. Score, tier and per-check
 * points are dropped for our token; any other row passes through unchanged.
 */
export function publicVerdictRow<T extends { token_address: string; checks: unknown }>(row: T) {
  if (!isOwnToken(row.token_address)) return row;
  const { score: _s, tier: _t, critical_override: _c, ...rest } = row as T & Record<string, unknown>;
  const checks = Array.isArray(row.checks)
    ? row.checks.map((c) => {
        const { deduction: _d, weight: _w, ...kept } = c as Record<string, unknown>;
        return kept;
      })
    : row.checks;
  return { ...rest, checks, notScored: OWN_TOKEN_NOT_SCORED };
}
