const WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const NATIVE = "0x0000000000000000000000000000000000000000";

export const LIVE_PRICE_REFRESH_MS = 30_000;

interface DexPair {
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
  priceUsd?: string;
  priceNative?: string;
  liquidity?: { usd?: number };
}

/**
 * The token's USD price from its deepest listed pool. `priceUsd` is the BASE side's price
 * (§8 #21), so a token that only appears as quote is priced as priceUsd / priceNative.
 */
export function pickTokenPriceUsd(pairs: readonly DexPair[], token: string): number | null {
  const t = token.toLowerCase();
  let best: { liq: number; price: number } | null = null;
  for (const p of pairs) {
    const base = p.baseToken?.address?.toLowerCase();
    const quote = p.quoteToken?.address?.toLowerCase();
    const baseUsd = Number(p.priceUsd);
    const price = base === t ? baseUsd
      : quote === t ? baseUsd / Number(p.priceNative)
      : NaN;
    if (!Number.isFinite(price) || price <= 0) continue;
    // Base-side pools rank above quote-side ones at any depth; the division is a fallback.
    const liq = (p.liquidity?.usd ?? 0) + (base === t ? 1e15 : 0);
    if (!best || liq > best.liq) best = { liq, price };
  }
  return best?.price ?? null;
}

/** One DexScreener call for every address (up to 30). Native ETH is priced as WETH. */
export async function fetchLivePrices(addresses: readonly string[], signal?: AbortSignal): Promise<Map<string, number>> {
  const asked = [...new Set(addresses.map((a) => a.toLowerCase()))];
  const lookup = [...new Set(asked.map((a) => (a === NATIVE ? WETH : a)))].slice(0, 30);
  const out = new Map<string, number>();
  if (lookup.length === 0) return out;
  const res = await fetch(`https://api.dexscreener.com/tokens/v1/robinhood/${lookup.join(",")}`, { signal });
  if (!res.ok) return out;
  const pairs = (await res.json()) as unknown;
  if (!Array.isArray(pairs)) return out;
  for (const a of asked) {
    const price = pickTokenPriceUsd(pairs as DexPair[], a === NATIVE ? WETH : a);
    if (price !== null) out.set(a, price);
  }
  return out;
}
