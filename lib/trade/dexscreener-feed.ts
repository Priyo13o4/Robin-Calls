import { byTrending } from "./trending";
import { withCappedLabels } from "./format";
import {
  type TokenMarketData,
  dexPairToTokenMarketData,
} from "./types";

const DEXSCREENER_API_BASE = "https://api.dexscreener.com";
const ROBINHOOD_CHAIN_SLUG = "robinhood";

export interface DexScreenerFeedStats {
  totalVolume24h: number;
  totalTxns24h: number;
  activePairsCount: number;
  boostedTokensCount: number;
  lastUpdated: number;
}

export interface DexScreenerFeedResult {
  stats: DexScreenerFeedStats;
  pairs: TokenMarketData[];
}

// In-memory server-side cache with 20-second TTL
let cachedResult: DexScreenerFeedResult | null = null;
let cacheExpiresAt = 0;
let inFlightPromise: Promise<DexScreenerFeedResult> | null = null;

// Track 429 rate limit cooldown
let rateLimitCooldownUntil = 0;

/**
 * Fetches and aggregates the live DexScreener feed for Robinhood Chain.
 * Uses single-flight coalescing and bounded in-memory caching to strictly
 * protect against DexScreener public API rate limits.
 */
export async function getDexScreenerRobinhoodFeed(forceRefresh: boolean = false): Promise<DexScreenerFeedResult> {
  const now = Date.now();

  if (!forceRefresh && cachedResult && now < cacheExpiresAt) {
    return cachedResult;
  }

  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      if (now < rateLimitCooldownUntil && cachedResult) {
        return cachedResult;
      }

      const allRawPairs = new Map<string, any>();
      const boostScoresByToken = new Map<string, number>();
      const discoveredTokens = new Set<string>();

      // 1. Fetch Top & Latest Token Boosts + Token Profiles in parallel
      const [topBoostsRes, latestBoostsRes, profilesRes] = await Promise.allSettled([
        fetch(`${DEXSCREENER_API_BASE}/token-boosts/top/v1`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${DEXSCREENER_API_BASE}/token-boosts/latest/v1`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        }).then((r) => (r.ok ? r.json() : [])),
        fetch(`${DEXSCREENER_API_BASE}/token-profiles/latest/v1`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        }).then((r) => (r.ok ? r.json() : [])),
      ]);

      const processBoostList = (data: any) => {
        if (Array.isArray(data)) {
          for (const item of data) {
            if ((item.chainId ?? "").toLowerCase() === ROBINHOOD_CHAIN_SLUG && item.tokenAddress) {
              const addr = item.tokenAddress.toLowerCase();
              discoveredTokens.add(addr);
              const amount = Number(item.totalAmount ?? item.amount ?? 0);
              if (amount > (boostScoresByToken.get(addr) ?? 0)) {
                boostScoresByToken.set(addr, amount);
              }
            }
          }
        }
      };

      if (topBoostsRes.status === "fulfilled") processBoostList(topBoostsRes.value);
      if (latestBoostsRes.status === "fulfilled") processBoostList(latestBoostsRes.value);
      if (profilesRes.status === "fulfilled" && Array.isArray(profilesRes.value)) {
        for (const item of profilesRes.value) {
          if ((item.chainId ?? "").toLowerCase() === ROBINHOOD_CHAIN_SLUG && item.tokenAddress) {
            discoveredTokens.add(item.tokenAddress.toLowerCase());
          }
        }
      }

      // Seed with canonical stocks and base tokens to discover any active pairs
      try {
        const { CANONICAL_STOCK_TOKENS } = await import("./canonical-stocks");
        for (const t of CANONICAL_STOCK_TOKENS) {
          if (t.address) discoveredTokens.add(t.address.toLowerCase());
        }
        const { BASE_SWAP_TOKENS } = await import("./types");
        for (const t of BASE_SWAP_TOKENS) {
          if (t.address && t.address.startsWith("0x")) discoveredTokens.add(t.address.toLowerCase());
        }
      } catch {
        // Safe fallback if module unavailable
      }

      // 2. Query Search endpoints for active Robinhood Chain pairs
      const searchQueries = [
        "robinhood", "WETH", "ETH", "USDG", "USDC", "USDT",
        "uniswap", "ramses", "up", "alandale", "kittenswap",
        "AAPL", "NVDA", "TSLA", "MSFT", "META", "GOOGL", "AMZN", "SPY", "QQQ",
        "meme", "cat", "doge", "pepe", "pons", "flap", "cashcat", "musebook"
      ];
      const searchResults = await Promise.allSettled(
        searchQueries.map((q) =>
          fetch(`${DEXSCREENER_API_BASE}/latest/dex/search?q=${encodeURIComponent(q)}`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(4000),
          }).then((r) => (r.ok ? r.json() : { pairs: [] }))
        )
      );

      for (const res of searchResults) {
        if (res.status === "fulfilled" && res.value?.pairs) {
          for (const p of res.value.pairs) {
            if ((p.chainId ?? "").toLowerCase() === ROBINHOOD_CHAIN_SLUG && p.pairAddress) {
              allRawPairs.set(p.pairAddress.toLowerCase(), p);
              if (p.baseToken?.address) {
                discoveredTokens.add(p.baseToken.address.toLowerCase());
              }
            }
          }
        }
      }

      // 3. Bulk fetch /tokens/v1/robinhood/{addresses} in batches of 30 for discovered tokens
      const tokenList = Array.from(discoveredTokens).filter((a) => a.startsWith("0x") && a.length === 42);
      const chunkSize = 30;
      const tokenBatches: string[][] = [];
      for (let i = 0; i < tokenList.length; i += chunkSize) {
        tokenBatches.push(tokenList.slice(i, i + chunkSize));
      }

      const batchResults = await Promise.allSettled(
        tokenBatches.map((chunk) =>
          fetch(`${DEXSCREENER_API_BASE}/tokens/v1/${ROBINHOOD_CHAIN_SLUG}/${chunk.join(",")}`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(5000),
          }).then(async (r) => {
            if (r.status === 429) {
              rateLimitCooldownUntil = Date.now() + 60_000;
              return [];
            }
            return r.ok ? r.json() : [];
          })
        )
      );

      for (const res of batchResults) {
        if (res.status === "fulfilled" && Array.isArray(res.value)) {
          for (const p of res.value) {
            if ((p.chainId ?? "").toLowerCase() === ROBINHOOD_CHAIN_SLUG && p.pairAddress) {
              allRawPairs.set(p.pairAddress.toLowerCase(), p);
            }
          }
        }
      }

      // 4. Map raw pairs to TokenMarketData with boost scores and rankings
      const rawList = Array.from(allRawPairs.values());
      const mappedTokens: TokenMarketData[] = rawList.map((raw) => {
        const baseAddr = (raw.baseToken?.address || "").toLowerCase();
        const activeBoost = Number(raw.boosts?.active ?? 0);
        const externalBoost = boostScoresByToken.get(baseAddr) ?? 0;
        const totalBoost = Math.max(activeBoost, externalBoost);

        const data = dexPairToTokenMarketData(
          {
            ...raw,
            boosts: { active: totalBoost },
          },
          1
        );
        return withCappedLabels(data);
      });

      // 5. Trending order; a boost is a small bonus, never a trump (lib/trade/trending.ts).
      mappedTokens.sort(byTrending);

      // Assign sequential ranks
      mappedTokens.forEach((t, i) => {
        t.rank = i + 1;
      });

      // 6. Aggregate stats
      let totalVol = 0;
      let totalTx = 0;
      let boostedCount = 0;

      for (const t of mappedTokens) {
        totalVol += t.volume24h;
        totalTx += t.txns24h.total;
        if ((t.boostScore ?? 0) > 0) {
          boostedCount++;
        }
      }

      const result: DexScreenerFeedResult = {
        stats: {
          totalVolume24h: totalVol,
          totalTxns24h: totalTx,
          activePairsCount: mappedTokens.length,
          boostedTokensCount: boostedCount,
          lastUpdated: now,
        },
        pairs: mappedTokens,
      };

      cachedResult = result;
      cacheExpiresAt = now + 20_000; // 20s TTL
      return result;
    } catch (err) {
      if (cachedResult) return cachedResult;
      return {
        stats: {
          totalVolume24h: 0,
          totalTxns24h: 0,
          activePairsCount: 0,
          boostedTokensCount: 0,
          lastUpdated: now,
        },
        pairs: [],
      };
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}
