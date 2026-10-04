import type { MarketSnapshot } from "../types";

/**
 * Market-data provider contract (PRD §11.6, §11.8). Providers supply indexed
 * observations, never security truth — on-chain adapters stay authoritative
 * for whether a route exists and whether a sell simulates.
 */

/** §11.6 normalized provider states. NOT_FOUND is a domain result, not a fault. */
export type ProviderState =
  | "OK"
  | "NOT_FOUND"
  | "NOT_APPLICABLE"
  | "UNSUPPORTED"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "INVALID_CONFIGURATION"
  | "ERROR";

export type MarketProviderId = "dexscreener" | "geckoterminal";

export interface MarketFetch {
  provider: MarketProviderId;
  state: ProviderState;
  /** Present only when state is OK. */
  snapshot: MarketSnapshot | null;
}

export interface MarketProvider {
  id: MarketProviderId;
  fetchTokenMarket(tokenAddress: string): Promise<MarketFetch>;
}

export function marketRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.MARKET_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 8_000;
}

export const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
