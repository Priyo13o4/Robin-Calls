import { recordProviderState } from "../observability/context";
import type { MarketSnapshot } from "../types";
import { dexScreenerProvider } from "./dexscreener";
import { geckoTerminalProvider } from "./geckoterminal";
import type { MarketFetch, MarketProvider, MarketProviderId } from "./provider";

/**
 * Market-provider registry (PRD §11.8): scanner code asks for "the scan
 * market provider" and never reads provider URLs or slugs directly.
 *
 * The scan provider is DexScreener: the shadow comparison held (0 divergences,
 * 2026-07-22) and it is the only one of the two that states an orientation we
 * can check — `selectPair` keeps a pair only where the scanned token is the
 * base, so a snapshot is always ABOUT the token. GeckoTerminal picks a side by
 * its own unpublished rule and has no such guarantee, which is why it must not
 * be the default (§8 #20): the env pin is the part that can go missing.
 * With ENABLE_MARKET_SHADOW_COMPARE=true every fresh scan also queries the
 * non-primary provider, records its §11.6 state, and logs one structured
 * comparison line — the shadow can never affect the scan result.
 */

const PROVIDERS: Record<MarketProviderId, MarketProvider> = {
  dexscreener: dexScreenerProvider,
  geckoterminal: geckoTerminalProvider,
};

/**
 * Hybrid wash-density enrichment (Wave C part 2): DexScreener does not expose
 * unique buyers/sellers, so with it as the scan provider the §15.4 wash check
 * would lose its trade-density signal. When a DexScreener snapshot looks
 * turnover-suspicious we spend ONE GeckoTerminal call to recover buyers/sellers
 * — full FAIL signal preserved, GT quota touched only for the tokens that
 * warrant it. Thresholds mirror WASH_THRESHOLDS' WARN tier (kept local so the
 * market layer stays free of the scanner import).
 */
const ENRICH_MIN_LIQUIDITY_USD = 5_000;
const ENRICH_TURNOVER_YOUNG = 10;
const ENRICH_TURNOVER_MATURE = 15;
const ENRICH_YOUNG_POOL_HOURS = 72;

/** Worth a GT call only for a token whose turnover already smells like wash. */
export function shouldEnrichTraderData(s: MarketSnapshot | null): boolean {
  if (!s) return false;
  if (s.buyers24h != null && s.sellers24h != null) return false; // already have it
  const liq = s.liquidityUsd;
  const vol = s.volume24hUsd;
  if (liq == null || liq < ENRICH_MIN_LIQUIDITY_USD || vol == null) return false;
  const turnover = vol / liq;
  const ageHours = s.poolCreatedAt ? (Date.now() - Date.parse(s.poolCreatedAt)) / 36e5 : null;
  const young = ageHours != null && ageHours <= ENRICH_YOUNG_POOL_HOURS;
  return turnover >= (young ? ENRICH_TURNOVER_YOUNG : ENRICH_TURNOVER_MATURE);
}

/** Fill only the missing trader/side counts from a second source; keep the rest. */
export function mergeTraderCounts(
  base: MarketFetch,
  traderSource: MarketSnapshot | null
): MarketFetch {
  if (!base.snapshot || !traderSource) return base;
  if (base.snapshot.buyers24h != null && base.snapshot.sellers24h != null) return base;
  return {
    ...base,
    snapshot: {
      ...base.snapshot,
      buyers24h: base.snapshot.buyers24h ?? traderSource.buyers24h,
      sellers24h: base.snapshot.sellers24h ?? traderSource.sellers24h,
      buys24h: base.snapshot.buys24h ?? traderSource.buys24h,
      sells24h: base.snapshot.sells24h ?? traderSource.sells24h,
    },
  };
}

/**
 * Enrich a DexScreener result with GeckoTerminal trader counts when suspicious.
 * Best-effort: any GT failure leaves the snapshot untouched, so the wash check
 * simply degrades to a turnover-only WARN (§15.4) — never a scan failure.
 */
async function enrichWithTraderCounts(
  result: MarketFetch,
  tokenAddress: string
): Promise<MarketFetch> {
  if (result.provider !== "dexscreener" || result.state !== "OK") return result;
  if (!shouldEnrichTraderData(result.snapshot)) return result;
  const gt = await PROVIDERS.geckoterminal.fetchTokenMarket(tokenAddress).catch(() => null);
  if (!gt) return result;
  recordProviderState("market:geckoterminal:enrich", gt.state);
  if (gt.state !== "OK") return result;
  return mergeTraderCounts(result, gt.snapshot);
}

/**
 * Default is the SAFE branch, not the historical one. Opting into GeckoTerminal
 * is still possible, but it must be deliberate — an unset var must never be the
 * thing that decides whether we publish the quote asset's price.
 */
export function scanMarketProviderId(): MarketProviderId {
  const configured = process.env.MARKET_SCAN_PROVIDER;
  return configured === "geckoterminal" ? "geckoterminal" : "dexscreener";
}

function shadowCompareEnabled(): boolean {
  const v = process.env.ENABLE_MARKET_SHADOW_COMPARE;
  return v === "true" || v === "1" || v === "yes";
}

interface ShadowView {
  state: string;
  poolAddress: string | null;
  liquidityUsd: number | null;
  priceUsd: number | null;
}

function viewOf(fetch: MarketFetch): ShadowView {
  return {
    state: fetch.state,
    poolAddress: fetch.snapshot?.poolAddress?.toLowerCase() ?? null,
    liquidityUsd: fetch.snapshot?.liquidityUsd ?? null,
    priceUsd: fetch.snapshot?.priceUsd ?? null,
  };
}

/** Divergent when the providers disagree on availability, pool, or ±25% depth. */
export function shadowDiverges(primary: ShadowView, shadow: ShadowView): boolean {
  if (primary.state !== shadow.state) return true;
  if (primary.poolAddress !== shadow.poolAddress) return true;
  if (primary.liquidityUsd !== null && shadow.liquidityUsd !== null) {
    const reference = Math.max(Math.abs(primary.liquidityUsd), 1);
    return Math.abs(primary.liquidityUsd - shadow.liquidityUsd) / reference > 0.25;
  }
  return primary.liquidityUsd !== shadow.liquidityUsd;
}

/** Point-in-time market data for a fresh scan, via the configured provider. */
export async function fetchScanMarket(tokenAddress: string): Promise<MarketFetch> {
  const primaryId = scanMarketProviderId();
  const primary = PROVIDERS[primaryId];

  if (!shadowCompareEnabled()) {
    const result = await primary.fetchTokenMarket(tokenAddress);
    recordProviderState(`market:${result.provider}`, result.state);
    return enrichWithTraderCounts(result, tokenAddress);
  }

  const shadowId: MarketProviderId =
    primaryId === "geckoterminal" ? "dexscreener" : "geckoterminal";
  const [result, shadow] = await Promise.all([
    primary.fetchTokenMarket(tokenAddress),
    PROVIDERS[shadowId].fetchTokenMarket(tokenAddress).catch(() => null),
  ]);
  recordProviderState(`market:${result.provider}`, result.state);
  if (shadow) {
    recordProviderState(`market:${shadow.provider}:shadow`, shadow.state);
    const primaryView = viewOf(result);
    const shadowView = viewOf(shadow);
    console.log(
      "[market-shadow]",
      JSON.stringify({
        token: tokenAddress.toLowerCase(),
        primary: { provider: result.provider, ...primaryView },
        shadow: { provider: shadow.provider, ...shadowView },
        divergent: shadowDiverges(primaryView, shadowView),
      })
    );
  }

  // In shadow mode the GeckoTerminal call already happened — reuse it for
  // trader-count enrichment instead of spending a second GT request.
  if (
    result.provider === "dexscreener" &&
    result.state === "OK" &&
    shadow?.provider === "geckoterminal" &&
    shadow.state === "OK" &&
    shouldEnrichTraderData(result.snapshot)
  ) {
    return mergeTraderCounts(result, shadow.snapshot);
  }
  return enrichWithTraderCounts(result, tokenAddress);
}
