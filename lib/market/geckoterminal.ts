import { geckoTerminalNetwork } from "../config/chain";
import type { MarketSnapshot } from "../types";
import {
  marketRequestTimeoutMs,
  num,
  type MarketFetch,
  type MarketProvider,
} from "./provider";

/**
 * GeckoTerminal public API client (keyless, ~30 req/min ceiling — treat 429s
 * as the runtime authority, PRD §11.8). Scan-path usage is being migrated to
 * DexScreener; GeckoTerminal remains the slow-rug confirmation provider and
 * the temporary tracker fallback.
 */

const BASE = "https://api.geckoterminal.com/api/v2";

interface GetResult<T> {
  status: number | "timeout" | "network";
  json: T | null;
}

async function get<T>(path: string): Promise<GetResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(marketRequestTimeoutMs()),
    });
    if (!res.ok) return { status: res.status, json: null };
    return { status: res.status, json: (await res.json()) as T };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "TimeoutError";
    return { status: timeout ? "timeout" : "network", json: null };
  }
}

interface PoolData {
  id: string;
  attributes: {
    address: string;
    reserve_in_usd: string | null;
    volume_usd: { h24: string | null };
    transactions: {
      h24: {
        buys: number | null;
        sells: number | null;
        /** unique traders — the §15.4 trade-density inputs */
        buyers?: number | null;
        sellers?: number | null;
      };
    };
    pool_created_at: string | null;
    base_token_price_usd: string | null;
    quote_token_price_usd?: string | null;
    /** Scoped by GT to the token in the request path, whichever side it is on. */
    token_price_usd?: string | null;
    fdv_usd: string | null;
  };
  relationships?: {
    /** e.g. { data: { id: "up-v3" } } — the venue, not the pool. */
    dex?: { data?: { id?: string } };
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
  };
}

export interface NewPool {
  poolAddress: string;
  baseTokenAddress: string;
  symbol: string | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  createdAt: string | null;
}

/** Extract a 0x address from a GeckoTerminal relationship id like "net_0xabc". */
function addressFromId(id: string | undefined): string | null {
  if (!id) return null;
  const m = id.match(/0x[0-9a-fA-F]{40}/);
  return m ? m[0] : null;
}

/**
 * Newly-created pools on the network, most recent first (Tracker fallback
 * source — §11.8 moves primary discovery to on-chain factory events).
 * Best-effort: [] on failure.
 */
export async function fetchNewPools(): Promise<NewPool[]> {
  const { json: data } = await get<{
    data: (PoolData & {
      attributes: PoolData["attributes"] & { name?: string };
      relationships?: { base_token?: { data?: { id?: string } } };
    })[];
  }>(`/networks/${geckoTerminalNetwork}/new_pools?page=1`);
  if (!data?.data?.length) return [];

  return data.data
    .map((p) => {
      const baseTokenAddress = addressFromId(p.relationships?.base_token?.data?.id);
      if (!baseTokenAddress) return null;
      const symbol = p.attributes.name?.split(" / ")[0]?.trim() ?? null;
      return {
        poolAddress: p.attributes.address,
        baseTokenAddress,
        symbol,
        liquidityUsd: num(p.attributes.reserve_in_usd),
        volume24hUsd: num(p.attributes.volume_usd?.h24),
        createdAt: p.attributes.pool_created_at,
      } satisfies NewPool;
    })
    .filter((p): p is NewPool => p !== null);
}

function deepestPool(pools: PoolData[]): PoolData {
  return [...pools].sort(
    (a, b) =>
      (num(b.attributes.reserve_in_usd) ?? 0) - (num(a.attributes.reserve_in_usd) ?? 0)
  )[0];
}

/**
 * The scanned token's own price in this pool. `base_token_price_usd` is the
 * BASE side, and GT orients a pool its own way — on an RWA-quoted Pons V2 pool
 * it makes the stock token the base, so reading it published Amazon's $259
 * share price as a memecoin's. `token_price_usd` is scoped by GT to the token
 * in the request path; fall back to the side the relationships actually name,
 * and to null rather than to the wrong token's price.
 */
function tokenSidePriceUsd(row: PoolData, tokenAddress: string): number | null {
  const scoped = num(row.attributes.token_price_usd);
  if (scoped !== null) return scoped;
  const token = tokenAddress.toLowerCase();
  if (addressFromId(row.relationships?.base_token?.data?.id)?.toLowerCase() === token) {
    return num(row.attributes.base_token_price_usd);
  }
  if (addressFromId(row.relationships?.quote_token?.data?.id)?.toLowerCase() === token) {
    return num(row.attributes.quote_token_price_usd);
  }
  return null;
}

// Takes the whole row, not just `attributes`: the venue id lives in
// `relationships.dex`, so an attributes-only signature could not name it.
function toSnapshot(row: PoolData, tokenAddress: string): MarketSnapshot {
  const p = row.attributes;
  return {
    priceUsd: tokenSidePriceUsd(row, tokenAddress),
    liquidityUsd: num(p.reserve_in_usd),
    volume24hUsd: num(p.volume_usd?.h24),
    buys24h: p.transactions?.h24?.buys ?? null,
    sells24h: p.transactions?.h24?.sells ?? null,
    buyers24h: p.transactions?.h24?.buyers ?? null,
    sellers24h: p.transactions?.h24?.sellers ?? null,
    fdvUsd: num(p.fdv_usd),
    poolAddress: p.address ?? null,
    poolDexId: row.relationships?.dex?.data?.id ?? null,
    poolCreatedAt: p.pool_created_at ?? null,
  };
}

/** Fetch the deepest pool + market stats for a token. Null if unlisted/unreachable. */
export async function fetchMarketSnapshot(
  tokenAddress: string
): Promise<MarketSnapshot | null> {
  const fetched = await geckoTerminalProvider.fetchTokenMarket(tokenAddress);
  return fetched.snapshot;
}

export const geckoTerminalProvider: MarketProvider = {
  id: "geckoterminal",

  async fetchTokenMarket(tokenAddress: string): Promise<MarketFetch> {
    const { status, json } = await get<{ data: PoolData[] }>(
      `/networks/${geckoTerminalNetwork}/tokens/${tokenAddress.toLowerCase()}/pools?page=1`
    );
    if (json === null) {
      const state =
        status === 429
          ? "RATE_LIMITED"
          : status === "timeout"
            ? "TIMEOUT"
            : status === 404
              ? "NOT_FOUND"
              : "ERROR";
      return { provider: "geckoterminal", state, snapshot: null };
    }
    if (!json.data?.length) {
      return { provider: "geckoterminal", state: "NOT_FOUND", snapshot: null };
    }
    return {
      provider: "geckoterminal",
      state: "OK",
      snapshot: toSnapshot(deepestPool(json.data), tokenAddress),
    };
  },
};
