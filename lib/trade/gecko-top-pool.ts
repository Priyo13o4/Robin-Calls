/**
 * GeckoTerminal top pool resolver for Robinhood Chain tokens.
 *
 * Provides on-demand discovery of the deepest active pool for a token on GeckoTerminal.
 * Filters for valid 0x40 / 0x64 hex pool identities and chooses the pool with the
 * highest finite positive reserve_in_usd where relationships explicitly name the token.
 */

import { geckoTerminalNetwork } from "@/lib/config/chain";

export interface GeckoTokenRelationship {
  data?: {
    id?: string;
    type?: string;
  } | null;
}

export interface GeckoPoolAttributes {
  address?: string;
  name?: string;
  reserve_in_usd?: string | number | null;
  volume_usd?: {
    h24?: string | number | null;
    [key: string]: unknown;
  } | null;
  price_change_percentage?: {
    h24?: string | number | null;
    [key: string]: unknown;
  } | null;
  transactions?: {
    h24?: {
      buys?: number | null;
      sells?: number | null;
      buyers?: number | null;
      sellers?: number | null;
    } | null;
    [key: string]: unknown;
  } | null;
  token_price_usd?: string | number | null;
  base_token_price_usd?: string | number | null;
  quote_token_price_usd?: string | number | null;
  pool_created_at?: string | null;
  fdv_usd?: string | number | null;
  [key: string]: unknown;
}

export interface GeckoPoolData {
  id: string;
  type?: string;
  attributes: GeckoPoolAttributes;
  relationships?: {
    base_token?: GeckoTokenRelationship;
    quote_token?: GeckoTokenRelationship;
    dex?: { data?: { id?: string; type?: string } };
    [key: string]: unknown;
  };
}

export interface GeckoApiResponse {
  data?: GeckoPoolData[];
  included?: unknown[];
  errors?: unknown[];
}

export interface GeckoTopPool {
  poolAddress: string;
  poolId: string;
  name: string | null;
  baseTokenAddress: string | null;
  quoteTokenAddress: string | null;
  reserveInUsd: number | null;
  volume24hUsd: number | null;
  priceChange24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  tokenPriceUsd: number | null;
  raw: GeckoPoolData;
}

/** 0x40 hex (20-byte standard address) or 0x64 hex (32-byte pool ID e.g. Uniswap v4). */
export const POOL_HEX_REGEX = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

/** Validate whether a given string is a valid 0x40 or 0x64 hex address. */
export function isValidPoolAddress(address: unknown): address is string {
  if (typeof address !== "string") return false;
  return POOL_HEX_REGEX.test(address.trim());
}

/**
 * Validate a pool ID, handling either raw 0x40/0x64 hex or network-prefixed
 * identifiers such as "robinhood_0x...".
 */
export function isValidPoolId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  const trimmed = id.trim();
  if (POOL_HEX_REGEX.test(trimmed)) return true;
  const stripped = trimmed.replace(/^[a-zA-Z0-9_-]+_/, "");
  return POOL_HEX_REGEX.test(stripped);
}

/** Extract an EVM token address (0x + 40 hex chars) from an ID string like "robinhood_0x123...". */
export function extractAddressFromId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const m = id.match(/0x[0-9a-fA-F]{40}/);
  return m ? m[0].toLowerCase() : null;
}

/** Extract the valid pool address from a Gecko pool record. */
export function extractPoolAddress(pool: GeckoPoolData): string | null {
  if (typeof pool.attributes?.address === "string" && isValidPoolAddress(pool.attributes.address)) {
    return pool.attributes.address.toLowerCase();
  }
  if (typeof pool.id === "string") {
    const stripped = pool.id.replace(/^[a-zA-Z0-9_-]+_/, "");
    if (isValidPoolAddress(stripped)) {
      return stripped.toLowerCase();
    }
  }
  return null;
}

function parseFiniteNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = typeof val === "number" ? val : Number(val);
  return Number.isFinite(num) ? num : null;
}

/**
 * Filter and select the top pool from a list of GeckoTerminal pool records.
 *
 * Rules:
 * 1. Filter valid pool IDs: 0x40 or 0x64 hex.
 * 2. Pool address cannot be the target token address itself.
 * 3. Base or quote relationship must explicitly match the target token (never infer token side).
 * 4. Choose the highest finite positive `reserve_in_usd`.
 */
export function selectTopPool(
  pools: GeckoPoolData[],
  tokenAddress: string
): GeckoTopPool | null {
  if (!Array.isArray(pools) || pools.length === 0) return null;
  if (!tokenAddress || typeof tokenAddress !== "string") return null;

  const target = tokenAddress.toLowerCase().trim();
  let bestPool: GeckoPoolData | null = null;
  let bestReserve = -1;
  let bestPoolAddress: string | null = null;

  for (const pool of pools) {
    if (!pool || typeof pool !== "object") continue;

    const poolAddr = extractPoolAddress(pool);
    if (!poolAddr) continue;

    // A pool cannot be the token itself
    if (poolAddr === target) continue;

    // Check relationship matching - do not infer token side
    const baseAddr = extractAddressFromId(pool.relationships?.base_token?.data?.id);
    const quoteAddr = extractAddressFromId(pool.relationships?.quote_token?.data?.id);

    const matchesBase = baseAddr !== null && baseAddr === target;
    const matchesQuote = quoteAddr !== null && quoteAddr === target;

    if (!matchesBase && !matchesQuote) {
      continue;
    }

    // Require finite positive reserve_in_usd
    const reserve = parseFiniteNumber(pool.attributes?.reserve_in_usd);
    if (reserve === null || reserve <= 0) {
      continue;
    }

    if (reserve > bestReserve) {
      bestReserve = reserve;
      bestPool = pool;
      bestPoolAddress = poolAddr;
    }
  }

  if (!bestPool || !bestPoolAddress) return null;

  const attr = bestPool.attributes ?? {};
  const baseTokenAddr = extractAddressFromId(bestPool.relationships?.base_token?.data?.id);
  const quoteTokenAddr = extractAddressFromId(bestPool.relationships?.quote_token?.data?.id);

  // Scope token price without inferring: prefer GT's token_price_usd scoped to requested token,
  // then fallback only to the relationship side that strictly matched
  let tokenPriceUsd = parseFiniteNumber(attr.token_price_usd);
  if (tokenPriceUsd === null) {
    if (baseTokenAddr === target) {
      tokenPriceUsd = parseFiniteNumber(attr.base_token_price_usd);
    } else if (quoteTokenAddr === target) {
      tokenPriceUsd = parseFiniteNumber(attr.quote_token_price_usd);
    }
  }

  const h24Tx = attr.transactions?.h24;
  const buys = parseFiniteNumber(h24Tx?.buys);
  const sells = parseFiniteNumber(h24Tx?.sells);

  return {
    poolAddress: bestPoolAddress,
    poolId: bestPool.id,
    name: typeof attr.name === "string" ? attr.name : null,
    baseTokenAddress: baseTokenAddr,
    quoteTokenAddress: quoteTokenAddr,
    reserveInUsd: bestReserve,
    volume24hUsd: parseFiniteNumber(attr.volume_usd?.h24),
    priceChange24h: parseFiniteNumber(attr.price_change_percentage?.h24),
    buys24h: buys !== null ? Math.round(buys) : null,
    sells24h: sells !== null ? Math.round(sells) : null,
    tokenPriceUsd,
    raw: bestPool,
  };
}

/**
 * Parse an API response object and select the top pool for the given token address.
 */
export function parseAndSelectTopPool(
  response: unknown,
  tokenAddress: string
): GeckoTopPool | null {
  if (!response || typeof response !== "object") return null;
  const apiResp = response as GeckoApiResponse;
  if (!Array.isArray(apiResp.data)) return null;
  return selectTopPool(apiResp.data, tokenAddress);
}

// ---------------------------------------------------------------------------
// Rate Limiting & Bounded Memory Cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

interface CacheEntry {
  pool: GeckoTopPool | null;
  timestamp: number;
}

const poolCache = new Map<string, CacheEntry>();
let geckoCooldownUntil = 0;

/** Return remaining cooldown time in ms if rate limited, or 0. */
export function getGeckoCooldownRemainingMs(): number {
  const remaining = geckoCooldownUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

/** Clear module cache (primarily for tests). */
export function clearGeckoTopPoolCache(): void {
  poolCache.clear();
  geckoCooldownUntil = 0;
}

function pruneCacheIfNeeded(): void {
  const now = Date.now();
  for (const [key, entry] of poolCache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL_MS) {
      poolCache.delete(key);
    }
  }
  if (poolCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = poolCache.keys().next().value;
    if (oldestKey !== undefined) {
      poolCache.delete(oldestKey);
    }
  }
}

/**
 * Fetch the top active liquidity pool for a token from GeckoTerminal.
 *
 * Guarantees:
 * - 8-second timeout via AbortController
 * - 60s cooldown backoff upon receiving 429
 * - 60s per-token cached successful responses in a bounded Map
 * - No prefetch or polling
 */
export async function fetchTopPoolForToken(
  tokenAddress: string,
  options?: { signal?: AbortSignal }
): Promise<GeckoTopPool | null> {
  if (typeof tokenAddress !== "string" || !/^0x[0-9a-f]{40}$/i.test(tokenAddress.trim())) {
    return null;
  }

  const normalized = tokenAddress.toLowerCase().trim();
  const cacheKey = normalized;

  // Cache hit guard
  const cached = poolCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.pool;
  }

  // Cached observations remain usable while fresh requests are rate limited.
  const cooldownRemaining = getGeckoCooldownRemainingMs();
  if (cooldownRemaining > 0) {
    throw new Error(`GeckoTerminal rate limit active. Retry in ${Math.ceil(cooldownRemaining / 1000)}s.`);
  }

  const network = geckoTerminalNetwork || "robinhood";
  const endpoint = `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(normalized)}/pools?include=base_token,quote_token`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error("GeckoTerminal request timed out after 8s"));
  }, REQUEST_TIMEOUT_MS);

  // Link caller's external signal if provided
  if (options?.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          controller.abort(options.signal?.reason);
        },
        { once: true }
      );
    }
  }

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (res.status === 429) {
      geckoCooldownUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      throw new Error("GeckoTerminal 429 rate limit exceeded. Backing off for 60s.");
    }

    if (!res.ok) {
      if (res.status === 404) {
        // Token not found on GeckoTerminal
        pruneCacheIfNeeded();
        poolCache.set(cacheKey, { pool: null, timestamp: Date.now() });
        return null;
      }
      throw new Error(`GeckoTerminal API returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as GeckoApiResponse;
    const topPool = parseAndSelectTopPool(data, normalized);

    // Cache successful response
    pruneCacheIfNeeded();
    poolCache.set(cacheKey, { pool: topPool, timestamp: Date.now() });

    return topPool;
  } finally {
    clearTimeout(timeoutId);
  }
}
