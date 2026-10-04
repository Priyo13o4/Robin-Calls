import type { TokenMarketData } from "./types";

/**
 * Operator decision 2026-09-28: a boost is a badge plus a SMALL bonus. A flat 10% on the organic
 * score only breaks near-ties; it never scales with the amount paid, so a boost cannot buy rank
 * over a token with more real activity. The old `boost * 100_000` put every boost above all.
 */
export const BOOST_BONUS = 0.1;

type Trendable = Pick<TokenMarketData, "volume24h" | "boostScore"> & { txns24h: { total: number } };

export function trendingScore(t: Trendable): number {
  const organic = (t.volume24h || 0) * 2 + (t.txns24h?.total || 0) * 50;
  return (t.boostScore ?? 0) > 0 ? organic * (1 + BOOST_BONUS) : organic;
}

export const byTrending = (a: Trendable, b: Trendable) => trendingScore(b) - trendingScore(a);
