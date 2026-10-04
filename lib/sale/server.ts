import { isAddress, type Address, type PublicClient } from "viem";
import { rpc } from "@/lib/rpc/client";
import { batchRead } from "@/lib/rpc/multicall";
import { buildSaleView, makeReadMany, type ReadMany, type SaleSnapshot } from "./reads";

/**
 * The server's single read pass for /token-sale: one batch through the
 * provider pool (`rpc()` — multi-provider, failover, circuit breakers) at a
 * pinned block, so the first paint is real numbers and the client takeover is
 * a refresh, not a fetch. `batchRead` is §2's mandated fan-out tool and it
 * never throws — every miss comes back as a `reverted`/`faulted` outcome,
 * which is exactly the third state `buildSaleView`'s faults list wants.
 *
 * `force-dynamic` re-reads per request, so there is nothing to cache here and
 * deliberately nothing cached: a TTL layer would need its own invalidation
 * story for a fallback that an SSR re-read gives free.
 *
 * The optional `client` is for readers on a chain the provider pool does not
 * serve: a testnet build's sale lives on 46630, and `rpc()` is pinned to
 * mainnet, so a caller that passes the chain-aware reader
 * (lib/referrals/census.ts::saleReader) gets its reads served there instead.
 * `batchRead` itself goes through `rpc()` internally, so a custom client is
 * served by `makeReadMany` instead: same one-multicall shape, same per-call
 * fault semantics.
 */
export async function readSaleSnapshot(
  contract: string,
  opts: { client?: PublicClient } = {},
): Promise<SaleSnapshot | null> {
  const addr = isAddress(contract) ? (contract.toLowerCase() as Address) : null;
  if (!addr) return null;

  const client = opts.client ?? rpc();
  let blockNumber: bigint | null = null;
  try {
    blockNumber = await client.getBlockNumber();
  } catch {
    // Unlabeled rather than wrong: the reads still go out (at latest), the
    // stale label just degrades to "ago" without a block number.
  }

  const readMany: ReadMany = async (calls) => {
    if (opts.client) {
      // Through the caller's client, because batchRead constructs rpc()
      // internally and would read the wrong chain here. `makeReadMany` is one
      // multicall with per-call failures preserved, falling back to per-call
      // reads only when the chain has no multicall3 — never the Promise.all
      // fan-out §2 forbids, which is ~35 round trips per snapshot.
      return makeReadMany(client)(calls);
    }
    const results = await batchRead(
      calls.map(({ label: _label, ...c }) => c),
      blockNumber !== null ? { blockNumber } : {},
    );
    return results.map((r) => (r.status === "success" ? { ok: true as const, value: r.value } : { ok: false as const }));
  };

  const view = await buildSaleView(readMany, addr, null);
  return { view, blockNumber, takenAt: Date.now() };
}

/* ------------------------------------------------------------------ */
/*  The first-paint cache                                              */
/* ------------------------------------------------------------------ */

/**
 * Five seconds. The browser polls the same numbers itself every 15s on an
 * active sale (lib/sale/useSaleData.ts), so nothing a visitor sees is older
 * than it would have been anyway; this only stops N simultaneous visitors
 * each paying for their own copy of one answer.
 */
const SNAPSHOT_TTL_MS = 5_000;

type Entry = { snapshot: SaleSnapshot; storedAt: number };

/**
 * PER PROCESS, and never treated as global truth (§5). Keyed by chain AND
 * address: a snapshot does not say which sale it is about on its own, so a
 * republish to a new contract must not be served the old one's numbers. That
 * also means an address change needs no invalidation, it simply misses.
 */
const cached = new Map<string, Entry>();
const inFlight = new Map<string, Promise<SaleSnapshot | null>>();

const keyFor = (chainId: number, contract: string) => `${chainId}:${contract.toLowerCase()}`;

/**
 * `readSaleSnapshot` for the two PAGE RENDERS, which are `force-dynamic` and
 * were therefore paying 3 RPC requests per page view, on our keyed pool,
 * scaling straight with traffic while every visitor read identical numbers.
 *
 * Deliberately NOT used by the airdrop snapshot job: its whole purpose is a
 * completeness proof against the contract's live `totalRaised`, and a proof
 * drawn over a value up to five seconds old is not one. Jobs call
 * `readSaleSnapshot` directly.
 *
 * A FAULTED read is served to its own caller and then thrown away rather than
 * stored. Caching it would republish one bad read to everyone who arrives in
 * the next five seconds, and `faults` is exactly the signal that some field on
 * the page is a "—" rather than a number (§4). The single-flight guard still
 * applies during an outage, so a dead RPC collapses to one attempt in flight
 * rather than one per visitor.
 */
export async function readSaleSnapshotCached(
  contract: string,
  opts: { client?: PublicClient; chainId: number },
): Promise<SaleSnapshot | null> {
  const key = keyFor(opts.chainId, contract);

  const hit = cached.get(key);
  if (hit && Date.now() - hit.storedAt < SNAPSHOT_TTL_MS) return hit.snapshot;

  // Single-flight: a cold cache is hit by every concurrent request at once,
  // and without this each one runs the full read (§5).
  const running = inFlight.get(key);
  if (running) return running;

  const run = readSaleSnapshot(contract, { client: opts.client })
    .then((snapshot) => {
      if (snapshot && snapshot.view.faults.length === 0) {
        cached.set(key, { snapshot, storedAt: Date.now() });
      }
      return snapshot;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, run);
  return run;
}

/** Drop a sale's cached snapshot. For an admin write that just moved the
 *  contract's state and wants the next render to show it immediately. */
export function forgetSaleSnapshot(chainId: number, contract: string): void {
  cached.delete(keyFor(chainId, contract));
}
