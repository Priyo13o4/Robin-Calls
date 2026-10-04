/**
 * Client-side token-icon lookup from DexScreener.
 *
 * DexScreener indexes Robinhood Chain DEX pairs and hosts a square token image
 * (`pair.info.imageUrl`, cdn.dexscreener.com) once a token has a pool — i.e.
 * after it graduates off the launchpad curve. The endpoint is CORS-open
 * (`Access-Control-Allow-Origin: *`, verified 2026-07-16), so the browser can
 * read it directly with no load on our servers and nothing stored.
 *
 * Pre-DEX curve tokens have no pair yet, so this returns null for them — the
 * caller keeps its own fallback (monogram / verdict header without art).
 */

// `/token-pairs/v1/{chain}/{token}` — the documented current endpoint (300
// req/min), the same one lib/market/dexscreener.ts uses server-side. Replaced
// `/latest/dex/tokens/`, which still answers but is the legacy path and had this
// file querying DexScreener two different ways. Chain-scoped by the URL, so it
// returns a BARE ARRAY rather than `{pairs: […]}` and needs no chain filter.
// CORS-open (`access-control-allow-origin: *`, re-verified 2026-08-25) — this
// runs in the BROWSER, so that header is load-bearing, not a detail.
const DEXSCREENER_TOKEN_PAIRS = "https://api.dexscreener.com/token-pairs/v1";

/** DexScreener's chain slug for Robinhood Chain (not the numeric 4663). */
const CHAIN_SLUG = "robinhood";

interface DexPair {
  baseToken?: { address?: string };
  info?: { imageUrl?: string };
}

/**
 * Resolve a token's icon URL, or null if DexScreener has no pair/image for it.
 * Prefers a pair on Robinhood Chain whose base token is this address.
 */
export async function fetchTokenImage(
  tokenAddress: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const res = await fetch(
      `${DEXSCREENER_TOKEN_PAIRS}/${CHAIN_SLUG}/${tokenAddress}`,
      { signal }
    );
    if (!res.ok) return null;
    // Bare array on this endpoint. Guarded rather than asserted: a shape change
    // must return null (caller keeps its fallback), never throw into the render.
    const body: unknown = await res.json();
    const pairs: DexPair[] = Array.isArray(body) ? (body as DexPair[]) : [];
    const want = tokenAddress.toLowerCase();

    const scored = pairs.filter((p) => {
      const img = p.info?.imageUrl;
      return typeof img === "string" && img.startsWith("https://");
    });
    // The chain is now in the URL, so the old chain-match tier is gone: prefer
    // the token's OWN pair, then any pair carrying an image.
    const best =
      scored.find((p) => p.baseToken?.address?.toLowerCase() === want) ??
      scored[0];

    return best?.info?.imageUrl ?? null;
  } catch {
    return null; // aborted / offline / rate-limited — caller keeps its fallback
  }
}
