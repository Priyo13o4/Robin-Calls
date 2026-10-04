/**
 * TradingView listing resolution for RWA benchmark charts (L79).
 *
 * The RWA detail page charts each token's underlier on TradingView. Guessing
 * `NASDAQ:<SYMBOL>` for tickers listed elsewhere publishes a broken chart —
 * BA is NYSE:BA, XLK is NYSE Arca, and the hardcoded 25-ticker map had already
 * drifted (PLTR moved to NASDAQ, CRCL listed on NYSE, SGOV on NYSE). The same
 * symbol-search endpoint /api/rwa/icon proxies for logos resolves the real
 * `PREFIX:SYMBOL`; the only safe match is EXACT after stripping the `<em>`
 * highlight tags the API wraps matches in — `GLD` returns `GLDI` first and
 * `VTI` returns `VTIP` (KNOWN-PROBLEMS L79 trap 1).
 */

import { OUTBOUND_USER_AGENT } from "../config/user-agent";

const TV_HEADERS = {
  // Shared with every other outbound call — lib/config/user-agent.ts records
  // why the exact shape is load-bearing (Cloudflare 403s the alternatives).
  "User-Agent": OUTBOUND_USER_AGENT,
  Referer: "https://www.tradingview.com/",
  Origin: "https://www.tradingview.com",
} as const;

export interface TvSymbolRow {
  symbol?: string;
  description?: string;
  type?: string;
  exchange?: string;
  prefix?: string;
  source_id?: string;
  is_primary_listing?: boolean;
  logoid?: string;
  logo?: { logoid?: string };
}

export type TvResolution =
  | { status: "resolved"; tvSymbol: string; logoid: string | null }
  // TV answered: no exact US listing exists for this ticker. A fact, cacheable.
  | { status: "absent" }
  // TV could not be reached — NOT a fact about the ticker (§4: never cache a
  // negative that came from a transient failure; the fetch below is what the
  // Data Cache sees, and a thrown/failed fetch is not stored).
  | { status: "unavailable" };

// Display `exchange` names accepted as a US listing. NYSE Arca carries most
// ETFs — excluding it blanks exactly the category the L78 sync added most of
// (L79 trap 2).
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "NYSE Arca", "AMEX", "BATS"]);
// A DR (ADR) is how foreign issuers like BABA list on a US exchange; exclude
// it and BABA regresses to unresolved.
const LISTING_TYPES = new Set(["stock", "fund", "dr"]);

export function stripEmTags(s: string): string {
  return s.replace(/<\/?em>/g, "");
}

/**
 * The widget/URL symbol uses TV's internal prefix, not the display exchange
 * name: NYSE Arca rows carry prefix/source_id "AMEX", and "NYSE Arca:SPY"
 * resolves on nothing while "AMEX:SPY" does.
 */
function widgetSymbolPrefix(row: TvSymbolRow): string {
  return row.prefix || row.source_id || row.exchange || "";
}

// The display name "NYSE Arca" never appears inside a real symbol; its rows
// carry prefix/source_id "AMEX". Normalise in case neither field is present.
function normalizePrefix(p: string): string {
  return p === "NYSE Arca" ? "AMEX" : p;
}

/**
 * Exact-symbol pick over one TV search response. Prefers the primary listing,
 * else the first eligible row (TV's own ranking). Returns null when nothing
 * matches exactly on a US venue — the caller renders that as a disclosed
 * "no benchmark" state rather than a guessed chart.
 */
export function pickTvListing(
  rows: TvSymbolRow[],
  target: string
): { tvSymbol: string; logoid: string | null } | null {
  let fallback: { tvSymbol: string; logoid: string | null } | null = null;
  for (const row of rows) {
    if (stripEmTags(row.symbol ?? "") !== target) continue;
    if (!row.exchange || !US_EXCHANGES.has(row.exchange)) continue;
    if (!row.type || !LISTING_TYPES.has(row.type)) continue;
    const hit = {
      tvSymbol: `${normalizePrefix(widgetSymbolPrefix(row))}:${target}`,
      logoid: row.logoid ?? row.logo?.logoid ?? null,
    };
    if (row.is_primary_listing) return hit;
    fallback ??= hit;
  }
  return fallback;
}

/**
 * Resolve a registry ticker to its TradingView listing. Cache is Next's Data
 * Cache keyed on the request URL — one upstream hit per ticker per day, shared
 * with /api/rwa/icon which resolves logos from the same response.
 */
export async function resolveTradingViewSymbol(
  symbol: string
): Promise<TvResolution> {
  const target = symbol.trim().toUpperCase();
  try {
    const res = await fetch(
      `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(
        target
      )}&hl=1&exchange=&lang=en&domain=production`,
      {
        headers: TV_HEADERS,
        signal: AbortSignal.timeout(3000),
        next: { revalidate: 86_400 },
      }
    );
    if (!res.ok) return { status: "unavailable" };
    const data = (await res.json()) as { symbols?: TvSymbolRow[] };
    const hit = pickTvListing(data.symbols ?? [], target);
    if (hit) return { status: "resolved", ...hit };
    return { status: "absent" };
  } catch {
    // Timeout / transport fault — "unavailable", never "absent": an empty
    // answer from a dead fetch must not publish "no such listing" (§4).
    return { status: "unavailable" };
  }
}
