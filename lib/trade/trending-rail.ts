import { trendingScoreFor } from "./market-filters";
import type { TokenMarketData } from "./types";

/**
 * The Night Market rail: pairs trading now, not pairs that merely exist.
 * A pair qualifies on depth AND recent activity, and is not a tokenized stock. A missing number fails the gate
 * rather than passing it (§4: unknown is not "enough").
 */
export const TRENDING_RULES = {
  minLiquidityUsd: 5_000,
  minTxns1h: 20,
  /** Used only when DexScreener sent no 1h window for the pair. */
  minVolume24hUsd: 10_000,
  max: 12,
} as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function isTrending(t: TokenMarketData): boolean {
  // Tokenized equities trade all day and have their own RWA pages; the rail is for launches.
  if (t.isStock) return false;
  const liq = num(t.liquidityUsd);
  if (liq === null || liq < TRENDING_RULES.minLiquidityUsd) return false;
  const txns1h = num(t.timeframeMetrics?.["1h"]?.txns.total);
  if (txns1h !== null) return txns1h >= TRENDING_RULES.minTxns1h;
  const vol = num(t.volume24h);
  return vol !== null && vol >= TRENDING_RULES.minVolume24hUsd;
}

/** Best-scoring pair per token, ranked by the same 1h score the table's Trending sort uses. */
export function pickTrendingPairs(pairs: readonly TokenMarketData[]): TokenMarketData[] {
  const best = new Map<string, { t: TokenMarketData; score: number }>();
  for (const t of pairs) {
    if (!isTrending(t)) continue;
    const score = trendingScoreFor(t, "1h");
    if (!(score > 0)) continue; // base assets (ETH, USDG) score 0
    const key = t.address.toLowerCase();
    const cur = best.get(key);
    if (!cur || score > cur.score) best.set(key, { t, score });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, TRENDING_RULES.max)
    .map((x) => x.t);
}
