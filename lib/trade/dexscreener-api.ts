import {
  type TokenMarketData,
  dexPairToTokenMarketData,
  isStockToken,
} from "./types";
import { explorerWebUrl } from "@/lib/config/chain";

const DEXSCREENER_API_BASE = "https://api.dexscreener.com";
const ROBINHOOD_CHAIN_SLUG = "robinhood";

interface DexScreenerPairResponse {
  schemaVersion?: string;
  pairs?: Array<{
    chainId?: string;
    dexId?: string;
    url?: string;
    pairAddress?: string;
    baseToken?: { address?: string; name?: string; symbol?: string };
    quoteToken?: { address?: string; name?: string; symbol?: string };
    priceNative?: string;
    priceUsd?: string;
    txns?: {
      m5?: { buys?: number; sells?: number };
      h1?: { buys?: number; sells?: number };
      h6?: { buys?: number; sells?: number };
      h24?: { buys?: number; sells?: number };
    };
    volume?: {
      m5?: number;
      h1?: number;
      h6?: number;
      h24?: number;
    };
    priceChange?: {
      m5?: number;
      h1?: number;
      h6?: number;
      h24?: number;
    };
    liquidity?: {
      usd?: number;
      base?: number;
      quote?: number;
    };
    fdv?: number;
    marketCap?: number;
    pairCreatedAt?: number;
    info?: {
      imageUrl?: string;
      header?: string;
      openGraph?: string;
      websites?: Array<{ label?: string; url?: string }>;
      socials?: Array<{ type?: string; url?: string }>;
    };
  }>;
}

type DexScreenerPair = NonNullable<DexScreenerPairResponse["pairs"]>[number];

/** The pair endpoint has returned both shapes in practice; its documented field is `pairs`. */
function pairsFromPayload(payload: unknown): DexScreenerPair[] | null {
  const normalize = (values: unknown[]): DexScreenerPair[] | null => {
    const pairs = values.filter((value): value is DexScreenerPair => value !== null && typeof value === "object");
    return pairs.length === values.length ? pairs : null;
  };
  if (Array.isArray(payload)) return normalize(payload);
  if (!payload || typeof payload !== "object") return null;
  const data = payload as { pairs?: unknown; pair?: unknown };
  if (Array.isArray(data.pairs)) {
    const pairs = normalize(data.pairs);
    if (pairs === null || pairs.length > 0) return pairs;
  }
  if (data.pair && typeof data.pair === "object") return [data.pair as DexScreenerPair];
  if (Array.isArray(data.pairs)) return [];
  return null;
}

function isRobinhoodPair(pair: DexScreenerPair): boolean {
  return (pair.chainId ?? "").toLowerCase() === ROBINHOOD_CHAIN_SLUG;
}

function pairHasToken(pair: DexScreenerPair, address: string): boolean {
  const token = address.toLowerCase();
  return (pair.baseToken?.address ?? "").toLowerCase() === token ||
    (pair.quoteToken?.address ?? "").toLowerCase() === token;
}
 
/**
 * Search pairs on DexScreener for Robinhood Chain.
 */
export async function searchDexScreenerPairs(
  query: string = ROBINHOOD_CHAIN_SLUG
): Promise<NonNullable<DexScreenerPairResponse["pairs"]>> {
  try {
    if (Date.now() < rateLimitCooldownUntil) return [];
    const normQ = query.toLowerCase().trim();
    let pairs: NonNullable<DexScreenerPairResponse["pairs"]> = [];

    // 1. If query is a token address, ask the chain-scoped token-pairs endpoint.
    if (normQ.startsWith("0x") && normQ.length === 42) {
      try {
        const resToken = await fetch(
          `${DEXSCREENER_API_BASE}/token-pairs/v1/${ROBINHOOD_CHAIN_SLUG}/${normQ}`,
          {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (resToken.status === 429) rateLimitCooldownUntil = Date.now() + 60_000;
        if (resToken.ok) {
          const tokenPairs = (pairsFromPayload(await resToken.json()) ?? []).filter(
            (p) => isRobinhoodPair(p) && pairHasToken(p, normQ)
          );
          if (tokenPairs.length > 0) {
            pairs = tokenPairs;
          }
        }
      } catch {
        // Degrade safely
      }

      // If the token route yielded nothing, it may instead be a pair contract address.
      if (pairs.length === 0 && Date.now() >= rateLimitCooldownUntil) {
        try {
          const resPair = await fetch(
            `${DEXSCREENER_API_BASE}/latest/dex/pairs/${ROBINHOOD_CHAIN_SLUG}/${normQ}`,
            {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(4000),
            }
          );
          if (resPair.status === 429) rateLimitCooldownUntil = Date.now() + 60_000;
          if (resPair.ok) {
            pairs = (pairsFromPayload(await resPair.json()) ?? []).filter(
              (p) => isRobinhoodPair(p) && (p.pairAddress ?? "").toLowerCase() === normQ
            );
          }
        } catch {
          // Degrade safely
        }
      }
    } else if (normQ.startsWith("0x") && normQ.length === 66) {
      // 66-character Uniswap V4 Pool ID
      try {
        const resPair = await fetch(
          `${DEXSCREENER_API_BASE}/latest/dex/pairs/${ROBINHOOD_CHAIN_SLUG}/${normQ}`,
          {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (resPair.status === 429) rateLimitCooldownUntil = Date.now() + 60_000;
        if (resPair.ok) {
          pairs = (pairsFromPayload(await resPair.json()) ?? []).filter(
            (p) => isRobinhoodPair(p) && (p.pairAddress ?? "").toLowerCase() === normQ
          );
        }
      } catch {
        // Degrade safely
      }
    }

    // 2. If still empty (or it was a text search query like "cashcat"), use the search endpoint
    if (Date.now() < rateLimitCooldownUntil) return [];
    if (pairs.length === 0) {
      const fetchSearch = async (q: string) => {
        const res = await fetch(
          `${DEXSCREENER_API_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`,
          {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          }
        );
        if (res.status === 429) {
          rateLimitCooldownUntil = Date.now() + 60_000;
          return [];
        }
        if (!res.ok) return [];
        const data = (await res.json()) as DexScreenerPairResponse;
        return (data.pairs ?? []).filter((p) => isRobinhoodPair(p));
      };

      pairs = await fetchSearch(query);
      if (pairs.length === 0 && !normQ.includes("robinhood") && Date.now() >= rateLimitCooldownUntil) {
        pairs = await fetchSearch(`${query} robinhood`);
      }
    }

    // Prioritize exact pair address match if query was a pair address, then rank by active depth
    const exactPair = pairs.find((p) => (p.pairAddress ?? "").toLowerCase() === normQ);
    pairs.sort((a, b) => {
      if (exactPair) {
        if ((a.pairAddress ?? "").toLowerCase() === normQ) return -1;
        if ((b.pairAddress ?? "").toLowerCase() === normQ) return 1;
      }
      const scoreA = Number(a.liquidity?.usd ?? 0) * 2 + Number(a.volume?.h24 ?? 0);
      const scoreB = Number(b.liquidity?.usd ?? 0) * 2 + Number(b.volume?.h24 ?? 0);
      return scoreB - scoreA;
    });

    return pairs;
  } catch {
    return [];
  }
}

function createGenericTokenMarketData(address: string): TokenMarketData {
  const isStock = isStockToken(address, "TKN");
  const shortAddr = address.startsWith("0x") ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return {
    address,
    name: `Token ${shortAddr}`,
    symbol: "TOKEN",
    pairAddress: address,
    pairSymbol: "TOKEN / ETH",
    baseToken: { address, name: "Token", symbol: "TOKEN", decimals: 18 },
    quoteToken: {
      address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
    },
    venue: "Uniswap V4",
    isBondingCurve: false,
    isStock,
    priceUsd: 0,
    priceEth: 0,
    fdv: 0,
    marketCap: 0,
    liquidityUsd: 0,
    volume24h: 0,
    txns24h: { total: 0, buys: 0, sells: 0 },
    volumeBreakdown24h: { buyUsd: 0, sellUsd: 0 },
    traders24h: { total: 0, buyers: 0, sellers: 0 },
    priceChange: { m5: 0, h1: 0, h6: 0, h24: 0 },
    age: "Just now",
    rank: 999,
    socials: {
      explorer: `${explorerWebUrl}/token/${address}`,
    },
    pooled: { baseAmount: 0, baseUsd: 0, quoteAmount: 0, quoteUsd: 0 },
    auditVerdict: {
      score: 0,
      tier: "UNSCANNED",
      honeypotPass: false,
      mintable: false,
      liquidityLocked: false,
      lockedPct: 0,
    },
  };
}

// In-memory client/server cache with 30-second TTL
const cache = new Map<string, { data: TokenMarketData; expires: number }>();
const inFlightRequests = new Map<string, Promise<TokenMarketData>>();
const MARKET_CACHE_MAX_ENTRIES = 1024;

function rememberMarketData(key: string, data: TokenMarketData, ttlMs: number): void {
  const now = Date.now();
  for (const [cachedKey, entry] of cache) {
    if (entry.expires <= now) cache.delete(cachedKey);
  }
  cache.delete(key);
  while (cache.size >= MARKET_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  cache.set(key, { data, expires: now + ttlMs });
}

/** Test seams for the process-local cache; production callers should use the API. */
export function _resetDexScreenerApiCacheForTests(): void {
  cache.clear();
  inFlightRequests.clear();
  batchQueue = [];
  batchScheduled = false;
  rateLimitCooldownUntil = 0;
}

export function _dexScreenerApiCacheSizeForTests(): number {
  return cache.size;
}

// Rate-limit tracking: cooldown until timestamp if 429 encountered
let rateLimitCooldownUntil = 0;

/**
 * Direct multicall batch fetcher for DexScreener.
 * Batches up to 30 token addresses per chain-scoped DexScreener request.
 */
export async function batchGetMarketData(
  tokenAddresses: string[]
): Promise<Map<string, TokenMarketData>> {
  const result = new Map<string, TokenMarketData>();
  if (!tokenAddresses || tokenAddresses.length === 0) return result;

  const now = Date.now();
  const missing: string[] = [];

  for (const addr of tokenAddresses) {
    const norm = addr.toLowerCase().trim();
    const cached = cache.get(norm);
    if (cached && cached.expires > now) {
      result.set(norm, cached.data);
    } else {
      if (cached) cache.delete(norm);
      missing.push(norm);
    }
  }

  if (missing.length === 0) return result;

  // Respect 429 cooldown
  if (now < rateLimitCooldownUntil) {
    for (const addr of missing) {
      result.set(addr, createGenericTokenMarketData(addr));
    }
    return result;
  }

  // Chunk missing addresses into batches of 30 (DexScreener batch limit)
  const chunkSize = 30;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    const validAddrs = chunk.filter((a) => a.startsWith("0x") && a.length === 42);

    if (validAddrs.length === 0) {
      for (const a of chunk) {
        result.set(a, createGenericTokenMarketData(a));
      }
      continue;
    }

    try {
      const url = `${DEXSCREENER_API_BASE}/tokens/v1/${ROBINHOOD_CHAIN_SLUG}/${validAddrs.join(",")}`;
      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });

      if (res.status === 429) {
        // Enforce 60s cooldown
        rateLimitCooldownUntil = Date.now() + 60_000;
        break;
      }

      if (res.ok) {
        const rawPairs = pairsFromPayload(await res.json());
        // An unexpected successful payload is not evidence that a token has no market.
        if (!rawPairs) continue;

        // Index pairs by pair address. Token matches are checked against both sides below.
        const pairsByPairAddress = new Map<string, DexScreenerPair>();
        for (const pair of rawPairs) {
          const pairAddr = (pair.pairAddress ?? "").toLowerCase();
          if (pairAddr) {
            pairsByPairAddress.set(pairAddr, pair);
          }
        }

        for (const addr of validAddrs) {
          const exactPair = pairsByPairAddress.get(addr);
          const matchedPairs = rawPairs.filter((p) => isRobinhoodPair(p) && pairHasToken(p, addr));
          const tokenPairs = matchedPairs.filter((p) => (p.baseToken?.address ?? "").toLowerCase() === addr);
          const robinhoodPairs = tokenPairs;

          // Rank pairs by active depth (liquidity * 2 + 24h volume)
          robinhoodPairs.sort((a, b) => {
            const scoreA = Number(a.liquidity?.usd ?? 0) * 2 + Number(a.volume?.h24 ?? 0);
            const scoreB = Number(b.liquidity?.usd ?? 0) * 2 + Number(b.volume?.h24 ?? 0);
            return scoreB - scoreA;
          });

          // Exact pair address match wins; otherwise highest activity/liquidity pool.
          // No arbitrary USDG/quote filters overriding real active pools.
          const validExactPair = exactPair && isRobinhoodPair(exactPair) && pairHasToken(exactPair, addr)
            ? exactPair
            : null;
          const bestPair = validExactPair || robinhoodPairs[0];

          if (bestPair?.baseToken && (bestPair.baseToken.address ?? "").toLowerCase() === addr) {
            const marketData = dexPairToTokenMarketData(bestPair, 1);
            rememberMarketData(addr, marketData, 30_000);
            result.set(addr, marketData);
          } else if (rawPairs.some((p) => pairHasToken(p, addr))) {
            // A pair exists but the requested token is only its quote side; the
            // base-token converter cannot safely produce this token's price, or
            // the endpoint contradicted its requested chain. Neither is a no-pool answer.
            result.set(addr, createGenericTokenMarketData(addr));
          } else {
            const generic = createGenericTokenMarketData(addr);
            rememberMarketData(addr, generic, 15_000);
            result.set(addr, generic);
          }
        }
      }
    } catch {
      // Degrade gracefully
    }
  }

  // Populate any remaining missing tokens with generic fallbacks
  for (const addr of missing) {
    if (!result.has(addr)) {
      result.set(addr, createGenericTokenMarketData(addr));
    }
  }

  return result;
}

// Microtask coalescing queue: coalesces individual getMarketDataForToken calls into batch multicalls
interface QueueEntry {
  address: string;
  resolve: (data: TokenMarketData) => void;
}
let batchQueue: QueueEntry[] = [];
let batchScheduled = false;

function processBatchQueue() {
  const currentBatch = batchQueue;
  batchQueue = [];
  batchScheduled = false;

  const addresses = Array.from(new Set(currentBatch.map((e) => e.address)));
  batchGetMarketData(addresses).then((resultsMap) => {
    for (const entry of currentBatch) {
      const data = resultsMap.get(entry.address) ?? createGenericTokenMarketData(entry.address);
      entry.resolve(data);
    }
  }).catch(() => {
    for (const entry of currentBatch) {
      entry.resolve(createGenericTokenMarketData(entry.address));
    }
  });
}

/**
 * Fetch token market details by querying live DexScreener API with
 * multicall batching, single-flight deduplication, and 429 rate-limit protection.
 */
export async function getMarketDataForToken(
  tokenOrPairAddress: string
): Promise<TokenMarketData> {
  const normalized = tokenOrPairAddress.toLowerCase().trim();
  const now = Date.now();

  // 1. Check in-memory TTL cache
  const cached = cache.get(normalized);
  if (cached && cached.expires > now) {
    return cached.data;
  }
  if (cached) cache.delete(normalized);

  // 2. Check in-flight singleflight request
  const inFlight = inFlightRequests.get(normalized);
  if (inFlight) return inFlight;

  // 3. For standard 42-character addresses, coalesce into the token batch request.
  if (normalized.startsWith("0x") && normalized.length === 42) {
    const promise = new Promise<TokenMarketData>((resolve) => {
      batchQueue.push({ address: normalized, resolve });
      if (!batchScheduled) {
        batchScheduled = true;
        setTimeout(processBatchQueue, 35);
      }
    })
      .then(async (data) => {
        // If batch token resolution returned generic data with 0 price and volume,
        // it may be a pair address rather than a base token address.
        // Attempt direct pair lookup on DexScreener before accepting fallback.
        if (data.priceUsd === 0 && data.liquidityUsd === 0 && data.volume24h === 0) {
          // The batch call may have established a cooldown; never spend a second
          // request on the pair fallback after a 429.
          if (Date.now() < rateLimitCooldownUntil) return data;
          try {
            const resPair = await fetch(
              `${DEXSCREENER_API_BASE}/latest/dex/pairs/${ROBINHOOD_CHAIN_SLUG}/${normalized}`,
              {
                headers: { accept: "application/json" },
                signal: AbortSignal.timeout(4000),
              }
            );
            if (resPair.status === 429) rateLimitCooldownUntil = Date.now() + 60_000;
            if (resPair.ok) {
              const pair = (pairsFromPayload(await resPair.json()) ?? []).find(
                (candidate) => isRobinhoodPair(candidate) && (candidate.pairAddress ?? "").toLowerCase() === normalized
              );
              if (pair?.baseToken) {
                const marketData = dexPairToTokenMarketData(pair, 1);
                rememberMarketData(normalized, marketData, 30_000);
                return marketData;
              }
            }
          } catch {
            // Degrade safely
          }
        }
        return data;
      })
      .finally(() => {
        inFlightRequests.delete(normalized);
      });

    inFlightRequests.set(normalized, promise);
    return promise;
  }

  // 4. Fallback for Uniswap V4 66-character pool IDs or search queries
  const individualFetch = (async () => {
    if (now < rateLimitCooldownUntil) {
      return createGenericTokenMarketData(normalized);
    }

    let cacheMiss = false;
    try {
      const isHex = normalized.startsWith("0x");
      let url: string;
      if (isHex && (normalized.length === 66 || normalized.length === 42)) {
        url = `${DEXSCREENER_API_BASE}/latest/dex/pairs/${ROBINHOOD_CHAIN_SLUG}/${normalized}`;
      } else {
        url = `${DEXSCREENER_API_BASE}/latest/dex/search?q=${encodeURIComponent(normalized)}`;
      }

      const res = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(4000),
      });

      if (res.status === 429) {
        rateLimitCooldownUntil = Date.now() + 60_000;
        return createGenericTokenMarketData(normalized);
      }

      if (res.ok) {
        const rawPairs = pairsFromPayload(await res.json());
        if (!rawPairs) return createGenericTokenMarketData(normalized);
        const robinhoodPairs = rawPairs.filter(isRobinhoodPair);

        // Exact pair match if user searched a pair address
        const exactPair = robinhoodPairs.find((p) => (p.pairAddress ?? "").toLowerCase() === normalized);

        // Rank by active depth (liquidity * 2 + 24h volume)
        robinhoodPairs.sort((a, b) => {
          const scoreA = Number(a.liquidity?.usd ?? 0) * 2 + Number(a.volume?.h24 ?? 0);
          const scoreB = Number(b.liquidity?.usd ?? 0) * 2 + Number(b.volume?.h24 ?? 0);
          return scoreB - scoreA;
        });

        const pairLookup = isHex && (normalized.length === 42 || normalized.length === 66);
        const pair = pairLookup ? exactPair : exactPair || robinhoodPairs[0];

        if (pair && pair.baseToken) {
          const marketData = dexPairToTokenMarketData(pair, 1);
          rememberMarketData(normalized, marketData, 30_000);
          return marketData;
        }
        // A successful provider answer with no matching pair is a short-lived
        // negative result. Transport/HTTP/decoding failures below are unknown,
        // so they must not be frozen into the market cache.
        cacheMiss = true;
      }
    } catch {
      // Degrade safely
    }

    const fallback = createGenericTokenMarketData(normalized);
    if (cacheMiss) rememberMarketData(normalized, fallback, 15_000);
    return fallback;
  })().finally(() => {
    inFlightRequests.delete(normalized);
  });

  inFlightRequests.set(normalized, individualFetch);
  return individualFetch;
}
