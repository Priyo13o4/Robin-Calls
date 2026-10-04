import type { PublicClient } from "viem";
import { rpc } from "./client";
import { ROBINHOOD_CHAIN_ID as MAINNET_CHAIN_ID } from "@/lib/config/chain";

/** Only the one method this module needs, so tests can pass a stub. */
type Reader = Pick<PublicClient, "getBlock">;

/**
 * Block number → ISO timestamp, cached.
 *
 * A block's timestamp is IMMUTABLE, so this is the one cache in the codebase
 * that needs no TTL for correctness — only a size bound (§5). Measured on prod
 * 2026-09-05: the curve poll spent ~44 `eth_getBlockByNumber` per tick (63k/day,
 * ~12% of all physical RPC) re-resolving timestamps, with a backfill backlog of
 * ZERO — every one of those was either a repeat or a block several rows shared.
 *
 * Failures are NOT cached: a faulted read is not a chain fact (§4), and caching
 * it would pin a block as permanently unresolvable.
 */

/** ~8h of blocks on a 250ms chain, well under a MB of Map. */
const MAX_ENTRIES = 20_000;

/**
 * Keyed by CHAIN and block, not block alone. Block 57,877,460 exists on both
 * Robinhood chains with different timestamps, so a bare block number is not a
 * unique key and a testnet build would answer with a mainnet time.
 */
type Key = string;
const keyFor = (chainId: number, block: number): Key => `${chainId}:${block}`;

const cache = new Map<Key, string>();
/** Single-flight: a tick resolves the same block from several call sites. */
const inFlight = new Map<Key, Promise<string | null>>();

function remember(key: Key, iso: string): void {
  // Insertion-order eviction. Re-inserting an existing key would not refresh
  // its position, but for immutable values that is irrelevant.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, iso);
}

async function fetchOne(client: Reader, chainId: number, block: number): Promise<string | null> {
  const key = keyFor(chainId, block);
  try {
    const b = await client.getBlock({ blockNumber: BigInt(block) });
    const iso = new Date(Number(b.timestamp) * 1000).toISOString();
    remember(key, iso);
    return iso;
  } catch {
    return null; // caller falls back to discovery-time, exactly as before
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Resolve many blocks at once. Cache hits cost nothing; misses go out in
 * parallel, deduplicated across concurrent callers. A block that cannot be read
 * is simply absent from the returned map — never a guessed timestamp.
 */
export async function blockTimestamps(
  blocks: Iterable<number>,
  /** Reader and chain to resolve against. Defaults to the mainnet pool, which
   *  is every caller except the sale indexer on a testnet build. */
  opts?: { client?: Reader; chainId?: number },
): Promise<Map<number, string>> {
  const client = opts?.client ?? rpc();
  const chainId = opts?.chainId ?? MAINNET_CHAIN_ID;
  const out = new Map<number, string>();
  const misses: number[] = [];

  for (const b of new Set(blocks)) {
    const hit = cache.get(keyFor(chainId, b));
    if (hit !== undefined) out.set(b, hit);
    else misses.push(b);
  }
  if (!misses.length) return out;

  await Promise.all(
    misses.map(async (b) => {
      const key = keyFor(chainId, b);
      const pending = inFlight.get(key) ?? fetchOne(client, chainId, b);
      inFlight.set(key, pending);
      const iso = await pending;
      if (iso !== null) out.set(b, iso);
    })
  );
  return out;
}

/** Test seam only — never called in production. */
export function _resetBlockTimeCache(): void {
  cache.clear();
  inFlight.clear();
}

/** Test/telemetry seam: how many blocks are memoised right now. */
export function blockTimeCacheSize(): number {
  return cache.size;
}
