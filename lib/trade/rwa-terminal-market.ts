import { factCache } from "../swap/fact-cache";
import { dexPairToTokenMarketData, getBaseSwapTokens, type TokenMarketData } from "./types";

const API = "https://api.dexscreener.com";
const CHAIN = "robinhood";
const cache = factCache<{ pairs: RwaTerminalPair[]; observedAt: number } | null>(30_000, 256);
let cooldownUntil = 0;

/** DexScreener pair fields used by the RWA feed and the terminal market mapper. */
export interface RwaTerminalPair {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | number;
  priceNative?: string | number;
  liquidity?: { usd?: number | null; base?: number | null; quote?: number | null };
  volume?: { h24?: number };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  dexId?: string;
  labels?: string[];
  info?: { imageUrl?: string; header?: string; websites?: Array<{ url?: string }>; socials?: Array<{ type?: string; url?: string }> };
}

const isPoolAddress = (value: unknown): value is string =>
  typeof value === "string" && /^0x(?:[\da-f]{40}|[\da-f]{64})$/i.test(value);

function selectPair(pairs: RwaTerminalPair[], address: string): RwaTerminalPair | null {
  const token = address.toLowerCase();
  const candidates = pairs.filter((pair) =>
    pair && typeof pair === "object" &&
    typeof pair.chainId === "string" && pair.chainId.toLowerCase() === CHAIN &&
    typeof pair.baseToken?.address === "string" && pair.baseToken.address.toLowerCase() === token &&
    isPoolAddress(pair.pairAddress) &&
    typeof pair.liquidity?.usd === "number" &&
    Number.isFinite(pair.liquidity.usd) && pair.liquidity.usd > 0
  );
  candidates.sort((a, b) => {
    const depth = b.liquidity!.usd! - a.liquidity!.usd!;
    if (depth) return depth;
    const left = a.pairAddress!.toLowerCase();
    const right = b.pairAddress!.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const best = candidates[0];
  if (!best) return null;
  if (
    typeof best.quoteToken?.address !== "string" || !/^0x[\da-f]{40}$/i.test(best.quoteToken.address) ||
    typeof best.quoteToken.symbol !== "string" || best.quoteToken.symbol.trim().length === 0
  ) return null;
  const price = Number(best.priceUsd);
  return Number.isFinite(price) && price > 0 ? best : null;
}

/**
 * Reads the endpoint's full pair array, preserving both base- and quote-side rows
 * for the RWA feed. The parsed observation is shared with terminal market mapping.
 */
export function readRwaTerminalPairs(address: string): Promise<{ pairs: RwaTerminalPair[]; observedAt: number } | null> {
  const normalized = address.toLowerCase();
  if (!/^0x[\da-f]{40}$/i.test(address)) return Promise.resolve(null);
  return cache.get(normalized, async () => {
    if (Date.now() < cooldownUntil) return null;
    try {
      const response = await fetch(`${API}/token-pairs/v1/${CHAIN}/${normalized}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (response.status === 429) {
        cooldownUntil = Date.now() + 60_000;
        return null;
      }
      if (!response.ok) return null;
      const body: unknown = await response.json();
      if (!Array.isArray(body) || body.some((pair) => !pair || typeof pair !== "object" || Array.isArray(pair))) return null;
      return { pairs: body as RwaTerminalPair[], observedAt: Date.now() };
    } catch {
      return null;
    }
  }, (value) => value !== null);
}

/** Reads the highest USD-liquidity Robinhood base-token pool for the terminal. */
export async function readRwaTerminalMarket(address: string): Promise<{ token: TokenMarketData; observedAt: number } | null> {
  const observation = await readRwaTerminalPairs(address);
  if (!observation) return null;
  const pair = selectPair(observation.pairs, address);
  if (!pair) return null;
  const token = dexPairToTokenMarketData(pair);
  if (!Number.isFinite(token.priceUsd) || token.priceUsd <= 0) return null;
  const quoteAddress = pair.quoteToken!.address!.toLowerCase();
  const canonicalQuote = getBaseSwapTokens(4663).find((base) => base.address.toLowerCase() === quoteAddress);
  token.priceEth = canonicalQuote?.priceEth === 1 ? token.priceQuote ?? Number.NaN : Number.NaN;
  if (canonicalQuote) token.quoteToken.decimals = canonicalQuote.decimals;

  // The shared mapper uses zero for missing activity and reserves; keep those
  // unknown in the RWA terminal while preserving provider-reported zeroes.
  if (pair.volume?.h24 == null) token.volume24h = Number.NaN;
  if (pair.txns?.h24?.buys == null) token.txns24h.buys = Number.NaN;
  if (pair.txns?.h24?.sells == null) token.txns24h.sells = Number.NaN;
  token.txns24h.total = token.txns24h.buys + token.txns24h.sells;
  if (pair.liquidity?.base == null) {
    token.pooled.baseAmount = Number.NaN;
    token.pooled.baseUsd = Number.NaN;
  }
  if (pair.liquidity?.quote == null) {
    token.pooled.quoteAmount = Number.NaN;
    token.pooled.quoteUsd = Number.NaN;
  }
  return { token, observedAt: observation.observedAt };
}

export function _resetRwaTerminalMarketForTests(): void {
  cache.clear();
  cooldownUntil = 0;
}
