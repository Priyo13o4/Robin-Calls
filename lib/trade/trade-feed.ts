import { decodeAbiParameters, formatUnits, toEventSelector, type Hex } from "viem";
import { ROBINHOOD_CHAIN_ID, robinhoodChain } from "@/lib/config/chain";
import { COMMON_BASES_BY_CHAIN, type TransactionRow } from "./types";
import { v4LiquiditySlot } from "@/lib/dex/v4-state-slot";
import { publishLiquidity, type LiquidityWatch, type MainPoolRemoval } from "./liquidity-watch";
import { V4_POOL_MANAGER, V2_MINT, V2_BURN, V3_MINT, V3_BURN, V4_MODIFY, decodeLpLog, isBirth, recordAnswersLookback, type LpEvent, type PoolLpRecord, type StoredLpEvent, fromStored } from "./lp-events";
import { factCache } from "../swap/fact-cache";
import { readRwaTerminalPairs } from "./rwa-terminal-market";

/**
 * Browser-side trade ticker: GeckoTerminal for the last 300 trades per pool (lags about a
 * minute), then public-RPC Swap logs from that point on. Runs on the visitor's IP, which
 * is also the IP their wallet broadcasts from, so every RPC call goes through RpcBudget.
 */

export const V2_SWAP = toEventSelector("Swap(address,uint256,uint256,uint256,uint256,address)");
export const V3_SWAP = toEventSelector("Swap(address,address,int256,int256,uint160,uint128,int24)");
export const V4_SWAP = toEventSelector("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)");
export { V4_POOL_MANAGER, V2_MINT, V2_BURN, V3_MINT, V3_BURN, V4_MODIFY };
const TRANSFER = toEventSelector("Transfer(address,address,uint256)");
/** The public node's own per-request cap (~11.5 days): 10M answered in 0.36 s, 30M refused (measured). */
const LIQUIDITY_LOOKBACK_BLOCKS = 10_000_000;
/** An older pool that still holds liquidity is not searched at all. */
const LOOKBACK_ALWAYS_UNDER_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_HALVINGS = 3;
const LIQUIDITY_LOOKBACK_KEEP = 20;

const RPC_URL = robinhoodChain.rpcUrls.default.http[0];
const GT_BASE = "https://api.geckoterminal.com/api/v2/networks/robinhood";
const DS_BASE = "https://api.dexscreener.com";
const REQUEST_TIMEOUT_MS = 8_000;
const requestSignal = (signal: AbortSignal) => AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
const historyCache = factCache<GtTrade[]>(30_000, 256);
let geckoCooldownUntil = 0;
let geckoActive = 0;
const geckoQueue: Array<() => void> = [];
const MAX_GECKO_QUEUE = 32;

function geckoSlot<T>(work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      geckoActive += 1;
      void work().then(resolve, reject).finally(() => {
        geckoActive -= 1;
        geckoQueue.shift()?.();
      });
    };
    if (geckoActive < 2) run();
    else if (geckoQueue.length < MAX_GECKO_QUEUE) geckoQueue.push(run);
    else reject(new Error("geckoterminal request queue full"));
  });
}

function withCallerAbort<T>(shared: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** ~0.1 s blocks; used only to date live rows, which the public node returns without a timestamp. */
const BLOCK_MS = 100;
export const MAX_POOLS = 8;
const HISTORY_POOLS = 3;
const MAX_ROWS = 100;
/** Past this many blocks (~5 min hidden) the gap is refilled from GeckoTerminal instead of logs. */
const MAX_LOG_GAP = 3_000;
const LOOKUPS_PER_POLL = 4;
/**
 * Wallet lookups cost one RPC each and the budget leaves ~1 per tick, so a busy pool outruns
 * them. GeckoTerminal's trades carry the wallet at no RPC cost once its ~1 min lag passes.
 */
export const WALLET_BACKFILL_MS = 30_000;
export const POLL_MS = 3_000;
/** The relay forgets a watched token after 2 min; re-register well inside that. */
export const RELAY_WATCH_MS = 60_000;
const RELAY_MAX_HASHES = 30;
const RELAY_MAX_POOLS = 6;
/** The public node locks the whole IP out for 60 s once it trips; back off at least that long. */
export const RATE_LIMIT_PAUSE_MS = 65_000;

export interface FeedPool {
  id: string;
  /** Pool contract (V2/V3) or poolId (V4); V4 ids are 32 bytes. */
  isV4: boolean;
  other: string;
  otherSymbol: string;
  otherDecimals: number | null;
  otherUsd: number;
  /** This token's USD price on the pool, for valuing a liquidity row's token side. 0 = unknown. */
  tokenUsd?: number;
  volume24h: number;
  /** From DexScreener labels; null when they do not say (the depth read is then skipped). */
  protocol?: "v2" | "v3" | "v4" | null;
  createdAtMs?: number | null;
}

export interface FeedRow extends TransactionRow {
  block: number;
  poolId: string;
  quoteSymbol: string;
  /** A liquidity add or removal rather than a trade. `type` then carries no meaning. */
  liquidity?: "add" | "remove";
  /** V4 amounts are not in the event; filled from the receipt, and approximate (they include fees). */
  v4?: { liquidity: bigint; tickLower: number; tickUpper: number; tokenIsCurrency0: boolean; filled: boolean };
  /** What was added or removed, in the unit the pool's own depth read returns (V2: token raw). */
  lp?: { protocol: "v2" | "v3" | "v4"; amount: bigint };
  /** `timestamp` came from the log's own blockTimestamp, not estimated from the block gap. */
  timeExact?: boolean;
  /** Receipt sender, kept as the RPC fallback only: the relay names a smart wallet, this names its bundler (§8 #19). */
  txFrom?: string;
}

export class RateLimited extends Error {}

/** Token bucket shared by every RPC call the ticker makes; a 429 empties it for RATE_LIMIT_PAUSE_MS. */
export class RpcBudget {
  private tokens: number;
  private at: number;
  pausedUntil = 0;
  constructor(private perSec: number, private cap: number, private now: () => number = Date.now) {
    this.tokens = cap;
    this.at = now();
  }
  take(n = 1): boolean {
    const t = this.now();
    if (t < this.pausedUntil) return false;
    this.tokens = Math.min(this.cap, this.tokens + ((t - this.at) / 1000) * this.perSec);
    this.at = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
  pause(ms = RATE_LIMIT_PAUSE_MS) {
    this.pausedUntil = this.now() + ms;
    this.tokens = 0;
  }
}

/** One browser-session budget for RWA feeds, retained across token/pool reprioritization. */
const rwaRpcBudget = new RpcBudget(1, 6);

const KNOWN_DECIMALS = new Map(
  (COMMON_BASES_BY_CHAIN[ROBINHOOD_CHAIN_ID] ?? []).map((t) => [t.address.toLowerCase(), t.decimals]),
);

interface DsPair {
  pairAddress?: string;
  labels?: string[];
  baseToken?: { address?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceNative?: string;
  priceUsd?: string;
  volume?: { h24?: number };
  pairCreatedAt?: number;
}

/** Pools that trade the token, busiest first. Ranked by volume, not liquidity: V4 liquidity figures are unreliable (L211). */
export function poolsFromPairs(token: string, pairs: DsPair[], primary?: string): FeedPool[] {
  const t = token.toLowerCase();
  const out: FeedPool[] = [];
  for (const p of pairs) {
    const id = p.pairAddress?.toLowerCase();
    const base = p.baseToken?.address?.toLowerCase();
    const quote = p.quoteToken?.address?.toLowerCase();
    if (!id || !base || !quote || (base !== t && quote !== t)) continue;
    const tokenIsBase = base === t;
    const priceUsd = Number(p.priceUsd);
    const priceNative = Number(p.priceNative);
    // DexScreener prices the base: the other side's USD is priceUsd/priceNative when we are the base.
    const otherUsd = tokenIsBase ? priceUsd / priceNative : priceUsd;
    const tokenUsd = tokenIsBase ? priceUsd : priceUsd / priceNative;
    const other = tokenIsBase ? quote : base;
    out.push({
      id,
      isV4: id.length === 66,
      other,
      otherSymbol: (tokenIsBase ? p.quoteToken?.symbol : p.baseToken?.symbol) ?? "?",
      otherDecimals: KNOWN_DECIMALS.get(other) ?? null,
      otherUsd: Number.isFinite(otherUsd) && otherUsd > 0 ? otherUsd : 0,
      tokenUsd: Number.isFinite(tokenUsd) && tokenUsd > 0 ? tokenUsd : 0,
      volume24h: p.volume?.h24 ?? 0,
      protocol: id.length === 66 ? "v4" : p.labels?.includes("v3") ? "v3" : p.labels?.includes("v2") ? "v2" : null,
      createdAtMs: typeof p.pairCreatedAt === "number" && p.pairCreatedAt > 0 ? p.pairCreatedAt : null,
    });
  }
  const primaryId = primary?.toLowerCase();
  out.sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || b.volume24h - a.volume24h);
  return out.slice(0, MAX_POOLS);
}

export async function fetchPools(token: string, primary: string | undefined, signal: AbortSignal, marketSource?: "rwa"): Promise<FeedPool[]> {
  if (marketSource === "rwa") {
    const observation = await withCallerAbort(readRwaTerminalPairs(token), signal);
    if (signal.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    if (!observation) throw new Error("RWA market pairs unavailable");
    const pairs: DsPair[] = observation.pairs.filter((pair) => pair.chainId?.toLowerCase() === "robinhood").map((pair) => ({
      pairAddress: pair.pairAddress,
      labels: pair.labels,
      baseToken: pair.baseToken,
      quoteToken: pair.quoteToken,
      priceUsd: pair.priceUsd === undefined ? undefined : String(pair.priceUsd),
      priceNative: pair.priceNative === undefined ? undefined : String(pair.priceNative),
      volume: pair.volume,
      pairCreatedAt: pair.pairCreatedAt,
    }));
    return poolsFromPairs(token, pairs, primary);
  }
  const r = await fetch(`${DS_BASE}/token-pairs/v1/robinhood/${token}`, { signal: requestSignal(signal), headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`dexscreener ${r.status}`);
  return poolsFromPairs(token, (await r.json()) as DsPair[], primary);
}

interface GtTrade {
  attributes: {
    block_number: number;
    block_timestamp: string;
    tx_hash: string;
    tx_from_address: string;
    from_token_address: string;
    to_token_address: string;
    from_token_amount: string;
    to_token_amount: string;
    volume_in_usd: string;
  };
}

/** Side from which way the token moved, never GeckoTerminal's `kind`, which is relative to its own base (§8 #21). */
export function rowFromGtTrade(token: string, pool: FeedPool, tr: GtTrade): FeedRow | null {
  const a = tr.attributes;
  const t = token.toLowerCase();
  const buy = a.to_token_address?.toLowerCase() === t;
  if (!buy && a.from_token_address?.toLowerCase() !== t) return null;
  const tokenAmount = Number(buy ? a.to_token_amount : a.from_token_amount);
  const quoteAmount = Number(buy ? a.from_token_amount : a.to_token_amount);
  const usd = Number(a.volume_in_usd);
  return {
    id: `${a.tx_hash}:${pool.id}`,
    date: "",
    timestamp: Date.parse(a.block_timestamp),
    type: buy ? "buy" : "sell",
    usdAmount: usd,
    tokenAmount,
    ethAmount: quoteAmount,
    priceUsd: tokenAmount > 0 ? usd / tokenAmount : 0,
    traderAddress: a.tx_from_address,
    txHash: a.tx_hash,
    block: a.block_number,
    poolId: pool.id,
    quoteSymbol: pool.otherSymbol,
  };
}

export async function fetchHistory(token: string, pools: FeedPool[], signal: AbortSignal): Promise<{ rows: FeedRow[]; newestBlock: number | null; failed: number }> {
  const rows: FeedRow[] = [];
  let newestBlock: number | null = null;
  let failed = 0;
  await Promise.all(pools.slice(0, HISTORY_POOLS).map(async (pool) => {
    try {
      const trades = await withCallerAbort(historyCache.get(pool.id.toLowerCase(), async () => {
        if (Date.now() < geckoCooldownUntil) throw new Error("geckoterminal cooldown");
        return geckoSlot(async () => {
          if (Date.now() < geckoCooldownUntil) throw new Error("geckoterminal cooldown");
          const r = await fetch(`${GT_BASE}/pools/${pool.id}/trades`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { accept: "application/json" } });
          if (r.status === 429) {
            geckoCooldownUntil = Date.now() + 60_000;
            throw new Error("geckoterminal 429");
          }
          if (!r.ok) throw new Error(`geckoterminal ${r.status}`);
          const body = (await r.json()) as { data?: GtTrade[] };
          if (!Array.isArray(body.data)) throw new Error("geckoterminal trades missing data array");
          return body.data.map((trade): GtTrade => {
            if (!trade || typeof trade !== "object" || !trade.attributes || typeof trade.attributes !== "object" || Array.isArray(trade.attributes)) {
              throw new Error("geckoterminal trade attributes malformed");
            }
            const a = trade.attributes as Partial<GtTrade["attributes"]>;
            const blockValue: unknown = a.block_number;
            const block = Number(blockValue);
            const timestamp = typeof a.block_timestamp === "string" ? Date.parse(a.block_timestamp) : NaN;
            const nonnegativeNumber = (value: unknown) =>
              (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
              Number.isFinite(Number(value)) && Number(value) >= 0;
            const numeric = [a.from_token_amount, a.to_token_amount, a.volume_in_usd].every(nonnegativeNumber);
            const hasBlockNumber = typeof blockValue === "number" ||
              (typeof blockValue === "string" && blockValue.trim() !== "");
            if (!hasBlockNumber || !Number.isInteger(block) || block < 0 || !Number.isFinite(timestamp) || typeof a.tx_hash !== "string" || !a.tx_hash ||
              typeof a.from_token_address !== "string" || !a.from_token_address || typeof a.to_token_address !== "string" || !a.to_token_address || !numeric) {
              throw new Error("geckoterminal trade fields malformed");
            }
            return {
              attributes: {
                block_number: block,
                block_timestamp: a.block_timestamp!,
                tx_hash: a.tx_hash,
                // Missing sender is unknown; wallet backfill can still answer it later.
                tx_from_address: typeof a.tx_from_address === "string" ? a.tx_from_address : "",
                from_token_address: a.from_token_address,
                to_token_address: a.to_token_address,
                from_token_amount: String(a.from_token_amount),
                to_token_amount: String(a.to_token_amount),
                volume_in_usd: String(a.volume_in_usd),
              },
            };
          });
        });
      }), signal);
      for (const tr of trades) {
        const row = rowFromGtTrade(token, pool, tr);
        if (!row) continue;
        rows.push(row);
        newestBlock = Math.max(newestBlock ?? 0, row.block);
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") throw e;
      failed++;
    }
  }));
  return { rows, newestBlock, failed };
}

/**
 * Senders the sequencer relay saw for these txs (same origin, Valkey only, no RPC). Also keeps
 * the token on the relay's watch list. An absent hash is "not seen", so callers keep a fallback.
 */
export async function fetchRelaySenders(token: string, pools: FeedPool[], hashes: string[], signal: AbortSignal): Promise<Map<string, string>> {
  const q = new URLSearchParams({
    pools: pools.slice(0, RELAY_MAX_POOLS).map((p) => p.id.toLowerCase()).join(","),
    tx: hashes.slice(0, RELAY_MAX_HASHES).map((h) => h.toLowerCase()).join(","),
  });
  const r = await fetch(`/api/trades/${token.toLowerCase()}/senders?${q}`, { signal: requestSignal(signal), headers: { accept: "application/json" } });
  const out = new Map<string, string>();
  if (!r.ok) return out;
  const j = (await r.json()) as { senders?: Record<string, { from?: string }> };
  for (const [hash, s] of Object.entries(j.senders ?? {})) if (s?.from) out.set(hash, s.from);
  return out;
}

export interface StoredLiquidity { coverage: { epoch: number; through: number } | null; record: PoolLpRecord | null }

/** The sequencer's recorded history for one pool (same origin, Valkey only). Null: not answered. */
export async function fetchStoredLiquidity(token: string, poolId: string, signal: AbortSignal): Promise<StoredLiquidity | null> {
  const r = await fetch(`/api/trades/${token.toLowerCase()}/liquidity?pool=${poolId.toLowerCase()}`, { signal: requestSignal(signal), headers: { accept: "application/json" } });
  if (!r.ok) return null;
  const j = (await r.json()) as Partial<StoredLiquidity>;
  return { coverage: j.coverage ?? null, record: j.record ?? null };
}

/** Past this, the gap between the record and the live window is not worth one narrow read. */
const MAX_STORED_GAP = 36_000;

/**
 * The stored record in place of the lookback search, or null when it cannot answer: the pool's
 * newest removal is only known if we saw the pool born or saw a removal (recordAnswersLookback).
 * `gap` is the block span between the record and the live window, still to be read.
 */
export function planStoredLookback(stored: StoredLiquidity | null, liveFrom: number | null, poolId: string): { events: LpEvent[]; gap: { from: number; to: number } | null } | null {
  const rec = stored?.record;
  const cov = stored?.coverage;
  if (!rec || !cov || liveFrom === null || rec.epoch !== cov.epoch || !recordAnswersLookback(rec)) return null;
  const gapFrom = cov.through + 1;
  if (liveFrom - gapFrom > MAX_STORED_GAP) return null;
  const seen = new Set<string>();
  const kept: StoredLpEvent[] = [];
  for (const e of [...rec.events, ...(rec.lastRemove ? [rec.lastRemove] : [])]) {
    const k = `${e.tx}:${e.index}`;
    if (!seen.has(k)) { seen.add(k); kept.push(e); }
  }
  const pool = poolId.toLowerCase();
  return { events: kept.map((e) => fromStored(e, pool, rec.protocol)).sort((a, b) => a.block - b.block), gap: gapFrom < liveFrom ? { from: gapFrom, to: liveFrom - 1 } : null };
}

interface RawLog { address: string; topics: Hex[]; data: Hex; blockNumber: Hex; transactionHash: Hex; blockTimestamp?: Hex }

/**
 * Signed token and counter-asset amounts from the SWAPPER's side (positive = received).
 * V2 reports in/out, V3 the pool's deltas, V4 the swapper's own deltas.
 */
export function swapperDeltas(log: RawLog, tokenIsCurrency0: boolean): { token: bigint; other: bigint } | null {
  let a0: bigint, a1: bigint;
  const topic0 = log.topics[0];
  if (topic0 === V2_SWAP) {
    const [in0, in1, out0, out1] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], log.data);
    a0 = out0 - in0;
    a1 = out1 - in1;
  } else if (topic0 === V3_SWAP) {
    const [p0, p1] = decodeAbiParameters([{ type: "int256" }, { type: "int256" }], log.data);
    a0 = -p0;
    a1 = -p1;
  } else if (topic0 === V4_SWAP) {
    [a0, a1] = decodeAbiParameters([{ type: "int128" }, { type: "int128" }], log.data);
  } else {
    return null;
  }
  return tokenIsCurrency0 ? { token: a0, other: a1 } : { token: a1, other: a0 };
}

const abs = (x: bigint) => (x < 0n ? -x : x);

/** One row per tx per pool, like GeckoTerminal, so the two sources dedupe on the same key. */
export function rowsFromLogs(
  token: string,
  tokenDecimals: number,
  pools: FeedPool[],
  logs: RawLog[],
  head: number,
  headAt: number,
): FeedRow[] {
  const t = token.toLowerCase();
  const byId = new Map(pools.map((p) => [p.id, p]));
  const sums = new Map<string, { pool: FeedPool; tok: bigint; oth: bigint; block: number; tx: string }>();
  for (const log of logs) {
    const poolId = (log.topics[0] === V4_SWAP ? log.topics[1] : log.address).toLowerCase();
    const pool = byId.get(poolId);
    if (!pool) continue;
    const d = swapperDeltas(log, t < pool.other);
    if (!d) continue;
    const key = `${log.transactionHash}:${poolId}`;
    const s = sums.get(key) ?? { pool, tok: 0n, oth: 0n, block: Number(log.blockNumber), tx: log.transactionHash };
    s.tok += d.token;
    s.oth += d.other;
    sums.set(key, s);
  }
  const rows: FeedRow[] = [];
  for (const [key, s] of sums) {
    if (s.tok === 0n) continue;
    const tokenAmount = Number(formatUnits(abs(s.tok), tokenDecimals));
    // NaN, not 0, when a decimals or price read is missing: the table renders it as unknown.
    const quoteAmount = s.pool.otherDecimals === null ? NaN : Number(formatUnits(abs(s.oth), s.pool.otherDecimals));
    const usd = s.pool.otherUsd > 0 ? quoteAmount * s.pool.otherUsd : NaN;
    rows.push({
      id: key,
      date: "",
      timestamp: headAt - (head - s.block) * BLOCK_MS,
      type: s.tok > 0n ? "buy" : "sell",
      usdAmount: usd,
      tokenAmount,
      ethAmount: quoteAmount,
      priceUsd: tokenAmount > 0 ? usd / tokenAmount : NaN,
      traderAddress: "",
      txHash: s.tx,
      block: s.block,
      poolId: s.pool.id,
      quoteSymbol: s.pool.otherSymbol,
    });
  }
  return rows;
}

/** Liquidity adds and removals as rows. V2/V3 carry both amounts; V4 carries only liquidity. */
export function liquidityRowsFromLogs(
  token: string,
  tokenDecimals: number,
  pools: FeedPool[],
  logs: RawLog[],
  head: number,
  headAt: number,
): FeedRow[] {
  const events = logs.map(decodeLpLog).filter((e): e is LpEvent => e !== null && !isBirth(e));
  return liquidityRowsFromEvents(token, tokenDecimals, pools, events, head, headAt);
}

export function liquidityRowsFromEvents(
  token: string,
  tokenDecimals: number,
  pools: FeedPool[],
  events: readonly LpEvent[],
  head: number,
  headAt: number,
): FeedRow[] {
  const t = token.toLowerCase();
  const byId = new Map(pools.map((p) => [p.id, p]));
  const rows: FeedRow[] = [];
  for (const e of events) {
    const pool = byId.get(e.pool);
    if (!pool) continue;
    const tokenIsCurrency0 = t < pool.other;
    const v4: FeedRow["v4"] = e.protocol === "v4"
      ? { liquidity: e.liquidity ?? 0n, tickLower: e.tickLower ?? 0, tickUpper: e.tickUpper ?? 0, tokenIsCurrency0, filled: false }
      : undefined;
    const [tok, oth] = tokenIsCurrency0 ? [e.a0, e.a1] : [e.a1, e.a0];
    const lp: NonNullable<FeedRow["lp"]> = { protocol: e.protocol, amount: e.protocol === "v2" ? tok ?? 0n : e.liquidity ?? 0n };
    const tokenAmount = v4 || tok === null ? NaN : Number(formatUnits(tok, tokenDecimals));
    const quoteAmount = v4 || oth === null || pool.otherDecimals === null ? NaN : Number(formatUnits(oth, pool.otherDecimals));
    rows.push({
      id: `${e.tx}:${e.pool}:lp`,
      date: "",
      // A record written before `at` existed has no field at all: estimate, never NaN.
      timestamp: typeof e.at === "number" ? e.at * 1000 : headAt - (head - e.block) * BLOCK_MS,
      ...(typeof e.at === "number" ? { timeExact: true } : {}),
      type: e.kind === "add" ? "buy" : "sell",
      liquidity: e.kind,
      usdAmount: liquidityUsd(pool, tokenAmount, quoteAmount),
      tokenAmount,
      ethAmount: quoteAmount,
      priceUsd: NaN,
      traderAddress: "",
      txHash: e.tx,
      block: e.block,
      poolId: e.pool,
      quoteSymbol: pool.otherSymbol,
      lp,
      ...(v4 ? { v4 } : {}),
    });
  }
  return rows;
}

/** Both sides valued; NaN (renders "—") unless both amounts and both prices are known. */
export function liquidityUsd(pool: FeedPool, tokenAmount: number, quoteAmount: number): number {
  if (!(pool.otherUsd > 0) || !((pool.tokenUsd ?? 0) > 0)) return NaN;
  return quoteAmount * pool.otherUsd + tokenAmount * (pool.tokenUsd ?? 0);
}

/**
 * V4 amounts for a position change, from the token side the receipt shows moving through the
 * PoolManager, solved against the position's range for the other side. Includes fees collected
 * in the same call, so it is an estimate. NaN when the token side did not move (unknowable here).
 */
export function v4OtherAmount(liquidity: number, tickLower: number, tickUpper: number, tokenRaw: number, tokenIsCurrency0: boolean): number {
  const sa = Math.pow(1.0001, tickLower / 2);
  const sb = Math.pow(1.0001, tickUpper / 2);
  if (!(liquidity > 0) || !(tokenRaw >= 0)) return NaN;
  if (tokenIsCurrency0) {
    if (tokenRaw === 0) return liquidity * (sb - sa); // price above the range: all currency1
    const sp = Math.min(1 / (tokenRaw / liquidity + 1 / sb), sb);
    return liquidity * Math.max(sp - sa, 0);
  }
  if (tokenRaw === 0) return liquidity * (1 / sa - 1 / sb); // price below the range: all currency0
  const sp = Math.min(tokenRaw / liquidity + sa, sb);
  return liquidity * (1 / sp - 1 / sb);
}

/** Newest first, one row per key; a later copy of a key only fills in a missing wallet. */
export function mergeRows(prev: FeedRow[], incoming: FeedRow[]): FeedRow[] {
  const byId = new Map(prev.map((r) => [r.id, r]));
  for (const r of incoming) {
    const old = byId.get(r.id);
    byId.set(r.id, old ? { ...(r.v4?.filled && !old.v4?.filled ? r : old), traderAddress: old.traderAddress || r.traderAddress } : r);
  }
  return [...byId.values()].sort((a, b) => b.block - a.block || b.id.localeCompare(a.id)).slice(0, MAX_ROWS);
}

export async function rpc<T>(budget: RpcBudget, method: string, params: unknown[], signal: AbortSignal): Promise<T | null> {
  if (!budget.take()) return null;
  const r = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: requestSignal(signal),
  });
  if (r.status === 429) throw new RateLimited();
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = (await r.json()) as { result?: T; error?: { message?: string } };
  if (j.error) {
    if (/rate limit/i.test(j.error.message ?? "")) throw new RateLimited();
    throw new Error(j.error.message ?? "rpc error");
  }
  return j.result as T;
}

const hex = (n: number) => `0x${n.toString(16)}`;

/** Swap and liquidity logs for the pools in [from, to]: one call for V2/V3 contracts, one for V4 ids. Null = budget refused. */
export async function fetchSwapLogs(budget: RpcBudget, pools: FeedPool[], from: number, to: number, signal: AbortSignal): Promise<RawLog[] | null> {
  const contracts = pools.filter((p) => !p.isV4).map((p) => p.id);
  const v4 = pools.filter((p) => p.isV4).map((p) => p.id);
  const queries: object[] = [];
  // Liquidity topics ride the same two calls: an add or a pull costs no extra RPC.
  if (contracts.length) queries.push({ address: contracts, topics: [[V2_SWAP, V3_SWAP, V2_MINT, V2_BURN, V3_MINT, V3_BURN]] });
  if (v4.length) queries.push({ address: V4_POOL_MANAGER, topics: [[V4_SWAP, V4_MODIFY], v4] });
  const out: RawLog[] = [];
  for (const q of queries) {
    const logs = await rpc<RawLog[]>(budget, "eth_getLogs", [{ ...q, fromBlock: hex(from), toBlock: hex(to) }], signal);
    if (logs === null) return null;
    out.push(...logs);
  }
  return out;
}

/** decimals() for counter-assets outside the known bases; a failed read leaves the amount blank, never zero. */
export async function fillDecimals(budget: RpcBudget, pools: FeedPool[], signal: AbortSignal): Promise<void> {
  for (const p of pools) {
    if (p.otherDecimals !== null) continue;
    const res = await rpc<Hex>(budget, "eth_call", [{ to: p.other, data: "0x313ce567" }, "latest"], signal).catch((e) => {
      if (e instanceof RateLimited) throw e;
      return null; // unreadable decimals: row keeps a blank quote amount
    });
    if (res && res.length >= 66) p.otherDecimals = Number(BigInt(res.slice(0, 66)));
  }
}

async function readDecimals(budget: RpcBudget, address: string, signal: AbortSignal): Promise<number | null> {
  const res = await rpc<Hex>(budget, "eth_call", [{ to: address, data: "0x313ce567" }, "latest"], signal).catch((e) => {
    if (e instanceof RateLimited) throw e;
    return null; // unreadable: amounts from logs render as unknown
  });
  return res && res.length >= 66 ? Number(BigInt(res.slice(0, 66))) : null;
}

/**
 * What share of the pool a removal took, against the pool's depth read now. V2 keeps
 * MINIMUM_LIQUIDITY dust forever, so "emptied" there is 99%; V3/V4 read exactly zero.
 */
export function removalShare(protocol: "v2" | "v3" | "v4", removed: bigint, now: bigint): { share: number; emptied: boolean } {
  const total = removed + now;
  const share = total > 0n ? Number((removed * 10_000n) / total) / 10_000 : 0;
  return { share, emptied: protocol === "v2" ? share >= 0.99 : now === 0n };
}

const word = (hex: Hex | null, i = 0) => (hex && hex.length >= 2 + 64 * (i + 1) ? BigInt(`0x${hex.slice(2 + 64 * i, 2 + 64 * (i + 1))}`) : null);

/** The pool's depth now, in the same unit as FeedRow.lp.amount. Null: not read (§4: never zero). */
async function readPoolDepth(budget: RpcBudget, pool: FeedPool, protocol: "v2" | "v3" | "v4", tokenIsCurrency0: boolean, signal: AbortSignal): Promise<bigint | null> {
  const call = protocol === "v4"
    ? { to: V4_POOL_MANAGER, data: `0x1e2eaeaf${v4LiquiditySlot(pool.id as Hex).slice(2)}` } // extsload(slot)
    : { to: pool.id, data: protocol === "v3" ? "0x1a686502" : "0x0902f1ac" }; // liquidity() / getReserves()
  const res = await rpc<Hex>(budget, "eth_call", [call, "latest"], signal);
  if (protocol === "v2") return word(res, tokenIsCurrency0 ? 0 : 1);
  const w = word(res);
  return w === null ? null : w & ((1n << 128n) - 1n);
}

/** V4 rows: token side from the receipt's transfers through the PoolManager, other side solved. */
async function fillV4Row(budget: RpcBudget, row: FeedRow, pool: FeedPool, token: string, tokenDecimals: number, signal: AbortSignal): Promise<FeedRow | null> {
  const receipt = await rpc<{ logs?: RawLog[]; from?: string } | null>(budget, "eth_getTransactionReceipt", [row.txHash], signal);
  if (receipt === null) return null;
  const pm = V4_POOL_MANAGER.slice(2);
  const moved = (asset: string) => {
    let sum = 0n;
    for (const l of receipt?.logs ?? []) {
      if (l.address.toLowerCase() !== asset || l.topics[0] !== TRANSFER || l.topics.length < 3) continue;
      const pmSide = row.liquidity === "remove" ? l.topics[1] : l.topics[2];
      if (pmSide.toLowerCase().endsWith(pm)) sum += BigInt(l.data);
    }
    return sum;
  };
  const v4 = row.v4!;
  const tokRaw = moved(token.toLowerCase());
  const otherRaw = pool.other === "0x0000000000000000000000000000000000000000"
    ? v4OtherAmount(Number(v4.liquidity), v4.tickLower, v4.tickUpper, Number(tokRaw), v4.tokenIsCurrency0)
    : Number(moved(pool.other));
  const tokenAmount = Number(formatUnits(tokRaw, tokenDecimals));
  const quoteAmount = pool.otherDecimals === null ? NaN : otherRaw / 10 ** pool.otherDecimals;
  return { ...row, ...(receipt.from ? { txFrom: receipt.from.toLowerCase() } : {}), tokenAmount, ethAmount: quoteAmount, usdAmount: liquidityUsd(pool, tokenAmount, quoteAmount), v4: { ...v4, filled: true } };
}

export interface FeedState {
  rows: FeedRow[];
  /** "paused" = the public RPC refused us; live rows stop so the visitor's wallet keeps its budget. */
  status: "loading" | "live" | "paused" | "unavailable";
  historyFailed: boolean;
  head: number | null;
  pools: number;
  /** Pool ids (V2/V3 address, V4 poolId), main pool first. */
  poolIds: string[];
}

export const INITIAL_FEED: FeedState = { rows: [], status: "loading", historyFailed: false, head: null, pools: 0, poolIds: [] };

export function startTradeFeed(
  token: { address: string; primaryPool?: string; marketSource?: "rwa" },
  onState: (s: FeedState) => void,
): () => void {
  const ctrl = new AbortController();
  const { signal } = ctrl;
  const budget = token.marketSource === "rwa" ? rwaRpcBudget : new RpcBudget(1, 6);
  let state = INITIAL_FEED;
  const emit = (patch: Partial<FeedState>) => {
    if (signal.aborted) return;
    state = { ...state, ...patch };
    onState(state);
  };
  let pools: FeedPool[] = [];
  let tokenDecimals: number | null = null;
  let historyTip: number | null = null;
  let last: number | null = null;
  let running = false;
  let faults = 0;
  let backfilledAt = Date.now();
  let lookedBack = false;
  /** First block the live log window read; the stored record must reach it. */
  let liveFrom: number | null = null;
  /** The main pool read empty before the lookback; if no removal turns up, it was older than the search. */
  let mainReadEmpty = false;
  let watch: LiquidityWatch = { mainPoolId: null, removal: null };
  /** Newest main-pool liquidity block already judged; a later add or removal re-judges. */
  let judgedBlock = -1;

  const loadHistory = async () => {
    const h = await fetchHistory(token.address, pools, signal);
    emit({ rows: mergeRows(state.rows, h.rows), historyFailed: h.failed > 0 && h.rows.length === 0 });
    return h.newestBlock;
  };

  let relayAt = 0;
  const relayWallets = async () => {
    const missing = state.rows.filter((r) => !r.traderAddress && r.txHash).slice(0, RELAY_MAX_HASHES);
    if (!missing.length && Date.now() - relayAt < RELAY_WATCH_MS) return;
    relayAt = Date.now();
    const found = await fetchRelaySenders(token.address, pools, missing.map((r) => r.txHash), signal).catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      return new Map<string, string>();
    });
    const filled = missing.flatMap((r) => {
      const from = found.get(r.txHash.toLowerCase());
      return from ? [{ ...r, traderAddress: from }] : [];
    });
    if (filled.length) emit({ rows: mergeRows(state.rows, filled) });
  };

  const setWatch = (next: LiquidityWatch) => { watch = next; publishLiquidity(token.address, watch); };

  // Only the main pool can raise the warning: a pull from a decoy or a dust pool says nothing.
  const judgeMainPool = async () => {
    const main = pools[0];
    if (!main) return;
    const lpRows = state.rows.concat(mainLp).filter((r) => r.poolId === main.id && r.lp);
    const newest = lpRows.reduce((m, r) => Math.max(m, r.block), -1);
    if (newest <= judgedBlock && !(mainReadEmpty && lookedBack && !watch.removal)) return;
    const removal = lpRows.filter((r) => r.liquidity === "remove").sort((a, b) => b.block - a.block)[0];
    if (!removal) {
      // Empty now and no removal in the searchable window: drained longer ago than we can see.
      if (mainReadEmpty && lookedBack && !watch.removal) {
        setWatch({ ...watch, removal: { poolId: main.id, txHash: null, block: null, atMs: null, share: null, emptied: true, lastTradeBeforeMs: null } });
      }
      judgedBlock = newest;
      return;
    }
    const tokenIsCurrency0 = token.address.toLowerCase() < main.other;
    const depth = await readPoolDepth(budget, main, removal.lp!.protocol, tokenIsCurrency0, signal);
    if (depth === null) return; // budget refused: judge on a later tick
    const { share, emptied } = removalShare(removal.lp!.protocol, removal.lp!.amount, depth);
    const blk = removal.timeExact ? null : await rpc<{ timestamp?: Hex } | null>(budget, "eth_getBlockByNumber", [hex(removal.block), false], signal).catch(() => null);
    const atMs = removal.timeExact && removal.timestamp !== undefined ? removal.timestamp : blk?.timestamp ? Number(blk.timestamp) * 1000 : (removal.timestamp ?? Date.now());
    const before = state.rows.filter((r) => r.poolId === main.id && !r.liquidity && r.block < removal.block).sort((a, b) => b.block - a.block)[0];
    judgedBlock = newest;
    const r: MainPoolRemoval = {
      poolId: main.id, txHash: removal.txHash, block: removal.block, atMs, share, emptied,
      lastTradeBeforeMs: before?.timestamp ?? null,
    };
    setWatch({ ...watch, removal: r });
    emit({ rows: state.rows.map((x) => (x.id === removal.id ? { ...x, timestamp: atMs } : x)) });
  };

  /**
   * Main-pool liquidity events older than the live window, so a visitor after a pull still sees
   * it. Kept cheap: skipped when an older pool still holds liquidity, bounded by the pool's age,
   * and halved when the node refuses a range. Giving up means "not looked", never "no removal".
   */
  let mainLp: FeedRow[] = [];
  const mainLpQuery = (main: FeedPool) => main.isV4
    ? { address: V4_POOL_MANAGER, topics: [V4_MODIFY, main.id] }
    : { address: main.id, topics: [[V2_MINT, V2_BURN, V3_MINT, V3_BURN]] };
  let storedTried = false;
  /** The sequencer's record first: 0 RPC, plus one narrow read when it trails the live window. */
  const storedLookBack = async (head: number, main: FeedPool): Promise<boolean> => {
    storedTried = true;
    const stored = await fetchStoredLiquidity(token.address, main.id, signal).catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      return null;
    });
    const plan = planStoredLookback(stored, liveFrom, main.id);
    if (!plan) return false;
    let events = plan.events;
    if (plan.gap) {
      let logs: RawLog[] | null;
      try {
        logs = await rpc<RawLog[]>(budget, "eth_getLogs", [{ ...mainLpQuery(main), fromBlock: hex(plan.gap.from), toBlock: hex(plan.gap.to) }], signal);
      } catch (e) {
        if (e instanceof RateLimited || (e as Error).name === "AbortError") throw e;
        return false; // refused: the full search below still runs
      }
      if (logs === null) { storedTried = false; return true; } // budget refused: ask again next tick
      events = events.concat(logs.map(decodeLpLog).filter((e): e is LpEvent => e !== null && !isBirth(e)));
    }
    lookedBack = true;
    mainLp = liquidityRowsFromEvents(token.address, tokenDecimals ?? NaN, [main], events.slice(-LIQUIDITY_LOOKBACK_KEEP), head, Date.now());
    emit({ rows: mergeRows(state.rows, mainLp) });
    return true;
  };
  const lookBack = async (head: number) => {
    const main = pools[0];
    if (!main || lookedBack) return;
    if (!storedTried && (await storedLookBack(head, main))) return;
    const ageMs = main.createdAtMs ? Date.now() - main.createdAtMs : null;
    if (main.protocol && (ageMs === null || ageMs > LOOKBACK_ALWAYS_UNDER_MS)) {
      const depth = await readPoolDepth(budget, main, main.protocol, token.address.toLowerCase() < main.other, signal);
      if (depth === null) return; // budget refused: try next tick
      if (depth > 0n) { lookedBack = true; return; }
      mainReadEmpty = true;
    }
    // 10% and 1,000 blocks of slack: BLOCK_MS is an average, not a clock.
    let range = ageMs === null ? LIQUIDITY_LOOKBACK_BLOCKS : Math.min(LIQUIDITY_LOOKBACK_BLOCKS, Math.ceil((ageMs / BLOCK_MS) * 1.1) + 1_000);
    const q = mainLpQuery(main);
    for (let i = 0; i <= LOOKBACK_HALVINGS; i++, range = Math.ceil(range / 2)) {
      let logs: RawLog[] | null;
      try {
        logs = await rpc<RawLog[]>(budget, "eth_getLogs", [{ ...q, fromBlock: hex(Math.max(0, head - range)), toBlock: hex(head) }], signal);
      } catch (e) {
        if (e instanceof RateLimited || (e as Error).name === "AbortError") throw e;
        continue; // range or result size refused: ask for half
      }
      if (logs === null) return; // budget refused: try next tick
      lookedBack = true;
      mainLp = liquidityRowsFromLogs(token.address, tokenDecimals ?? NaN, [main], logs.slice(-LIQUIDITY_LOOKBACK_KEEP), head, Date.now());
      emit({ rows: mergeRows(state.rows, mainLp) });
      return;
    }
    lookedBack = true;
  };

  const fillV4 = async () => {
    const row = state.rows.find((r) => r.v4 && !r.v4.filled);
    const pool = row && pools.find((p) => p.id === row.poolId);
    if (!row || !pool || tokenDecimals === null) return;
    const filled = await fillV4Row(budget, row, pool, token.address, tokenDecimals, signal).catch((e) => {
      if (e instanceof RateLimited) throw e;
      return { ...row, v4: { ...row.v4!, filled: true } }; // unreadable receipt: amounts stay unknown, not retried
    });
    if (filled) emit({ rows: mergeRows(state.rows, [filled]) });
  };

  const lookupWallets = async () => {
    const missing = state.rows.filter((r) => !r.traderAddress).slice(0, LOOKUPS_PER_POLL);
    for (const row of missing) {
      if (row.txFrom) {
        emit({ rows: mergeRows(state.rows, [{ ...row, traderAddress: row.txFrom }]) });
        continue;
      }
      const tx = await rpc<{ from?: string } | null>(budget, "eth_getTransactionByHash", [row.txHash], signal);
      if (tx === null) return;
      if (tx?.from) emit({ rows: mergeRows(state.rows, [{ ...row, traderAddress: tx.from }]) });
    }
  };

  const tick = async () => {
    if (running || signal.aborted || document.hidden || !pools.length) return;
    running = true;
    try {
      const headHex = await rpc<Hex>(budget, "eth_blockNumber", [], signal);
      if (headHex === null) return;
      const head = Number(headHex);
      const headAt = Date.now();
      if (tokenDecimals === null) tokenDecimals = await readDecimals(budget, token.address, signal);
      if (last === null) {
        last = historyTip !== null ? Math.max(historyTip, head - MAX_LOG_GAP) : head - 600;
        liveFrom = last + 1;
      }
      if (head - last > MAX_LOG_GAP) {
        // Hidden for a while: GeckoTerminal covers the gap, logs resume near head.
        await loadHistory();
        last = head - MAX_LOG_GAP;
      }
      if (head > last) {
        const logs = await fetchSwapLogs(budget, pools, last + 1, head, signal);
        if (logs !== null) {
          last = head;
          emit({ rows: mergeRows(state.rows, [
            ...rowsFromLogs(token.address, tokenDecimals ?? NaN, pools, logs, head, headAt),
            // Liquidity rows are about the pool on screen only: another pool's pull read as this one's rug.
            ...liquidityRowsFromLogs(token.address, tokenDecimals ?? NaN, pools.slice(0, 1), logs, head, headAt),
          ]) });
        }
      }
      await lookBack(head);
      await judgeMainPool();
      await fillV4();
      // The relay first: it names wallets at no RPC cost. RPC only fills what it has not seen.
      await relayWallets();
      await lookupWallets();
      if (Date.now() - backfilledAt >= WALLET_BACKFILL_MS && state.rows.some((r) => !r.traderAddress)) {
        backfilledAt = Date.now();
        // Only fills wallets and gaps; a failed read leaves the rows as they were.
        void fetchHistory(token.address, pools, signal)
          .then((h) => emit({ rows: mergeRows(state.rows, h.rows) }))
          .catch(() => {});
      }
      faults = 0;
      emit({ status: "live", head });
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof RateLimited) {
        budget.pause();
        emit({ status: "paused" });
      } else if (++faults >= 3) {
        emit({ status: "unavailable" });
      }
    } finally {
      running = false;
    }
  };

  const onVisible = () => { if (!document.hidden) void (initialized ? tick() : boot()); };
  let timer: ReturnType<typeof setInterval> | null = null;
  let initialized = false;
  let booting = false;
  let retryAt = 0;

  const boot = async () => {
    if (booting || signal.aborted || Date.now() < retryAt) return;
    booting = true;
    try {
      pools = await fetchPools(token.address, token.primaryPool, signal, token.marketSource);
      emit({ pools: pools.length, poolIds: pools.map((p) => p.id.toLowerCase()) });
      setWatch({ mainPoolId: pools[0]?.id ?? null, removal: null });
      if (!pools.length) throw new Error("No indexed pools available");
      historyTip = await loadHistory();
      await fillDecimals(budget, pools, signal).catch((e) => { if (e instanceof RateLimited) budget.pause(); });
      if (signal.aborted) return;
      initialized = true;
      emit({ status: "live" });
      void tick();
      if (timer) clearInterval(timer);
      timer = setInterval(() => void tick(), POLL_MS);
    } catch {
      if (signal.aborted) return;
      emit({ status: "unavailable", historyFailed: state.rows.length === 0 });
      // A failed first read used to stop the feed permanently until reload.
      // Retry visible tabs slowly; never overlap bootstrap or bypass the RPC budget.
      retryAt = Date.now() + 30_000;
      if (!timer) timer = setInterval(() => { if (!document.hidden) void boot(); }, 30_000);
    } finally { booting = false; }
  };
  document.addEventListener("visibilitychange", onVisible);
  void boot();

  return () => {
    ctrl.abort();
    if (timer) clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
