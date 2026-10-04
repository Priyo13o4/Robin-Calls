"use client";

import { type LpCustodyLiveResult } from "@/lib/trade/lp-custody-shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Radio, ShieldCheck, Users, X } from "lucide-react";
import Link from "next/link";
import { formatUnits } from "viem";
import type { TokenRecord } from "@/lib/types";
import { TheRecord } from "@/app/components/site/TheRecord";
import type {
  HolderRow,
  TokenMarketData,
  TopTraderRow,
} from "@/lib/trade/types";
import { formatDexPrice } from "@/lib/trade/format";
import { explorerApiUrl, explorerWebUrl } from "@/lib/config/chain";
import { INITIAL_FEED, startTradeFeed, type FeedRow, type FeedState } from "@/lib/trade/trade-feed";
import { useLiquidityWatch, utcClock, warnableRemoval } from "@/lib/trade/liquidity-watch";
import { fastTraders, HOLDING_LEGEND, holdingTier, sameBlockRoundTrips, walletTags, type WalletTag } from "@/lib/trade/wallet-tags";
import { useWalletFacts } from "@/lib/trade/use-wallet-facts";
import { ShimmerBlock } from "@/app/components/site/Skeleton";
import { isOwnToken } from "@/lib/sale/token";
import { readEthUsd } from "@/lib/sale/eth-price";
import { holderExitUsd } from "@/lib/trade/holder-exit";
import { robinhoodPublicClient } from "@/lib/trade/useTokenBalances";

// Hairline grid: 1px row and column rules, the header's rule drawn as a shadow so it survives sticky.
const TH = "px-2.5 py-2 whitespace-nowrap border-r border-[#1c201e] last:border-r-0 shadow-[inset_0_-1px_0_#2a302d]";
const TD = "px-2.5 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis border-b border-r border-[#171b19] last:border-r-0";

const TAG_STYLE: Record<WalletTag["kind"], string> = {
  bot: "border-[#3a4a5a] bg-[#121a22] text-[#9fc3e6]",
  dev: "border-[#5a4520] bg-[#1d160b] text-[#f0b860]",
  insider: "border-[#5a2a24] bg-[#1d0e0c] text-[#f09080]",
};

type LpCustodyResult = LpCustodyLiveResult;

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL_ID = /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface TradingTransactionsTableProps {
  token: TokenMarketData;
  record?: TokenRecord | null;
  className?: string;
  onContextRows?: (rows: FeedRow[]) => void;
  marketSource?: "rwa";
}

interface BlockscoutHolder {
  address: { hash: string; name?: string | null };
  value: string;
}

/** Unknown amounts arrive as NaN and render as the "no answer" placeholder, never as 0. */
const num = (n: number, opts: Intl.NumberFormatOptions) => (Number.isFinite(n) ? n.toLocaleString("en-US", opts) : "—");

function formatTimeAgo(timestamp?: number, fallbackDate?: string, currentNow: number = Date.now()): string {
  if (!timestamp) return fallbackDate || "Just now";
  const diffSec = Math.max(0, Math.floor((currentNow - timestamp) / 1000));
  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

export function TradingTransactionsTable({
  token,
  record = null,
  className = "",
  onContextRows,
  marketSource,
}: TradingTransactionsTableProps) {
  const [activeTab, setActiveTab] = useState<"txns" | "traders" | "holders" | "audit">("txns");
  const [filterType, setFilterType] = useState<"all" | "buy" | "sell" | "liquidity">("all");
  const [hideBots, setHideBots] = useState(false);
  const [maker, setMaker] = useState<string | null>(null);

  const [feed, setFeed] = useState<FeedState>(INITIAL_FEED);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [lpCustodyByPool, setLpCustodyByPool] = useState<Record<string, LpCustodyResult>>({});

  // Live 1-second ticker to update relative times (e.g. 9s ago -> 20s ago -> 1m ago)
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Real-Time Holders State (Client-Side Explorer)
  const [holders, setHolders] = useState<HolderRow[]>([]);
  const [totalHolders, setTotalHolders] = useState<number>(0);
  const [isLoadingHolders, setIsLoadingHolders] = useState(false);
  const [holdersUnavailable, setHoldersUnavailable] = useState(false);
  // What each balance would fetch if sold now. Null = not priced, so the explorer value stays.
  const [exit, setExit] = useState<{ holders: HolderRow[]; usd: (number | null)[] } | null>(null);

  // Top Traders State
  const topTraders: TopTraderRow[] = useMemo(() => [], []);

  useEffect(
    () =>
      marketSource
        ? startTradeFeed({ address: token.address, primaryPool: token.pairAddress, marketSource }, setFeed)
        : startTradeFeed({ address: token.address, primaryPool: token.pairAddress }, setFeed),
    [token.address, token.pairAddress, marketSource],
  );

  const lpEventPools = useMemo(
    () => [...new Set(feed.rows.filter((row) => row.liquidity && POOL_ID.test(row.poolId.toLowerCase())).map((row) => row.poolId.toLowerCase()))],
    [feed.rows],
  );
  const lpEventPoolKey = lpEventPools.join(",");
  useEffect(() => {
    const tokenAddress = token.address.trim().toLowerCase();
    const pools = lpEventPoolKey ? lpEventPoolKey.split(",") : [];
    const controller = new AbortController();
    let current = true;
    if (!ADDRESS.test(tokenAddress)) return () => controller.abort();

    void Promise.all(pools.map(async (pool) => {
      try {
        const query = new URLSearchParams({ pool });
        const response = await fetch(`/api/trades/${encodeURIComponent(tokenAddress)}/lp-custody?${query}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`LP custody request failed (${response.status})`);
        const result = await response.json() as LpCustodyResult;
        if (current) setLpCustodyByPool((previous) => ({ ...previous, [`${tokenAddress}:${pool}`]: result }));
      } catch {
        if (current && !controller.signal.aborted) {
          setLpCustodyByPool((previous) => ({ ...previous, [`${tokenAddress}:${pool}`]: { status: "faulted", pool } }));
        }
      }
    }));

    return () => {
      current = false;
      controller.abort();
    };
  }, [token.address, lpEventPoolKey]);

  // Price moves every refresh; reading it through a ref keeps holders to one fetch per token.
  const priceRef = useRef(token.priceUsd);
  useEffect(() => {
    priceRef.current = token.priceUsd;
  }, [token.priceUsd]);

  // Holder data is expensive and rate-limited, so only ask when its tab is opened.
  useEffect(() => {
    if (activeTab !== "holders") return;
    const address = token.address.toLowerCase();
    const controller = new AbortController();
    let isCurrent = true;
    setHolders([]);
    setTotalHolders(0);
    setHoldersUnavailable(false);
    setIsLoadingHolders(true);

    async function fromBlockscout(): Promise<{ rows: HolderRow[]; total: number } | null> {
      const base = `${explorerApiUrl}/tokens/${token.address}`;
      const [hr, tr] = await Promise.all([
        fetch(`${base}/holders`, { signal: controller.signal }),
        fetch(base, { signal: controller.signal }),
      ]);
      if (!hr.ok || !tr.ok) return null;
      const items = ((await hr.json()) as { items?: BlockscoutHolder[] }).items ?? [];
      const info = (await tr.json()) as { decimals?: string; total_supply?: string; holders_count?: string; holders?: string };
      const decimals = Number(info.decimals);
      const supply = BigInt(info.total_supply ?? "0");
      if (!Number.isInteger(decimals) || decimals < 0 || supply === 0n) return null;
      const rows = items.map((it, idx) => {
        const raw = BigInt(it.value);
        const amount = Number(formatUnits(raw, decimals));
        return {
          rank: idx + 1,
          address: it.address.hash,
          tag: it.address.name || undefined,
          percentage: Number((raw * 1_000_000n) / supply) / 10_000,
          amount: Math.round(amount),
          valueUsd: Math.round(amount * priceRef.current),
          raw: raw.toString(),
        };
      });
      return { rows, total: Number(info.holders_count ?? info.holders ?? rows.length) };
    }

    async function loadHolders() {
      try {
        const direct = await fromBlockscout().catch(() => null); // CORS, challenge or outage: use the configured server router
        if (!isCurrent || token.address.toLowerCase() !== address) return;
        if (direct) {
          setHolders(direct.rows);
          setTotalHolders(direct.total);
          setHoldersUnavailable(false);
          return;
        }
        const proxyRes = await fetch(`/api/scan/${token.address}/holders`, { signal: controller.signal });
        const proxyJson = proxyRes.ok
          ? ((await proxyRes.json()) as { holders?: HolderRow[] | null; total?: number; state?: string })
          : null;
        if (!isCurrent || token.address.toLowerCase() !== address) return;
        if (proxyJson?.state === "ok" && Array.isArray(proxyJson.holders)) {
          setHolders(proxyJson.holders);
          setTotalHolders(proxyJson.total ?? proxyJson.holders.length);
          setHoldersUnavailable(false);
        } else {
          setHoldersUnavailable(true);
        }
      } catch {
        if (isCurrent && !controller.signal.aborted) setHoldersUnavailable(true);
      } finally {
        if (isCurrent) setIsLoadingHolders(false);
      }
    }

    void loadHolders();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [activeTab, token.address]);

  useEffect(() => {
    // A row without base units is skipped (it keeps "—"), never the reason the rest go unpriced.
    const priced = holders.flatMap((h, i) => (h.raw && /^\d+$/.test(h.raw) ? [[i, BigInt(h.raw)] as const] : []));
    if (!priced.length) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const ethUsd = await readEthUsd(robinhoodPublicClient);
        const got = await holderExitUsd(token.address, priced.map(([, b]) => b), ethUsd, controller.signal, {}, token.pairAddress);
        if (controller.signal.aborted || !got) return;
        const usd: (number | null)[] = holders.map(() => null);
        priced.forEach(([i], j) => { usd[i] = got[j]; });
        setExit({ holders, usd });
      } catch {
        // Could not price: the explorer's value stays, labelled as such. Never a $0.
      }
    })();
    return () => controller.abort();
  }, [holders, token.address, token.pairAddress]);
  const exitUsd = exit?.holders === holders ? exit.usd : null;

  const wallets = useMemo(
    () => [...new Set(feed.rows.map((r) => r.traderAddress.toLowerCase()).filter(Boolean))],
    [feed.rows],
  );
  const facts = useWalletFacts(token.address, wallets, feed.poolIds);
  const tagsByWallet = useMemo(() => {
    const rate = fastTraders(feed.rows);
    const roundTrips = sameBlockRoundTrips(feed.rows);
    return new Map(wallets.map((w) => [w, walletTags(facts.get(w)?.facts, rate.get(w), roundTrips.has(w))]));
  }, [feed.rows, wallets, facts]);
  const isBot = (w: string) => !!tagsByWallet.get(w.toLowerCase())?.some((t) => t.kind === "bot");

  const filteredTxns: FeedRow[] = useMemo(
    () => feed.rows.filter((tx) =>
      (filterType === "all" || (filterType === "liquidity" ? !!tx.liquidity : !tx.liquidity && tx.type === filterType))
      && (!maker || tx.traderAddress.toLowerCase() === maker)
      && (!hideBots || !tagsByWallet.get(tx.traderAddress.toLowerCase())?.some((t) => t.kind === "bot"))),
    [feed.rows, filterType, maker, hideBots, tagsByWallet],
  );
  useEffect(() => { onContextRows?.(filteredTxns.slice(0, 8)); }, [filteredTxns, onContextRows]);
  const botRows = feed.rows.filter((r) => r.traderAddress && isBot(r.traderAddress)).length;
  const pulled = warnableRemoval(useLiquidityWatch(token.address));

  const isLive = feed.status === "live";
  const feedNote =
    feed.status === "paused" ? "Paused for a minute: the public RPC is rate limiting this connection, so your wallet gets it first."
    : feed.status === "unavailable" ? "Live trades are unavailable right now."
    : feed.status === "loading" ? "Loading recent trades..."
    : `Live from Robinhood Chain${feed.head ? ` (block #${feed.head})` : ""}`;
  // A quiet list after a pull must not read as a lull.
  const pullNote = !pulled ? null
    : pulled.atMs === null
      ? "The main pool has no liquidity left. It was removed more than 11 days ago, too far back to show here."
      : `Liquidity ${pulled.emptied ? "was removed" : "may have been removed"} from the main pool ${formatTimeAgo(pulled.atMs, undefined, nowMs)} (${utcClock(pulled.atMs)}).${
        pulled.lastTradeBeforeMs ? ` Last trade before that: ${formatTimeAgo(pulled.lastTradeBeforeMs, undefined, nowMs)}.` : ""}`;

  return (
    <div className={`flex flex-col rounded-xl border border-[#262626] bg-[#0c0c0c] overflow-hidden font-mono text-phi-xs shadow-lg ${className}`}>
      {/* Table Navigation Tabs */}
      <div className="flex shrink-0 flex-wrap items-center justify-between border-b border-[#202020] bg-[#121212] px-2 py-2">
        <div className="flex items-center gap-2">
          {[
            {
              id: "txns",
              label: (
                <span className="flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${isLive ? "bg-[#ccff00] animate-pulse" : "bg-[#777]"}`} />
                  Transactions {feed.rows.length > 0 && `(${feed.rows.length})`}
                </span>
              ),
            },
            { id: "traders", label: "Top Traders" },
            { id: "holders", label: `Holders (${totalHolders > 0 ? totalHolders.toLocaleString() : "..."})` },
            { id: "audit", label: "Verdict" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`rounded px-2 py-1.5 transition-colors ${
                activeTab === tab.id
                  ? "bg-[#202020] text-[#ccff00] font-bold border-b-2 border-[#ccff00]"
                  : "text-[#f0f0f0] hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter buttons if on transactions */}
        {activeTab === "txns" && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={hideBots}
              onClick={() => setHideBots((v) => !v)}
              title="Hide trades from wallets tagged as bots"
              className={`whitespace-nowrap rounded-lg border px-2.5 py-1 text-phi-xs transition-colors ${
                hideBots ? "border-[#3a4a5a] bg-[#121a22] text-[#9fc3e6] font-bold" : "border-[#242424] bg-[#181818] text-[#d4d4d4] hover:text-white"
              }`}
            >
              🤖 Hide bots{botRows > 0 ? ` (${botRows})` : ""}
            </button>

            <div className="flex items-center gap-1 bg-[#181818] p-0.5 rounded-lg border border-[#242424]">
              {(["all", "buy", "sell", "liquidity"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilterType(type)}
                  className={`rounded px-2.5 py-1 text-phi-xs capitalize transition-colors ${
                    filterType === type
                      ? type === "buy"
                        ? "bg-[#102012] text-[#8fbf6a] font-bold"
                        : type === "sell"
                          ? "bg-[#241210] text-[#e0897a] font-bold"
                          : type === "liquidity"
                            ? "bg-[#1f1a0c] text-[#e8c35a] font-bold"
                            : "bg-[#262626] text-white font-bold"
                      : "text-[#d4d4d4] hover:text-white"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Content Area - Flex-1 Scrollable */}
      <div className="@container no-scrollbar flex-1 min-h-0 overflow-x-auto overflow-y-auto">
        {/* TAB 1: Transactions Table (Real-Time Client-Side Streaming) */}
        {activeTab === "txns" && (
          <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-[#1c1c1c] bg-[#0d0d0d] px-2 py-1.5 text-phi-2xs text-[#f0f0f0]">
              <div className="flex items-center gap-2">
                <span className={`relative inline-flex rounded-full h-2 w-2 ${isLive ? "bg-[#ccff00]" : "bg-[#777]"}`} />
                <span className="text-[#f0f0f0]">{feedNote}</span>
              </div>
              {feed.pools > 0 && (
                <div className="shrink-0 text-[#bbb]">
                  {feed.pools} {feed.pools === 1 ? "pool" : "pools"}
                </div>
              )}
            </div>

            {pullNote && (
              <div role="status" className="border-b border-[#3a1c18] bg-[#1a0d0b] px-2 py-1.5 text-phi-2xs text-[#f0a494]">
                {pullNote}
              </div>
            )}

            {maker && (
              <div className="flex items-center justify-between border-b border-[#1c1c1c] bg-[#101410] px-2 py-1.5 text-phi-2xs text-[#d8f0a0]">
                <span>Showing only {maker.slice(0, 6)}...{maker.slice(-4)} ({filteredTxns.length} {filteredTxns.length === 1 ? "row" : "rows"})</span>
                <button type="button" onClick={() => setMaker(null)} className="flex items-center gap-1 text-[#bbb] hover:text-white">
                  <X className="size-3" /> Show all
                </button>
              </div>
            )}

            {feed.rows.length === 0 && feed.status === "loading" ? (
              <TableRowsSkeleton cols={[14, 12, 14, 16, 14, 18]} label={`Loading recent trades for ${token.symbol}`} />
            ) : feed.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center text-[#f0f0f0] gap-3">
                <Radio className="size-5 text-[#888]" />
                <p className="text-phi-xs text-[#e5e5e5] max-w-sm">
                  {feed.status === "loading"
                    ? `Loading recent trades for ${token.symbol}...`
                    : feed.historyFailed
                      ? "Recent trade history could not be loaded. New trades will appear here as they happen."
                      : `No recent trades for ${token.symbol}. New trades will appear here as they happen.`}
                </p>
              </div>
            ) : (
              // table-fixed: widths come from the header, so a new row's longer number cannot reflow the columns.
              <table className="w-full min-w-[840px] table-fixed border-collapse text-left tabular-nums">
                <thead className="sticky top-0 z-10 bg-[#0e0e0e]">
                  <tr className="text-phi-2xs tracking-wider text-[#cfd4d1] font-bold">
                    <th className={`${TH} w-[92px]`}>DATE</th>
                    <th className={`${TH} w-[112px]`}>TYPE</th>
                    <th className={`${TH} w-[108px] text-right`}>USD</th>
                    <th className={`${TH} w-[116px] text-right`}>{token.symbol}</th>
                    {/* Repeats USD in the quote asset; folded away before any column is clipped. */}
                    <th className={`${TH} hidden w-[128px] text-right @[52rem]:table-cell`}>PAID / GOT</th>
                    <th className={`${TH} w-[100px] text-right`}>PRICE</th>
                    <th className={TH} title={`The animal is what the wallet holds now. ${HOLDING_LEGEND}`}>TRADER</th>
                    <th className={`${TH} w-[44px] text-center`}>TXN</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTxns.map((tx) => (
                    <tr key={tx.id} className={`group text-phi-xs transition-colors ${
                      tx.liquidity === "remove" ? "bg-[#1f0e0c] hover:bg-[#2a120f]"
                        : tx.liquidity === "add" ? "bg-[#17140a] hover:bg-[#1f1b0d]"
                        : "odd:bg-[#0c0e0d] even:bg-[#0f1211] hover:bg-[#161b17]"}`}>
                      <td className={`${TD} text-[#aab2ad] group-hover:shadow-[inset_2px_0_0_#ccff00]`}>{formatTimeAgo(tx.timestamp, tx.date, nowMs)}</td>
                      <td className={TD}>
                        {tx.liquidity ? (
                          <span className="flex min-w-0 flex-col">
                            <span title={tx.liquidity === "add" ? "Liquidity added to the pool" : "Liquidity removed from the pool"} className={`truncate font-bold ${tx.liquidity === "add" ? "text-[#e8c35a]" : "text-[#ff6b57]"}`}>
                              {tx.liquidity === "add" ? "+ LP added" : "− LP removed"}
                            </span>
                            {(() => {
                              const custody = lpCustodyByPool[`${token.address.toLowerCase()}:${tx.poolId.toLowerCase()}`];
                              let context = "Checking";
                              if (custody?.status === "complete") context = custody.summary;
                              else if (custody?.status === "not-checked") context = "Not checked";
                              else if (custody?.status === "incomplete") context = "Holders not fully read";
                              else if (custody?.status === "faulted") context = "Unavailable";
                              const title = custody?.status === "complete"
                                ? `Current pool custody at block ${custody.asOfBlock}. This does not identify who made this historical liquidity change. ${custody.summary}`
                                : `Current pool custody: ${context}. This does not identify who made this historical liquidity change.`;
                              if (custody?.status === "not-checked" && custody.disabled) return null;
                              return (
                                <span title={title} className={`truncate text-[10px] leading-4 ${custody?.status === "complete" ? "text-[#9da49b]" : "text-[#777]"}`}>
                                  Current pool: {context}
                                </span>
                              );
                            })()}
                          </span>
                        ) : (
                          <span className={`font-bold ${tx.type === "buy" ? "text-[#8fbf6a]" : "text-[#e0897a]"}`}>
                            {tx.type === "buy" ? "↑ Buy" : "↓ Sell"}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-right text-white font-bold`}>
                        {tx.v4 && Number.isFinite(tx.usdAmount) ? "≈" : ""}{Number.isFinite(tx.usdAmount) ? "$" : ""}{num(tx.usdAmount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className={`${TD} text-right text-[#e6e6e6]`}>
                        {tx.tokenAmount >= 100_000
                          ? num(tx.tokenAmount, { notation: "compact", maximumFractionDigits: 2 })
                          : num(tx.tokenAmount, { maximumFractionDigits: tx.tokenAmount < 1 ? 6 : 2 })}
                      </td>
                      <td className={`${TD} hidden text-right text-[#e6e6e6] @[52rem]:table-cell`}>
                        {tx.v4 && Number.isFinite(tx.ethAmount) ? "≈" : ""}{num(tx.ethAmount, { maximumFractionDigits: 4 })} {tx.quoteSymbol}
                      </td>
                      <td className={`${TD} text-right font-semibold ${
                        tx.liquidity ? "text-[#888]" : tx.type === "buy" ? "text-[#8fbf6a]" : "text-[#e0897a]"}`}>
                        {tx.liquidity ? "" : Number.isFinite(tx.priceUsd) ? formatDexPrice(tx.priceUsd) : "—"}
                      </td>
                      <td className={`${TD} font-mono text-[#e6e6e6]`}>
                        {tx.traderAddress ? (
                          <span className="flex min-w-0 items-center gap-1.5">
                            {(() => {
                              const tier = holdingTier(facts.get(tx.traderAddress.toLowerCase())?.facts.heldShare);
                              return tier ? (
                                <span title={tier.title} className={`shrink-0 font-sans ${tier.icon === "🐳" ? "rounded border border-[#1f4a44] bg-[#0d1d1b] px-1 py-px text-phi-2xs text-[#6fe0cc]" : ""}`}>
                                  {tier.label}
                                </span>
                              ) : null;
                            })()}
                            <button
                              type="button"
                              onClick={() => setMaker((m) => (m === tx.traderAddress.toLowerCase() ? null : tx.traderAddress.toLowerCase()))}
                              title="Show only this wallet's trades"
                              className="shrink-0 hover:text-[#ccff00]"
                            >
                              {tx.traderAddress.slice(0, 6).toLowerCase()}...{tx.traderAddress.slice(-4).toLowerCase()}
                            </button>
                            <a
                              href={`${explorerWebUrl}/address/${tx.traderAddress}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-[#666] hover:text-[#ccff00]"
                              title="Open in explorer"
                            >
                              <ExternalLink className="size-2.5" />
                            </a>
                            {tagsByWallet.get(tx.traderAddress.toLowerCase())?.map((t) => (
                              <span key={t.kind} title={t.title} className={`shrink-0 rounded border px-1 py-px text-phi-2xs font-sans ${TAG_STYLE[t.kind]}`}>
                                {t.label}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-[#888]">...</span>
                        )}
                      </td>
                      <td className={`${TD} text-center`}>
                        <a
                          href={`${explorerWebUrl}/tx/${tx.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-[#bbb] hover:text-[#ccff00]"
                          title="View on Robinhood Explorer"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 2: Top Traders Table */}
        {activeTab === "traders" && (
          topTraders.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-[#f0f0f0] gap-2">
              <Users className="size-6 text-[#888]" />
              <div className="font-bold text-phi-xs text-white">No Trader Data Available</div>
              <p className="text-phi-xs text-[#e5e5e5] max-w-sm">
                Top trader profiling is currently unavailable for this token.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-separate border-spacing-y-1">
              <thead className="sticky top-0 z-10 bg-[#0e0e0e]">
                <tr className="border-b border-[#242424] text-phi-2xs tracking-wider text-white font-bold">
                  <th className="px-4 py-2.5"># RANK</th>
                  <th className="px-4 py-2.5">TRADER</th>
                  <th className="px-4 py-2.5 text-right">PNL USD</th>
                  <th className="px-4 py-2.5 text-right">PNL %</th>
                  <th className="px-4 py-2.5 text-right">TOTAL BOUGHT</th>
                  <th className="px-4 py-2.5 text-right">TOTAL SOLD</th>
                  <th className="px-4 py-2.5 text-right">TXS</th>
                </tr>
              </thead>
              <tbody>
                {topTraders.map((tr) => (
                  <tr key={tr.rank} className="border border-[#202424] bg-[#0e1110] odd:bg-[#0e1110] even:bg-[#111413] hover:bg-[#181c17] hover:border-[#2b382a] transition-colors group">
                    <td className="px-4 py-2.5 text-[#ccff00] font-bold border-y border-l-2 border-l-transparent group-hover:border-l-[#ccff00] first:rounded-l-lg">#{tr.rank}</td>
                    <td className="px-4 py-2.5 text-white">
                      <a
                        href={`${explorerWebUrl}/address/${tr.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[#ccff00]"
                      >
                        {tr.address.slice(0, 6)}...{tr.address.slice(-4)}
                      </a>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-bold ${tr.pnlUsd >= 0 ? "text-[#8fbf6a]" : "text-[#e0897a]"}`}>
                      {tr.pnlUsd >= 0 ? "+" : ""}${tr.pnlUsd.toLocaleString("en-US")}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${(tr.pnlPct ?? tr.roi ?? 0) >= 0 ? "text-[#8fbf6a]" : "text-[#e0897a]"}`}>
                      {(tr.pnlPct ?? tr.roi ?? 0) >= 0 ? "+" : ""}{(tr.pnlPct ?? tr.roi ?? 0).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#f0f0f0]">
                      ${(tr.boughtUsd ?? 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[#f0f0f0]">
                      ${(tr.soldUsd ?? 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2.5 text-right text-white font-bold">
                      {tr.txCount ?? tr.txns ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {/* TAB 3: Real-Time Holders Table (Explorer Driven) */}
        {activeTab === "holders" && (
          <div>
            {isLoadingHolders && holders.length === 0 ? (
              <TableRowsSkeleton cols={[8, 30, 18, 14]} label="Loading holders" />
            ) : holdersUnavailable ? (
              <div role="status" className="p-12 text-center text-[#d4d4d4]">
                Holder data is unavailable from the configured explorer sources right now.
              </div>
            ) : (
              <table className="w-full text-left border-separate border-spacing-y-1">
                <thead className="sticky top-0 z-10 bg-[#0e0e0e]">
                  <tr className="border-b border-[#242424] text-phi-2xs tracking-wider text-white font-bold">
                    <th className="px-4 py-2.5"># RANK</th>
                    <th className="px-4 py-2.5">HOLDER ADDRESS</th>
                    <th className="px-4 py-2.5">LABEL</th>
                    <th className="px-4 py-2.5 text-right">% OF SUPPLY</th>
                    <th className="px-4 py-2.5 text-right">AMOUNT</th>
                    <th className="px-4 py-2.5 text-right" title={exitUsd ? "What selling this whole balance would return right now, through the token's own pools" : "Balance times the listed price, not what it could be sold for"}>
                      {exitUsd ? "IF SOLD NOW" : "VALUE USD"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {holders.map((h, i) => (
                    <tr key={h.rank} className="border border-[#202424] bg-[#0e1110] odd:bg-[#0e1110] even:bg-[#111413] hover:bg-[#181c17] hover:border-[#2b382a] transition-colors group">
                      <td className="px-4 py-2.5 text-[#ccff00] font-bold border-y border-l-2 border-l-transparent group-hover:border-l-[#ccff00] first:rounded-l-lg">#{h.rank}</td>
                      <td className="px-4 py-2.5 text-white">
                        <a
                          href={`${explorerWebUrl}/address/${h.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-[#ccff00] font-mono"
                        >
                          {h.address.slice(0, 8)}...{h.address.slice(-6)}
                        </a>
                      </td>
                      <td className="px-4 py-2.5">
                        {h.tag ? (
                          <span className="rounded bg-[#ccff00]/10 text-[#ccff00] border border-[#ccff00]/30 px-2 py-0.5 text-phi-2xs">
                            {h.tag}
                          </span>
                        ) : (
                          <span className="text-[#d4d4d4]">Individual Wallet</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-white">
                        {h.percentage.toFixed(2)}%
                      </td>
                      <td className="px-4 py-2.5 text-right text-[#f0f0f0]">
                        {h.amount.toLocaleString("en-US")} {token.symbol}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-white">
                        {exitUsd
                          ? exitUsd[i] === null
                            ? <span title="No route could price this balance">—</span>
                            : `$${Math.round(exitUsd[i]!).toLocaleString("en-US")}`
                          : `$${h.valueUsd.toLocaleString("en-US")}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 4: The Verdict & TheRecord */}
        {activeTab === "audit" && (
          <div className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#202020] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="size-5 text-[#ccff00]" />
                  <h3 className="font-bold font-cinzel tracking-wider text-phi-sm sm:text-phi-md text-white">THE VERDICT</h3>
                </div>
                <p className="text-phi-xs text-[#f0f0f0] mt-0.5">
                  Static analysis, monotone capabilities & on-chain simulation verified on Robinhood Chain (4663).
                </p>
              </div>

              <div className="text-right">
                {record?.stamps && record.stamps.length > 0 ? (
                  <span className="rounded-xl border border-[#ccff00] bg-[#ccff00]/10 px-3 py-1 font-bold text-phi-xs text-[#ccff00]">
                    {isOwnToken(token.address) ? "NOT SCORED" : `${record.stamps[0].score}/100 · ${record.stamps[0].tier}`}
                  </span>
                ) : (
                  <span className="rounded-xl border border-[#333] bg-[#1a1a1a] px-3 py-1 text-phi-xs text-[#f0f0f0]">
                    No Archived Verdict Yet
                  </span>
                )}
              </div>
            </div>

            {/* Per-check results live in TheRecord below; no summary pills that could disagree with it. */}
            {!record?.stamps?.length && (
              <div className="rounded-lg border border-[#202020] bg-[#111111] p-3 text-phi-xs text-[#f0f0f0]">
                No historical scan on record for this token. Run a scan on RobinCalls to generate verdict checks.
              </div>
            )}

            {/* Authentic TheRecord component from /rwa and /scan */}
            <div className="pt-2">
              <TheRecord record={record ?? null} tokenAddress={token.address} />
            </div>

            <div className="pt-3 border-t border-[#1e1e1e] flex flex-wrap items-center justify-between gap-3">
              <span className="text-phi-xs text-[#f0f0f0]">
                Every check hashes into an immutable tamper-evident ledger.
              </span>
              <Link
                href={`/scan/${token.address}`}
                className="inline-flex items-center gap-2 rounded-lg border border-[#ccff00] bg-[#ccff00] px-3.5 py-1.5 font-bold text-phi-xs text-[#0a0a0a] hover:bg-[#b8e600] transition-colors"
              >
                {record?.stamps && record.stamps.length > 0 ? "Inspect Full Disclosures on /scan →" : "Run First Scan on /scan →"}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Placeholder rows shaped like the table (one bar per column, widths in %), so it does not jump on load. */
function TableRowsSkeleton({ cols, label }: { cols: number[]; label: string }) {
  return (
    <div aria-label={label} aria-busy="true" className="divide-y divide-[#1a1a1a]">
      {Array.from({ length: 8 }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {cols.map((w, c) => (
            <ShimmerBlock key={c} className={`h-3.5 rounded ${c === 0 ? "" : "ml-auto"}`} style={{ width: `${w}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
