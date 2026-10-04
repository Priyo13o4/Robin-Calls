import { BOOST_BONUS } from "./trending";
import { COMMON_BASES_BY_CHAIN, type TimeframePeriod, type TokenMarketData } from "./types";
import { ROBINHOOD_CHAIN_ID } from "../config/chain";

/** WETH, ETH, USDG…: the other side of most pairs, busy on every chart, never "trending". */
const BASES = new Set([
  "0x0000000000000000000000000000000000000000",
  ...(COMMON_BASES_BY_CHAIN[ROBINHOOD_CHAIN_ID] ?? []).map((t) => t.address.toLowerCase()),
]);

/**
 * Night Market pair filters and the per-window trending score. Every filter ANDs with the others.
 * A value nobody measured (NaN) never satisfies a threshold: "at least $5K" is not proven by
 * a missing number.
 */
export interface MarketFilters {
  /** Pool age cap in minutes; null = any age. */
  maxAgeMin: number | null;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  /** Up at least PUMP_MIN_PCT in 5m on at least PUMP_MIN_TRADES trades. */
  pumping: boolean;
  /** More buys than sells in the last hour. */
  buyPressure: boolean;
  /** Copycat launches share a name; keep only the most active one. */
  onePerName: boolean;
  venues: Venue[];
}

export type Venue = "v2" | "v3" | "v4" | "other";

export const PUMP_MIN_PCT = 5;
export const PUMP_MIN_TRADES = 5;
/** Below this a pool is dust: it can post any percentage on a few dollars. */
export const DUST_LIQUIDITY_USD = 1_000;

export const NO_FILTERS: MarketFilters = {
  maxAgeMin: null, minLiquidityUsd: 0, minVolume24hUsd: 0, pumping: false, buyPressure: false, onePerName: false, venues: [],
};

export const PRESETS = {
  freshPumps: { ...NO_FILTERS, maxAgeMin: 360, minLiquidityUsd: 5_000, pumping: true, onePerName: true },
  newLaunches: { ...NO_FILTERS, maxAgeMin: 60, minLiquidityUsd: 1_000, onePerName: true },
} satisfies Record<string, MarketFilters>;

export function activeFilterCount(f: MarketFilters): number {
  return [f.maxAgeMin !== null, f.minLiquidityUsd > 0, f.minVolume24hUsd > 0, f.pumping, f.buyPressure, f.onePerName, f.venues.length > 0]
    .filter(Boolean).length;
}

export function venueOf(t: Pick<TokenMarketData, "dexVersion">): Venue {
  const v = (t.dexVersion ?? "").toLowerCase();
  return v === "v2" || v === "v3" || v === "v4" ? v : "other";
}

const at = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);

function windowOf(t: TokenMarketData, tf: TimeframePeriod) {
  return t.timeframeMetrics?.[tf] ?? null;
}

/**
 * Activity in the chosen window, not price change alone: ranking by % put a $10 dust pool that
 * doubled above a $1M pool. Momentum and buy pressure scale activity; they never replace it.
 */
export function trendingScoreFor(t: TokenMarketData, tf: TimeframePeriod): number {
  if (BASES.has(t.address.toLowerCase())) return 0;
  const w = windowOf(t, tf);
  const volume = at(w?.volume.totalUsd) ?? (tf === "24h" ? at(t.volume24h) ?? 0 : 0);
  const txns = at(w?.txns.total) ?? (tf === "24h" ? at(t.txns24h.total) ?? 0 : 0);
  const buys = at(w?.txns.buys);
  const sells = at(w?.txns.sells);
  const change = at(tf === "5m" ? t.priceChange.m5 : tf === "1h" ? t.priceChange.h1 : tf === "6h" ? t.priceChange.h6 : t.priceChange.h24) ?? 0;
  let score = volume * 2 + txns * 50;
  score *= 1 + Math.max(-90, Math.min(300, change)) / 300; // 0.7x at -90%, 2x at +300%
  if (buys !== null && sells !== null && buys + sells > 0) score *= 0.5 + buys / (buys + sells); // 0.5x..1.5x
  if ((at(t.liquidityUsd) ?? 0) < DUST_LIQUIDITY_USD) score *= 0.05;
  if ((t.boostScore ?? 0) > 0) score *= 1 + BOOST_BONUS;
  return score;
}

export function applyMarketFilters(tokens: readonly TokenMarketData[], f: MarketFilters, nowMs: number): TokenMarketData[] {
  const out = tokens.filter((t) => {
    if (f.maxAgeMin !== null) {
      const created = at(t.createdAtMs ?? undefined);
      if (created === null || nowMs - created > f.maxAgeMin * 60_000) return false;
    }
    if (f.minLiquidityUsd > 0 && !((at(t.liquidityUsd) ?? -1) >= f.minLiquidityUsd)) return false;
    if (f.minVolume24hUsd > 0 && !((at(t.volume24h) ?? -1) >= f.minVolume24hUsd)) return false;
    if (f.pumping) {
      const m5 = at(t.priceChange.m5);
      const trades = at(windowOf(t, "5m")?.txns.total);
      if (m5 === null || trades === null || m5 < PUMP_MIN_PCT || trades < PUMP_MIN_TRADES) return false;
    }
    if (f.buyPressure) {
      const w = windowOf(t, "1h");
      const buys = at(w?.txns.buys);
      const sells = at(w?.txns.sells);
      if (buys === null || sells === null || buys <= sells) return false;
    }
    if (f.venues.length && !f.venues.includes(venueOf(t))) return false;
    return true;
  });
  if (!f.onePerName) return out;
  const best = new Map<string, TokenMarketData>();
  for (const t of out) {
    const key = `${t.name.trim().toLowerCase()}|${t.symbol.trim().toLowerCase()}`;
    const cur = best.get(key);
    if (!cur || trendingScoreFor(t, "24h") > trendingScoreFor(cur, "24h")) best.set(key, t);
  }
  const keep = new Set(best.values());
  return out.filter((t) => keep.has(t));
}

/** Newest first; an unknown creation time sorts last, never first. */
export const byNewest = (a: TokenMarketData, b: TokenMarketData) =>
  (at(b.createdAtMs ?? undefined) ?? -Infinity) - (at(a.createdAtMs ?? undefined) ?? -Infinity);

/** Sort key for a possibly unknown number: unknown sinks to the bottom in either direction. */
export function compareKnown(a: number, b: number, dir: "asc" | "desc"): number {
  const fa = Number.isFinite(a), fb = Number.isFinite(b);
  if (!fa || !fb) return fa === fb ? 0 : fa ? -1 : 1;
  return dir === "desc" ? b - a : a - b;
}

/** The trade page's TRENDING bar: most active in the last hour, no dust, one per name. */
export function pickTrending(pairs: readonly TokenMarketData[], n = 5, nowMs = Date.now()): TokenMarketData[] {
  const ranked = applyMarketFilters(pairs, { ...NO_FILTERS, minLiquidityUsd: DUST_LIQUIDITY_USD, onePerName: true }, nowMs)
    .map((t) => ({ t, score: trendingScoreFor(t, "1h") }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: TokenMarketData[] = [];
  for (const { t } of ranked) {
    if (seen.has(t.address.toLowerCase())) continue;
    seen.add(t.address.toLowerCase());
    out.push(t);
    if (out.length === n) break;
  }
  return out;
}
