import { fetchTokenPairsBatch, selectPair, type DexScreenerPair } from "./dexscreener";
import { num } from "./provider";
import { reportError } from "../observability/reporter";
import { factCache } from "../swap/fact-cache";

/**
 * Live market figures for registry RWAs.
 *
 * `market_snapshots` cannot answer this question: it is written by the scan
 * receipt and by the Watch job, whose population is the 60 most recently
 * SCANNED tokens (`readWatchedTokensData`). The RWA registry is never in it —
 * 192 of 194 prod rows have no snapshot at all and the two that do are stale,
 * which is why every card rendered a dash. So the registry reads the provider
 * directly rather than a table nothing fills for it.
 *
 * `marketCapUsd` is one field on purpose: DexScreener returns `fdv` and
 * `marketCap` as the SAME number for every RWA here (total supply is
 * circulating supply for these), and splitting one figure under two labels
 * would publish a distinction nobody measured.
 */
export interface RwaQuote {
  priceUsd: number | null;
  /** `fdv ?? marketCap` — identical from this provider, see above. */
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  /** buys + sells over 24h. Null when the provider reported neither side. */
  trades24h: number | null;
  poolAddress: string | null;
  changeM5?: number | null;
  changeH1?: number | null;
  changeH6?: number | null;
  changeH24?: number | null;
}

export interface RwaQuoteResult {
  quotes: Map<string, RwaQuote>;
  /**
   * False when the provider did not answer. An empty map otherwise means "no
   * pool for this token", and a consumer that cannot tell those apart narrates
   * our own outage as a fact about the asset (CLAUDE.md §8 #9).
   */
  complete: boolean;
}

/** Matches the landing page's `revalidate`, so a render either reuses the hit or refills once. */
const TTL_MS = 60_000;
const MAX_READ_ALL_WAIT_MS = 10_000;
/**
 * Passed to the fetch so it stays cacheable. A no-store fetch here froze the
 * whole landing page on its build-time prerender — see fetchTokenPairsBatch.
 */
const FETCH_REVALIDATE_SECONDS = 60;

const quoteCache = factCache<RwaQuoteResult>(TTL_MS, 256);

function toQuote(pair: DexScreenerPair): RwaQuote {
  const buys = pair.txns?.h24?.buys ?? null;
  const sells = pair.txns?.h24?.sells ?? null;
  return {
    priceUsd: num(pair.priceUsd),
    marketCapUsd: num(pair.fdv ?? pair.marketCap),
    volume24hUsd: num(pair.volume?.h24),
    liquidityUsd: num(pair.liquidity?.usd),
    trades24h: buys == null && sells == null ? null : (buys ?? 0) + (sells ?? 0),
    poolAddress: pair.pairAddress ?? null,
    changeM5: num(pair.priceChange?.m5),
    changeH1: num(pair.priceChange?.h1),
    changeH6: num(pair.priceChange?.h6),
    changeH24: num(pair.priceChange?.h24),
  };
}

async function load(addresses: string[]): Promise<RwaQuoteResult> {
  const { ok, status, pairs } = await fetchTokenPairsBatch(addresses, FETCH_REVALIDATE_SECONDS);
  if (!ok) {
    await reportError({
      code: "RC_MARKET_UNAVAILABLE",
      message: `DexScreener RWA quote batch failed (${status})`,
      operation: "market.readRwaQuotes",
      providerId: "dexscreener",
      details: { batchSize: addresses.length },
    });
    return { quotes: new Map(), complete: false };
  }

  const quotes = new Map<string, RwaQuote>();
  for (const address of addresses) {
    // `selectPair` keeps only pairs where this token is the BASE and takes the
    // deepest, so the price describes the token and not its counter-asset
    // (CLAUDE.md §8 #21).
    const pair = selectPair(pairs, address);
    if (pair) quotes.set(address, toQuote(pair));
  }
  return { quotes, complete: true };
}

/**
 * Throws above 30 rather than slicing: the provider's batch cap is 30, and a
 * silent slice of an unranked list decides which assets get numbers by array
 * order (CLAUDE.md §8 #18). Callers choose their own 30, or call `readAllRwaQuotes`.
 */
export async function readRwaQuotes(addresses: string[]): Promise<RwaQuoteResult> {
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (wanted.length === 0) return { quotes: new Map(), complete: true };
  if (wanted.length > 30) {
    throw new Error(`readRwaQuotes takes at most 30 addresses, got ${wanted.length}`);
  }

  const key = [...wanted].sort().join(",");
  // A failed probe is not a result: caching it would hold the outage for a
  // full TTL after the provider recovered (CLAUDE.md §4).
  return quoteCache.get(key, () => load(wanted), (result) => result.complete);
}

/**
 * Chunks arbitrary address lists in batches of 30, queries via readRwaQuotes,
 * and merges the resulting quote map.
 */
export async function readAllRwaQuotes(
  addresses: string[],
  options?: { waitMs?: number },
): Promise<RwaQuoteResult> {
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (wanted.length === 0) return { quotes: new Map(), complete: true };

  const chunkSize = 30;
  const batches: string[][] = [];
  for (let i = 0; i < wanted.length; i += chunkSize) {
    batches.push(wanted.slice(i, i + chunkSize));
  }

  const settled: Array<RwaQuoteResult | undefined> = batches.map(() => undefined);
  const flights = batches.map((batch, i) => readRwaQuotes(batch).then((r) => (settled[i] = r)));
  const work = Promise.all(flights);
  const requestedWaitMs = options?.waitMs;
  if (requestedWaitMs !== undefined) {
    const waitMs = Number.isFinite(requestedWaitMs)
      ? Math.max(0, Math.min(MAX_READ_ALL_WAIT_MS, Math.trunc(requestedWaitMs)))
      : MAX_READ_ALL_WAIT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs);
    });
    try {
      const raced = await Promise.race([work, timeout]);
      if (raced === null) {
        // Only the caller's wait ran out. Unfinished batches keep running to warm the cache;
        // finished ones are served now, and the result says it is partial.
        const done = settled.filter((r): r is RwaQuoteResult => r !== undefined);
        return { quotes: mergeQuoteBatches(done).quotes, complete: false };
      }
      return mergeQuoteBatches(raced);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return mergeQuoteBatches(await work);
}

function mergeQuoteBatches(results: RwaQuoteResult[]): RwaQuoteResult {
  const merged = new Map<string, RwaQuote>();
  let allComplete = true;

  for (const res of results) {
    if (!res.complete) allComplete = false;
    for (const [addr, quote] of res.quotes.entries()) {
      merged.set(addr, quote);
    }
  }

  return { quotes: merged, complete: allComplete };
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function _resetRwaQuoteCache(): void {
  quoteCache.clear();
}
