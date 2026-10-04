import { createHash } from "node:crypto";
import { erc20Abi, type Address } from "viem";
import { rpc } from "@/lib/rpc/client";
import { batchRead, type BatchResult } from "@/lib/rpc/multicall";
import { explorer } from "@/lib/explorer/router";
import { redisClient } from "@/lib/redis/client";
import { DEFAULT_V4_POOL_MANAGER } from "@/lib/launches/modules/v4-pools";
import { readWalletTxCounts, writeWalletTxCounts } from "@/lib/sequencer/trade-senders";
import { factCache } from "@/lib/swap/fact-cache";
import type { WalletFacts } from "./wallet-tags";

/** Server side of the trade pane's wallet tags. Every unknown stays null; nothing here says "no". */

export const MAX_WALLETS = 40;
/** Node lookups per request for wallets the relay never saw; the rest are asked on a later poll. */
export const MAX_TXCOUNT_LOOKUPS = 20;
const LAUNCH_PREFIX = "trades:launch:";
/** A creation tx never changes; the TTL only bounds memory. */
const LAUNCH_TTL_S = 30 * 24 * 3600;
const LAUNCH_FAULT_TTL_S = 600;
// Redis remains the cross-process cache. These bounded per-process caches also join cold refills
// so concurrent page requests on one worker do not each fan out the same RPC/explorer reads.
const launchFacts = factCache<LaunchParties | null>(LAUNCH_TTL_S * 1000, 256);
const txCountFacts = factCache<number | null>(6 * 60 * 60 * 1000, 4096);
const MAX_INSIDERS = 500;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const BURN = new Set(["0x0000000000000000000000000000000000000000", "0x000000000000000000000000000000000000dead"]);

export interface LaunchParties { dev: string | null; insiders: string[] }

/** Who sent the creation tx, and who received the token inside it (burn addresses and the token excluded). */
export function launchPartiesFromReceipt(
  token: string,
  receipt: { from: string; logs: readonly { address: string; topics: readonly string[] }[] },
): LaunchParties {
  const t = token.toLowerCase();
  const insiders = new Set<string>();
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== t || l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || l.topics.length < 3) continue;
    const to = `0x${l.topics[2].slice(-40)}`.toLowerCase();
    if (!BURN.has(to) && to !== t) insiders.add(to);
    if (insiders.size >= MAX_INSIDERS) break;
  }
  const dev = receipt.from.toLowerCase();
  insiders.delete(dev);
  return { dev, insiders: [...insiders] };
}

/** Null when the launch could not be read: callers then tag nobody, rather than clearing everybody. */
async function readLaunchPartiesUncached(token: string): Promise<LaunchParties | null> {
  const redis = redisClient();
  const key = `${LAUNCH_PREFIX}${token}`;
  const cached = redis ? await redis.get(key).catch(() => null) : null;
  if (cached) {
    try {
      const v = JSON.parse(cached) as LaunchParties | { unknown: true };
      return "unknown" in v ? null : v;
    } catch { /* corrupt entry: read again */ }
  }
  let parties: LaunchParties | null = null;
  try {
    const info = await explorer.addressInfo(token);
    const hash = info?.creation_tx_hash ?? info?.creation_transaction_hash;
    if (hash) {
      const receipt = await rpc().getTransactionReceipt({ hash: hash as `0x${string}` });
      parties = launchPartiesFromReceipt(token, receipt);
    }
  } catch {
    parties = null; // explorer or node fault: unknown, cached briefly so a busy page cannot hammer it
  }
  if (redis) {
    const body = parties ? JSON.stringify(parties) : JSON.stringify({ unknown: true });
    await redis.set(key, body, "EX", parties ? LAUNCH_TTL_S : LAUNCH_FAULT_TTL_S).catch(() => undefined);
  }
  return parties;
}

function readLaunchParties(token: string): Promise<LaunchParties | null> {
  return launchFacts.get(token.toLowerCase(), () => readLaunchPartiesUncached(token), (value) => value !== null);
}

const big = (r: BatchResult<unknown> | undefined): bigint | null =>
  r && r.status === "success" && typeof r.value === "bigint" ? r.value : null;

/**
 * Each wallet's share of circulating supply: total minus burn addresses minus pool balances.
 * One multicall. Any unreadable denominator makes every share null, never a guess.
 */
/** Shared across visitors. Keyed by the pool set too: a caller naming a fake "pool" skews only its own reads. */
/** Matches the pane's 60 s refresh: shorter would expire before the same visitor asks again. */
const HELD_TTL_S = 60;
const HELD_MAX_ENTRIES = 4096;
const heldFacts = factCache<number | null>(HELD_TTL_S * 1000, HELD_MAX_ENTRIES);
const normalizedPoolKey = (pools: readonly string[]) => createHash("sha1")
  .update([...new Set(pools.map((p) => p.toLowerCase()))].sort().join(","))
  .digest("hex").slice(0, 12);
const heldKey = (token: string, pools: readonly string[], w: string) =>
  `trades:held:${token.toLowerCase()}:${normalizedPoolKey(pools)}:${w.toLowerCase()}`;

interface HeldBatch {
  token: string;
  pools: readonly string[];
  wallets: Map<string, Array<(value: number | null) => void>>;
}
const heldBatches = new Map<string, HeldBatch>();
let heldBatchScheduled = false;

function queueHeldShare(token: string, pools: readonly string[], wallet: string): Promise<number | null> {
  const normalizedToken = token.toLowerCase();
  const normalizedWallet = wallet.toLowerCase();
  const groupKey = `${normalizedToken}:${normalizedPoolKey(pools)}`;
  return new Promise((resolve) => {
    let batch = heldBatches.get(groupKey);
    if (!batch) {
      batch = { token: normalizedToken, pools: [...pools], wallets: new Map() };
      heldBatches.set(groupKey, batch);
    }
    const waiters = batch.wallets.get(normalizedWallet) ?? [];
    waiters.push(resolve);
    batch.wallets.set(normalizedWallet, waiters);
    if (!heldBatchScheduled) {
      heldBatchScheduled = true;
      queueMicrotask(() => { void flushHeldBatches(); });
    }
  });
}

async function flushHeldBatches(): Promise<void> {
  heldBatchScheduled = false;
  const batches = [...heldBatches.values()];
  heldBatches.clear();
  await Promise.all(batches.map(async ({ token, pools, wallets }) => {
    const addresses = [...wallets.keys()];
    let shares = new Map<string, number | null>();
    try {
      shares = await readHeldSharesFromChain(token, addresses, pools);
    } catch {
      // A failed refill is unknown and is deliberately not retained by heldFacts.
    }
    for (const [wallet, waiters] of wallets) {
      const value = shares.get(wallet) ?? null;
      for (const resolve of waiters) resolve(value);
    }
  }));
}

export async function readHeldShares(token: string, wallets: readonly string[], pools: readonly string[]): Promise<Map<string, number | null>> {
  const redis = redisClient();
  const out = new Map<string, number | null>(wallets.map((w) => [w, null]));
  const cached = redis && wallets.length ? await redis.mget(...wallets.map((w) => heldKey(token, pools, w))).catch(() => null) : null;
  const missing: string[] = [];
  wallets.forEach((w, i) => {
    const v = cached?.[i];
    const n = v == null ? NaN : Number(v);
    if (Number.isFinite(n)) out.set(w, n);
    else missing.push(w);
  });
  if (!missing.length) return out;
  const freshValues = await Promise.all(missing.map((w) => heldFacts.get(
    heldKey(token, pools, w),
    () => queueHeldShare(token, pools, w),
    (value) => value !== null,
  )));
  const fresh = new Map(missing.map((w, i) => [w, freshValues[i] ?? null]));
  const pipe = redis?.pipeline();
  for (const [w, share] of fresh) {
    out.set(w, share);
    // Unread stays uncached, so the next visitor asks the chain again (§4: never cache a fault).
    if (share !== null) pipe?.set(heldKey(token, pools, w), String(share), "EX", HELD_TTL_S);
  }
  await pipe?.exec().catch(() => undefined);
  return out;
}

async function readHeldSharesFromChain(token: string, wallets: readonly string[], pools: readonly string[]): Promise<Map<string, number | null>> {
  const t = token as Address;
  const poolHolders = [...new Set(pools.map((p) => (p.length === 66 ? DEFAULT_V4_POOL_MANAGER : p).toLowerCase()))];
  const excluded = [...BURN, ...poolHolders];
  const calls = [
    { address: t, abi: erc20Abi, functionName: "totalSupply" as const, args: [] as const },
    ...excluded.map((a) => ({ address: t, abi: erc20Abi, functionName: "balanceOf" as const, args: [a as Address] as const })),
    ...wallets.map((w) => ({ address: t, abi: erc20Abi, functionName: "balanceOf" as const, args: [w as Address] as const })),
  ];
  const res = await batchRead(calls).catch(() => [] as BatchResult<unknown>[]);
  const shares = circulatingShares(big(res[0]), excluded.map((_, i) => big(res[1 + i])), wallets.map((_, i) => big(res[1 + excluded.length + i])));
  return new Map(wallets.map((w, i) => [w, shares[i]]));
}

/** Null (unread) anywhere in the denominator makes every share null. */
export function circulatingShares(total: bigint | null, excluded: readonly (bigint | null)[], balances: readonly (bigint | null)[]): (number | null)[] {
  if (total === null || excluded.some((h) => h === null)) return balances.map(() => null);
  const circulating = total - excluded.reduce<bigint>((a, b) => a + (b ?? 0n), 0n);
  if (circulating <= 0n) return balances.map(() => null);
  return balances.map((b) => (b === null ? null : Number((b * 1_000_000n) / circulating) / 1_000_000));
}

/** Lifetime tx counts: relay first (free), then the node for at most MAX_TXCOUNT_LOOKUPS wallets. */
export async function readTxCounts(wallets: readonly string[]): Promise<Map<string, number | null>> {
  const known = await readWalletTxCounts(wallets).catch(() => new Map<string, number>());
  const out = new Map<string, number | null>(wallets.map((w) => [w, known.get(w) ?? null]));
  const missing = wallets.filter((w) => !known.has(w)).slice(0, MAX_TXCOUNT_LOOKUPS);
  const fresh = new Map<string, number>();
  const values = await Promise.all(missing.map((w) => txCountFacts.get(w.toLowerCase(), async () => {
    try { return await rpc().getTransactionCount({ address: w as Address }); }
    catch { return null; }
  }, (value) => value !== null)));
  missing.forEach((w, i) => {
    const n = values[i];
    if (n === null || n === undefined) return;
    fresh.set(w, n);
    out.set(w, n);
  });
  await writeWalletTxCounts(fresh).catch(() => undefined);
  return out;
}

/** Reset process-local coalescing for isolated tests; Redis remains the shared cache. */
export function _resetWalletFactsCachesForTests(): void {
  launchFacts.clear();
  heldFacts.clear();
  txCountFacts.clear();
  heldBatches.clear();
  heldBatchScheduled = false;
}

export async function readWalletFacts(token: string, wallets: readonly string[], pools: readonly string[]): Promise<Record<string, WalletFacts>> {
  const [txCounts, shares, launch] = await Promise.all([
    readTxCounts(wallets),
    readHeldShares(token, wallets, pools),
    readLaunchParties(token),
  ]);
  const insiders = new Set(launch?.insiders ?? []);
  const out: Record<string, WalletFacts> = {};
  for (const w of wallets) {
    out[w] = {
      txCount: txCounts.get(w) ?? null,
      heldShare: shares.get(w) ?? null,
      launch: !launch ? null : w === launch.dev ? "dev" : insiders.has(w) ? "insider" : null,
    };
  }
  return out;
}
