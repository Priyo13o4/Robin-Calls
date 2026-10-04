import type { TokenMarketData } from "./types";

/** A stored RWA quote older than this is display-only until a live refresh answers. */
export const RWA_MARKET_MAX_AGE_MS = 5 * 60_000;

export function isMarketSnapshotFresh(
  timestamp: string | Date | null | undefined,
  now = Date.now(),
  maxAgeMs = RWA_MARKET_MAX_AGE_MS,
): boolean {
  if (!timestamp) return false;
  const parsed = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
  return Number.isFinite(parsed) && parsed <= now && now - parsed <= maxAgeMs;
}

/** A client quote is live for at most two polling windows after it was fetched. */
export function hasFreshTerminalQuote(
  timestamp: number | null | undefined,
  now: number,
  refreshMs: number,
): boolean {
  return timestamp != null && Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= refreshMs * 2;
}

/** Launch-feed estimates are not pool quotes. Keep identity when the provider cannot answer. */
export async function resolveTerminalLaunchMarket(
  initial: TokenMarketData,
  load: (address: string) => Promise<TokenMarketData>,
): Promise<TokenMarketData> {
  if (initial.isBondingCurve) return initial;
  try {
    const merged = mergeLiveMarketData(initial, await load(initial.address));
    if (merged) return merged;
  } catch {
    // Unknown market data must not become an estimated executable price.
  }
  return {
    ...initial,
    priceUsd: NaN, priceEth: NaN, priceQuote: null,
    fdv: NaN, marketCap: NaN, liquidityUsd: NaN, volume24h: NaN,
    txns24h: { total: NaN, buys: NaN, sells: NaN },
    priceChange: { m5: NaN, h1: NaN, h6: NaN, h24: NaN },
    timeframeMetrics: undefined,
    pooled: { baseAmount: NaN, baseUsd: NaN, quoteAmount: NaN, quoteUsd: NaN },
  };
}

/** Never replace known terminal data with a zero/invalid DexScreener fallback. */
export function mergeLiveMarketData(
  current: TokenMarketData,
  updated: TokenMarketData,
): TokenMarketData | null {
  if (updated.address.toLowerCase() !== current.address.toLowerCase()) return null;
  if (!Number.isFinite(updated.priceUsd) || updated.priceUsd <= 0) return null;
  const hasNewPair = Boolean(updated.pairAddress && updated.pairAddress !== current.pairAddress);
  return {
    ...current,
    priceUsd: updated.priceUsd,
    priceQuote: hasNewPair
      ? (Number.isFinite(updated.priceQuote) ? updated.priceQuote : null)
      : Number.isFinite(updated.priceQuote) && (updated.priceQuote ?? 0) > 0 ? updated.priceQuote : current.priceQuote,
    priceEth: Number.isFinite(updated.priceEth) && updated.priceEth > 0 ? updated.priceEth : current.priceEth,
    fdv: updated.fdv,
    marketCap: updated.marketCap,
    socials: { ...current.socials, ...Object.fromEntries(Object.entries(updated.socials).filter(([, value]) => Boolean(value))) },
    avatarUrl: updated.avatarUrl || current.avatarUrl,
    headerUrl: updated.headerUrl || current.headerUrl,
    ...(updated.pairAddress ? {
      pairAddress: updated.pairAddress,
      pairSymbol: updated.pairSymbol,
      baseToken: updated.baseToken,
      quoteToken: updated.quoteToken,
      venue: updated.venue,
    } : {}),
    liquidityUsd: Number.isFinite(updated.liquidityUsd) && updated.liquidityUsd >= 0 ? updated.liquidityUsd : current.liquidityUsd,
    volume24h: Number.isFinite(updated.volume24h) && updated.volume24h >= 0 ? updated.volume24h : current.volume24h,
    txns24h: updated.txns24h,
    priceChange: updated.priceChange,
    timeframeMetrics: updated.timeframeMetrics || current.timeframeMetrics,
    pooled: updated.pooled || current.pooled,
  };
}
