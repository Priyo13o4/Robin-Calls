"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { VerdictRow } from "@/lib/types";
import { isOwnToken } from "@/lib/sale/token";
import { readLedgerMarkets, formatAmount, formatPrice, type LedgerMarket } from "@/lib/trade/ledger-market";
import type { LedgerPools } from "@/lib/trade/ledger-pools";
import { robinhoodPublicClient } from "@/lib/trade/useTokenBalances";
import { TokenIcon } from "./TokenIcon";

const short = (h: string, n = 8) =>
  h.length > n + 6 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;

interface Page {
  entries: VerdictRow[];
  nextCursor: number | null;
  /** Tokens on this page whose newest verdict allows a swap link (lib/swap/ledger-gate.ts). */
  tradeable?: string[];
  /** Per token, the pool its verdict assessed first (lib/trade/ledger-pools.ts). */
  pools?: Record<string, LedgerPools>;
  /** Per token, the launch's stored icon pointer (launches.metadata_uri). */
  icons?: Record<string, string>;
}

/**
 * The chained ledger feed — client island over /api/ledger.
 *
 * Paginated in pages of 20 with an explicit "LOAD MORE" button (never infinite
 * scroll). Three behaviours the request asked for:
 *   • caching   — every page fetched (per search term + cursor) is memoised in
 *                 `cacheRef`, so re-expanding or clearing a search never refetches.
 *   • single-flight — load-more is guarded by `loadingMore`; search cancels its
 *                 in-flight predecessor via AbortController. No overlapping fetches.
 *   • search    — a debounced contract search over address / symbol / name.
 *
 * The live head only glows lime in the true, unfiltered newest position.
 */
export function LedgerFeed({
  initialEntries,
  initialCursor,
  token,
  explorerWebUrl,
  highlightId,
  tradeEnabled = false,
  initialTradeable = [],
  initialPools = {},
  initialIcons = {},
  stateView = null,
}: {
  initialEntries: VerdictRow[];
  initialCursor: number | null;
  token: string | null;
  explorerWebUrl: string;
  /**
   * The verdict a `?v=` deep link arrived for. The row markup has carried
   * `id="v{id}"` and a `target:` variant since it was written, but the link
   * that feeds it uses a QUERY param, so `:target` could never match and the
   * highlight was unreachable. Held in state, not CSS, so it also survives the
   * scroll and does not vanish on the next click.
   */
  highlightId?: number | null;
  tradeEnabled?: boolean;
  initialTradeable?: string[];
  initialPools?: Record<string, LedgerPools>;
  initialIcons?: Record<string, string>;
  /** V4 StateView, from server env; null leaves V4 rows unread ("—"). */
  stateView?: string | null;
}) {
  const [entries, setEntries] = useState<VerdictRow[]>(initialEntries);
  const [cursor, setCursor] = useState<number | null>(initialCursor);
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [tradeable, setTradeable] = useState<Set<string>>(() => new Set(initialTradeable));
  const [markets, setMarkets] = useState<Map<string, LedgerMarket>>(() => new Map());
  const askedRef = useRef<Set<string>>(new Set());
  const poolsRef = useRef<Record<string, LedgerPools>>({ ...initialPools });
  const [icons, setIcons] = useState<Record<string, string>>(() => ({ ...initialIcons }));
  const addIcons = useCallback((more?: Record<string, string>) => {
    if (more && Object.keys(more).length) setIcons((prev) => ({ ...prev, ...more }));
  }, []);

  // page cache: key `${query}::${cursor ?? 'HEAD'}` → Page. Seeded with the
  // SSR'd first page so clearing a search restores it with no network call.
  const cacheRef = useRef<Map<string, Page>>(
    new Map([[`::HEAD`, { entries: initialEntries, nextCursor: initialCursor, tradeable: initialTradeable, pools: initialPools, icons: initialIcons }]])
  );
  // True single-flight guard for load-more. The `loadingMore` *state* is stale
  // within a single render closure, so rapid synchronous clicks (a fast double
  // click, before React re-renders and disables the button) would each see
  // loadingMore=false and fire a duplicate fetch. A ref flips synchronously.
  const loadingRef = useRef(false);
  // Skip the query effect's mount run — initialEntries already reflect query "".
  const firstRun = useRef(true);

  const keyFor = (q: string, cur: number | null) => `${q}::${cur ?? "HEAD"}`;

  const addTradeable = useCallback((list: string[] | undefined) => {
    if (!list?.length) return;
    setTradeable((prev) => new Set([...prev, ...list]));
  }, []);

  // One on-chain batch per new set of tokens on screen, each asked once per visit.
  // Not aborted when the list changes: a load-more must not cancel rows still on screen.
  useEffect(() => {
    const fresh = [...new Set(entries.map((e) => e.token_address.toLowerCase()))].filter(
      (a) => !askedRef.current.has(a) && poolsRef.current[a] !== undefined
    );
    if (fresh.length === 0) return;
    fresh.forEach((a) => askedRef.current.add(a));
    const subset = Object.fromEntries(fresh.map((a) => [a, poolsRef.current[a]]));
    readLedgerMarkets(robinhoodPublicClient, stateView, subset)
      .then((got) => setMarkets((prev) => new Map([...prev, ...got])))
      // The whole batch faulted: these rows show "—" rather than staying on "reading".
      .catch(() => setMarkets((prev) => new Map([...prev, ...fresh.map((a) => [a, { status: "failed" } as LedgerMarket] as const)])));
  }, [entries, stateView]);

  // Bring the deep-linked row into view once, after the first paint. Not a
  // hash jump: the browser scrolls a hash before React has rendered the list.
  useEffect(() => {
    if (highlightId == null) return;
    const el = document.getElementById(`v${highlightId}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId]);

  const getPage = useCallback(
    async (q: string, cur: number | null, signal?: AbortSignal): Promise<Page> => {
      const key = keyFor(q, cur);
      const cached = cacheRef.current.get(key);
      if (cached) return cached;

      const url = new URL("/api/ledger", window.location.origin);
      if (q) url.searchParams.set("q", q);
      if (cur !== null) url.searchParams.set("cursor", String(cur));
      if (token) url.searchParams.set("token", token);

      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`ledger ${res.status}`);
      const page = (await res.json()) as Page;
      cacheRef.current.set(key, page);
      return page;
    },
    [token]
  );

  // Debounce the raw input into the committed `query` (300ms).
  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(t);
  }, [input]);

  // Whenever the committed query changes, load its first page. The `cancelled`
  // flag makes this strictly last-write-wins: a superseded search's result is
  // discarded instead of being applied a step late, and AbortController drops
  // its in-flight request. This is the search's single-flight.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setSearching(true);
    (async () => {
      try {
        const page = await getPage(query, null, ctrl.signal);
        if (cancelled) return;
        setEntries(page.entries);
        setCursor(page.nextCursor);
        addTradeable(page.tradeable);
        Object.assign(poolsRef.current, page.pools);
        addIcons(page.icons);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      } finally {
        if (!cancelled) setSearching(false);
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [query, getPage]);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || cursor === null) return; // single-flight guard
    loadingRef.current = true;
    setLoadingMore(true);
    try {
      const page = await getPage(query, cursor);
      // Dedupe defensively: keyset pagination shouldn't repeat ids, but never
      // render duplicate React keys even if a stale page slips through.
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...page.entries.filter((e) => !seen.has(e.id))];
      });
      setCursor(page.nextCursor);
      addTradeable(page.tradeable);
      Object.assign(poolsRef.current, page.pools);
      addIcons(page.icons);
    } catch {
      /* transient — button stays, user can retry */
    }
    loadingRef.current = false;
    setLoadingMore(false);
  }, [cursor, query, getPage]);

  const unfiltered = !token && query === "";

  return (
    <>
      {/* contract search */}
      <div className="mb-8">
        <input
          type="search"
          inputMode="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search the record — contract address, symbol, or name"
          aria-label="Search the ledger by contract address, symbol, or name"
          className="w-full border border-[#2a2a2a] bg-[#141414] px-5 py-4 font-mono text-sm text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
        />
      </div>

      {entries.length === 0 ? (
        <div className="border border-[#2a2a2a] bg-[#141414] px-6 py-16 text-center">
          {query || token ? (
            <>
              <p className="font-cinzel text-xl tracking-[0.1em] text-[#ededea]">
                NOTHING ON RECORD.
              </p>
              <p className="mt-3 text-sm text-[#8a8a8a]">
                No verdict matches {query ? `“${query}”` : "this contract"} yet.
              </p>
            </>
          ) : (
            <>
              <p className="font-cinzel text-xl tracking-[0.1em] text-[#ededea]">
                THE RECORD OPENS SOON.
              </p>
              <p className="mt-3 text-sm text-[#8a8a8a]">
                The first verdict written here will be entry #1, chained to genesis.
              </p>
            </>
          )}
        </div>
      ) : (
        <ol className="relative ml-3 border-l border-[#2a2a2a]">
          {entries.map((e, idx) => {
            const isHead = unfiltered && idx === 0;
            const isPinned = highlightId != null && e.id === highlightId;
            return (
              <li
                id={`v${e.id}`}
                key={e.id}
                className={`relative mb-4 scroll-mt-24 pl-8 target:[&>div]:border-[#8a8a8a] target:[&>div]:bg-[#1c1c1c] ${
                  isPinned ? "[&>div]:border-[#ccff00] [&>div]:bg-[#171a10]" : ""
                }`}
              >
                {isPinned && (
                  <span className="absolute -top-2 left-8 z-10 border border-[#ccff00] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[9px] tracking-[0.16em] text-[#ccff00]">
                    THE RECORD YOU CAME FOR
                  </span>
                )}
                {/* chain node — only the live head glows lime */}
                <span
                  className="absolute -left-[5px] top-6 h-[9px] w-[9px] rounded-full"
                  style={{
                    background: isHead ? "#ccff00" : "#2a2a2a",
                    boxShadow: isHead ? "0 0 12px #ccff0088" : "none",
                  }}
                />
                <div className="border border-[#2a2a2a] bg-[#141414] px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <TokenIcon
                        address={e.token_address}
                        symbol={e.token_symbol}
                        explorerUrl={explorerWebUrl}
                        metadataUri={icons[e.token_address.toLowerCase()] ?? null}
                        className="h-9 w-9 flex-none rounded-full"
                      />
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-[#ededea]">
                          {e.token_symbol ?? "UNKNOWN"}{" "}
                          <span className="text-[#8a8a8a]">{short(e.token_address)}</span>
                        </div>
                        <MarketLine market={markets.get(e.token_address.toLowerCase())} />
                      </div>
                    </div>
                    {isOwnToken(e.token_address) ? (
                      <div className="text-right">
                        <div className="font-cinzel text-lg font-bold tracking-[0.12em] text-[#ededea]">NOT SCORED</div>
                        <div className="font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]">OUR OWN TOKEN</div>
                      </div>
                    ) : (
                      <div className="font-cinzel text-3xl font-bold text-[#ededea]">
                        {e.score}
                        <span className="ml-3 text-xs tracking-[0.2em] text-[#8a8a8a]">
                          {e.tier}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 grid gap-1 font-mono text-[11px] text-[#8a8a8a]">
                    <span>
                      #{e.id} · {new Date(e.created_at).toUTCString()} · v{e.score_version}
                    </span>
                    <span>hash {short(e.entry_hash, 16)}</span>
                    <span>prev {short(e.prev_hash, 16)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/scan/${e.token_address}?v=${e.id}`}
                      className="border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ededea]"
                    >
                      OPEN FULL VERDICT →
                    </Link>
                    {tradeEnabled &&
                      tradeable.has(e.token_address.toLowerCase()) &&
                      markets.get(e.token_address.toLowerCase())?.status !== "empty" && (
                      <Link
                        href={`/trade/${e.token_address.toLowerCase()}`}
                        className="border border-[#ccff00]/60 bg-[#ccff00]/10 px-3 py-1 font-mono text-[10px] font-bold tracking-[0.14em] text-[#ccff00] hover:bg-[#ccff00]/20"
                      >
                        SWAP →
                      </Link>
                    )}
                    {e.anchor_tx ? (
                      <a
                        href={`${explorerWebUrl}/tx/${e.anchor_tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:text-[#ededea]"
                      >
                        ANCHOR TX {short(e.anchor_tx)}
                      </a>
                    ) : (
                      <span className="font-mono text-[10px] tracking-[0.14em] text-[#3d3d3d]">
                        AWAITING NEXT ANCHOR
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* load more — explicit, never infinite scroll */}
      {cursor !== null && (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="brutalist-box brutalist-shadow-light brutalist-pressable halftone-dark border border-[#ededea] bg-[#0a0a0a] px-10 py-4 font-inter text-[11px] font-bold uppercase tracking-[0.18em] text-[#ededea] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loadingMore ? "Reading the record…" : "Load more"}
          </button>
        </div>
      )}

      {searching && entries.length > 0 && (
        <p className="mt-6 text-center font-mono text-[10px] tracking-[0.2em] text-[#3d3d3d]">
          SEARCHING…
        </p>
      )}
    </>
  );
}

function MarketLine({ market }: { market: LedgerMarket | undefined }) {
  const cls = "mt-0.5 font-mono text-[11px] text-[#ededea]";
  if (market === undefined) return <div className={`${cls} opacity-40`}>Reading the pool…</div>;
  if (market.status === "failed") return <div className={cls} title="The pool read did not answer, or this pool keeps its funds in a hook">LIQUIDITY — · PRICE —</div>;
  if (market.status === "no-pool") return <div className={cls}>No pool in the scan</div>;
  const more = market.otherPools > 0 ? ` · +${market.otherPools} more` : "";
  if (market.status === "empty") {
    return (
      <div className={`${cls} font-bold text-[#ff8a8a]`}>
        {market.activeOnly ? "NO LIQUIDITY AT THE CURRENT PRICE" : "POOL EMPTY · NOTHING TO SELL INTO"}
        {more}
      </div>
    );
  }
  const tilde = market.approx ? "~" : "";
  return (
    <div className={cls} title={market.approx ? "V4: liquidity active at the current price" : "Pool balance, read on chain"}>
      LIQUIDITY {tilde}{formatAmount(market.quoteAmount)} {market.quoteSymbol} · PRICE {formatPrice(market.priceInQuote)} {market.quoteSymbol}
      {more}
    </div>
  );
}
