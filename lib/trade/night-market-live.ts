import type { TokenMarketData } from "./types";

/**
 * A live pair observation replaces the stored launch snapshot without changing launch provenance.
 * The stored row is minutes to hours old and carries a 1h change only, so it cannot show 5M or 1D.
 * A live reading with no liquidity never overwrites it: the server confirms drains against the chain.
 */
export function mergeLiveLaunchMarket(
  launch: TokenMarketData,
  live: TokenMarketData | null | undefined,
): TokenMarketData {
  if (launch.isBondingCurve || launch.liquidityPulled) return launch;
  if (!live || live.address.toLowerCase() !== launch.address.toLowerCase()) return launch;
  if (!Number.isFinite(live.liquidityUsd) || live.liquidityUsd <= 0 || !live.pairAddress) return launch;
  return {
    ...launch,
    pairAddress: live.pairAddress,
    pairSymbol: live.pairSymbol,
    quoteToken: live.quoteToken,
    priceUsd: live.priceUsd,
    priceEth: live.priceEth,
    priceQuote: live.priceQuote,
    fdv: live.fdv,
    marketCap: live.marketCap,
    liquidityUsd: live.liquidityUsd,
    volume24h: live.volume24h,
    txns24h: live.txns24h,
    volumeBreakdown24h: live.volumeBreakdown24h,
    traders24h: live.traders24h,
    priceChange: live.priceChange,
    timeframeMetrics: live.timeframeMetrics,
    pooled: live.pooled,
  };
}
