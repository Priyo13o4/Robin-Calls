import { reportError } from "../observability/reporter";
import type { MarketSnapshot } from "../types";
import {
  marketRequestTimeoutMs,
  num,
  type MarketFetch,
  type MarketProvider,
} from "./provider";

/**
 * DexScreener adapter (PRD §11.8) — the point-in-time scan provider.
 * `GET /token-pairs/v1/{chain}/{tokenAddress}` returns every pair for the
 * token; we keep pairs where the scanned token is the BASE token (its price
 * and liquidity describe the token, not its counter-asset) and select the
 * deepest by USD liquidity.
 *
 * Rate limit: 300 req/min was the figure this integration was sized against, but
 * DexScreener no longer publishes it for these paths (the OpenAPI include is not
 * fetchable) and every limit they DO publish reads 60 req/min — including
 * `/orders/v1/`, which `fetchTokenPromotion` calls. Treat 429 as the authority,
 * not the number. One retry with backoff on 429/5xx keeps a blip from degrading
 * a scan without hammering the API.
 */

interface DexScreenerPair {
  chainId?: string;
  dexId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { m5?: number | null; h1?: number | null; h6?: number | null; h24?: number | null };
  txns?: { h24?: { buys?: number | null; sells?: number | null } };
  volume?: { h24?: number | null };
  liquidity?: { usd?: number | null; base?: number | null; quote?: number | null };
  fdv?: number | null;
  marketCap?: number | null;
  /** Epoch milliseconds. */
  pairCreatedAt?: number | null;
  /** Active paid DexScreener boosts. Token-level, repeated on each pair row. */
  boosts?: { active?: number | null };
}

function baseUrl(): string {
  return process.env.DEXSCREENER_BASE_URL ?? "https://api.dexscreener.com";
}

function chainSlug(): string {
  return process.env.DEXSCREENER_CHAIN_ID ?? "robinhood";
}

/**
 * L155: the counter-asset side of a pair, `usd − base × priceUsd` (base is the scanned
 * token on every pair `selectPair` keeps). null = not computable; 0 is a real answer.
 */
export function computeLiquidityQuoteUsd(
  usd: number | null | undefined,
  base: number | null | undefined,
  priceUsd: number | null | undefined
): number | null {
  if (
    usd == null ||
    base == null ||
    priceUsd == null ||
    !Number.isFinite(usd) ||
    !Number.isFinite(base) ||
    !Number.isFinite(priceUsd)
  ) {
    return null;
  }
  const rawQuote = usd - base * priceUsd;
  if (!Number.isFinite(rawQuote)) return null;
  if (rawQuote <= 0) return 0;
  if (rawQuote >= usd) return usd;
  return rawQuote;
}

function toSnapshot(pair: DexScreenerPair): MarketSnapshot {
  const priceUsd = num(pair.priceUsd);
  const liquidityUsd = num(pair.liquidity?.usd);
  const base = num(pair.liquidity?.base);
  return {
    priceUsd,
    liquidityUsd,
    liquidityQuoteUsd: computeLiquidityQuoteUsd(liquidityUsd, base, priceUsd),
    liquidityQuoteSymbol: pair.quoteToken?.symbol ?? null,
    volume24hUsd: num(pair.volume?.h24),
    buys24h: pair.txns?.h24?.buys ?? null,
    sells24h: pair.txns?.h24?.sells ?? null,
    // DexScreener does not expose unique-trader counts (§16.3a): the wash
    // check degrades to turnover-only on these rows and says so.
    buyers24h: null,
    sellers24h: null,
    fdvUsd: num(pair.fdv ?? pair.marketCap),
    poolAddress: pair.pairAddress ?? null,
    poolDexId: pair.dexId ?? null,
    poolCreatedAt: pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
    priceChangeH1: num(pair.priceChange?.h1),
  };
}

/**
 * L155: depth a seller can use, `min(TVL, 2 × quote side)`. A balanced pool keeps its
 * TVL, so thresholds calibrated on TVL still hold; an unknown quote side falls back to TVL.
 */
export function computeEffectiveLiquidityDepth(
  liquidityUsd: number | null | undefined,
  quoteSideUsd: number | null | undefined,
): number | null {
  if (liquidityUsd == null || !Number.isFinite(liquidityUsd)) return null;
  if (quoteSideUsd != null && Number.isFinite(quoteSideUsd)) {
    return Math.min(liquidityUsd, 2 * quoteSideUsd);
  }
  return liquidityUsd;
}

/** Stored on every verdict. Ranked by depth first, so only a run of emptied pools this long could exhaust it. */
const OTHER_POOLS_KEPT = 10;

function pairEffectiveDepth(p: DexScreenerPair): number {
  const usd = num(p.liquidity?.usd);
  const quote = computeLiquidityQuoteUsd(usd, num(p.liquidity?.base), num(p.priceUsd));
  return computeEffectiveLiquidityDepth(usd, quote) ?? 0;
}

/**
 * Deepest base-token pair wins; a provider's "best pool" choice is not ours.
 * Ranked by effective depth, not TVL (§8 #18): ARROW's $1.83M pool held 0.86 WETH
 * beside a real $219K pool, and TVL ranking graded the token on the one-sided one.
 */
export function selectPair(
  pairs: DexScreenerPair[],
  tokenAddress: string
): DexScreenerPair | null {
  const token = tokenAddress.toLowerCase();
  const basePairs = pairs.filter(
    (p) => p.baseToken?.address?.toLowerCase() === token
  );
  if (basePairs.length === 0) return null;
  return basePairs.reduce((deepest, p) =>
    pairEffectiveDepth(p) > pairEffectiveDepth(deepest) ? p : deepest
  );
}

/**
 * Monitoring pair selection (§11.8): the pinned pool wins when the provider
 * still returns it — a provider changing its "best pool" must never register
 * as a liquidity drain. Fall back to deepest only when the pin is absent.
 */
export function selectMonitoringPair(
  pairs: DexScreenerPair[],
  tokenAddress: string,
  pinnedPoolAddress: string | null
): DexScreenerPair | null {
  if (pinnedPoolAddress) {
    const pinned = pairs.find(
      (p) => p.pairAddress?.toLowerCase() === pinnedPoolAddress.toLowerCase()
    );
    if (pinned) return pinned;
  }
  return selectPair(pairs, tokenAddress);
}

/** Snapshot mapper shared with the monitoring job. */
export function pairToSnapshot(pair: DexScreenerPair): MarketSnapshot {
  return toSnapshot(pair);
}

/**
 * Background-job batch fetch (§11.8): up to 30 token addresses in ONE request
 * via `GET /tokens/v1/{chain}/{addr1,addr2,…}`. Returns every pair for every
 * requested token; callers group by `baseToken.address`.
 *
 * `revalidateSeconds` is not a tuning knob. `cache: "no-store"` is revalidate 0,
 * and a revalidate-0 fetch inside a statically prerendered page makes Next throw
 * "Page changed from static to dynamic at runtime" — it then DISCARDS every
 * regeneration and serves the build-time prerender forever. That build has no
 * DATABASE_URL, so the landing page froze on an all-zero snapshot. A caller
 * rendering an ISR page must pass its own revalidate window; jobs pass nothing
 * and keep no-store.
 */
export async function fetchTokenPairsBatch(
  tokenAddresses: string[],
  revalidateSeconds?: number
): Promise<{ ok: boolean; status: number | string; pairs: DexScreenerPair[] }> {
  if (tokenAddresses.length === 0) return { ok: true, status: 200, pairs: [] };
  if (tokenAddresses.length > 30) {
    throw new Error(`DexScreener batch is capped at 30 addresses, got ${tokenAddresses.length}`);
  }
  const joined = tokenAddresses.map((a) => a.toLowerCase()).join(",");
  try {
    const res = await fetch(`${baseUrl()}/tokens/v1/${chainSlug()}/${joined}`, {
      headers: { accept: "application/json" },
      ...(revalidateSeconds == null
        ? { cache: "no-store" as const }
        : { next: { revalidate: revalidateSeconds } }),
      signal: AbortSignal.timeout(marketRequestTimeoutMs()),
    });
    if (!res.ok) return { ok: false, status: res.status, pairs: [] };
    const body = (await res.json()) as unknown;
    return { ok: true, status: res.status, pairs: Array.isArray(body) ? body : [] };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, status: timeout ? "timeout" : "network", pairs: [] };
  }
}

export type { DexScreenerPair };

/**
 * Paid-visibility signals for one token (the `paid_promotion` check, v1.9).
 *
 * Two independent reads, each nullable so the check can tell "no promotion"
 * apart from "couldn't look":
 * - `activeBoosts` — DexScreener boosts currently running. Token-level, but
 *   only exposed on pair rows, so we take the MAX across pairs (each row
 *   repeats the same token-level counter; summing would multiply it).
 * - `paidOrders` — paid listing orders (tokenProfile, tokenAd, trendingBarAd,
 *   communityTakeover) from the orders endpoint. 404 here is a domain answer:
 *   the token has simply never bought anything.
 */
export interface PromotionData {
  activeBoosts: number | null;
  paidOrders: { type: string; status: string }[] | null;
}

export async function fetchTokenPromotion(tokenAddress: string): Promise<PromotionData> {
  const token = tokenAddress.toLowerCase();

  const boostsPromise = (async (): Promise<number | null> => {
    const attempt = await requestPairs(token);
    if (attempt.pairs === null) return null; // unreadable, never "zero"
    const basePairs = attempt.pairs.filter(
      (p) => p.baseToken?.address?.toLowerCase() === token
    );
    return basePairs.reduce((max, p) => Math.max(max, p.boosts?.active ?? 0), 0);
  })();

  const ordersPromise = (async (): Promise<PromotionData["paidOrders"]> => {
    try {
      const res = await fetch(`${baseUrl()}/orders/v1/${chainSlug()}/${token}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(marketRequestTimeoutMs()),
      });
      if (res.status === 404) return []; // no orders ever placed — a real answer
      if (!res.ok) return null;
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) return null;
      return body
        .filter((o): o is { type?: string; status?: string } => !!o && typeof o === "object")
        .map((o) => ({ type: o.type ?? "unknown", status: o.status ?? "unknown" }));
    } catch {
      return null;
    }
  })();

  const [activeBoosts, paidOrders] = await Promise.all([boostsPromise, ordersPromise]);
  return { activeBoosts, paidOrders };
}

async function requestPairs(
  tokenAddress: string
): Promise<{ status: number | "timeout" | "network"; pairs: DexScreenerPair[] | null }> {
  try {
    const res = await fetch(
      `${baseUrl()}/token-pairs/v1/${chainSlug()}/${tokenAddress.toLowerCase()}`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(marketRequestTimeoutMs()),
      }
    );
    if (!res.ok) return { status: res.status, pairs: null };
    const body = (await res.json()) as unknown;
    return { status: res.status, pairs: Array.isArray(body) ? body : null };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { status: timeout ? "timeout" : "network", pairs: null };
  }
}

export const dexScreenerProvider: MarketProvider = {
  id: "dexscreener",

  async fetchTokenMarket(tokenAddress: string): Promise<MarketFetch> {
    let attempt = await requestPairs(tokenAddress);
    const retryable =
      attempt.status === 429 ||
      attempt.status === "timeout" ||
      attempt.status === "network" ||
      (typeof attempt.status === "number" && attempt.status >= 500);
    if (attempt.pairs === null && retryable) {
      await new Promise((r) => setTimeout(r, 400 + Math.floor(Math.random() * 400)));
      attempt = await requestPairs(tokenAddress);
    }

    if (attempt.pairs === null) {
      const state =
        attempt.status === 429
          ? "RATE_LIMITED"
          : attempt.status === "timeout"
            ? "TIMEOUT"
            : "ERROR";
      await reportError({
        code:
          state === "RATE_LIMITED"
            ? "RC_MARKET_RATE_LIMITED"
            : state === "TIMEOUT"
              ? "RC_MARKET_TIMEOUT"
              : "RC_MARKET_UNAVAILABLE",
        message: `DexScreener token-pairs request failed (${attempt.status})`,
        operation: "dexscreener.fetchTokenMarket",
        providerId: "dexscreener",
        tokenAddress,
      });
      return { provider: "dexscreener", state, snapshot: null };
    }

    const pair = selectPair(attempt.pairs, tokenAddress);
    if (!pair) return { provider: "dexscreener", state: "NOT_FOUND", snapshot: null };
    const token = tokenAddress.toLowerCase();
    const otherPools = attempt.pairs
      .filter((p) => p !== pair && p.pairAddress && p.baseToken?.address?.toLowerCase() === token)
      .sort((a, b) => pairEffectiveDepth(b) - pairEffectiveDepth(a))
      .slice(0, OTHER_POOLS_KEPT)
      .map((p) => {
        const s = toSnapshot(p);
        return { poolAddress: p.pairAddress!, liquidityUsd: s.liquidityUsd, liquidityQuoteUsd: s.liquidityQuoteUsd ?? null };
      });
    return { provider: "dexscreener", state: "OK", snapshot: { ...toSnapshot(pair), otherPools } };
  },
};
