import { readLogIndex, writeLogIndex } from "../data/log-index";
import { rpc } from "./client";

/**
 * Full-history event indexing over a durable, incrementally-extended store
 * (audit HIGH-1).
 *
 * History of why this looks the way it does — each earlier design died of
 * chain growth (~10 blocks/s, ~700k blocks/day):
 *  - Windowed RPC paging (`head − N·500k … head`) was coverage in BLOCKS on a
 *    chain where risk lives in TIME; old pools silently fell off the back
 *    (verified live: 21/78 of SUIT's V2 mints visible).
 *  - The full-range RPC read (`fromBlock:0`) served in 0.39s at head ~10.7M
 *    and returns `-32000 log query timed out` at head ~11.5M — an RPC node
 *    WALKS blocks to answer getLogs, so this degrades forever. Both RPC
 *    history paths were removed 2026-07-17 as unreliable.
 *
 * The durable source is an INDEXER: the explorer answers the identical
 * genesis→head topic query from its database in ~1.4s regardless of chain
 * length (lib/explorer/logs). Strategy, in order:
 *  1. Stored index, NARROW gap → one incremental RPC getLogs from `lastBlock+1`
 *     (event history is append-only, so a fresh entry needs only the blocks
 *     since — a range every provider serves). The explorer backstops a refused
 *     top-up.
 *  2. Stored index, WIDE gap → the explorer, same as a cold fill. An old entry's
 *     "incremental" read is not incremental at all; see WIDE_TOPUP_BLOCKS.
 *  3. Nothing stored → the explorer's indexed logs API (`fetchExplorer`). There
 *     is deliberately NO RPC fallback behind it: the explorer being down is a
 *     hard "we cannot know" (`readAny: false`), and the pipeline turns an
 *     explorer outage into a failed scan rather than an optimistic verdict.
 *
 * The store keeps the call-site's own mapped rows (JSON-safe by contract), NOT
 * raw logs — call sites re-derive anything mutable (current owners, live
 * liquidity) on every scan, so it can only ever save the append-only event read,
 * never freeze a stale conclusion. Databaseless environments skip storage and
 * still get the full-history read.
 *
 * The store is `pool_log_index` in the main Postgres (`lib/data/log-index`),
 * NOT a TTL cache. It was a 7-day Valkey entry, and that TTL was the direct
 * cause of the multi-million-block "incremental" top-ups described under
 * WIDE_TOPUP_BLOCKS: expiring append-only, immutable history is a category
 * error, and it guaranteed every pool re-walked the whole chain on a 7-day
 * cycle. Durable rows make the full fill happen once per pool, ever.
 */

export interface LogIndex<Row> {
  rows: Row[];
  /** True when coverage spans block 0 → (head − confirmations). */
  complete: boolean;
  /** False only when NOTHING answered — the caller's "we know nothing" case. */
  readAny: boolean;
  /**
   * Highest block these rows are known through. KNOWN-PROBLEMS L81: any read
   * that is COMPARED against this row set must be pinned to this block. The
   * index is deliberately `CONFIRMATIONS` behind head, so a `latest` eth_call
   * is never the same block as the rows and the two are not comparable.
   */
  ceiling: bigint;
}

/** Blocks held back from head so a shallow reorg can't bake into the cache. */
const CONFIRMATIONS = 5n;
/**
 * Gap width above which the warm top-up goes to the EXPLORER, not RPC.
 *
 * The `fetchRange` contract says "only ever a recent, short range — never the
 * whole chain". That promise silently broke: this chain mints ~700k blocks/day
 * and the widest `eth_getLogs` window any provider serves is 10k blocks — about
 * 17 MINUTES of chain — so the gap grows ~70 windows per day of entry age.
 * Measured live 2026-08-01: head 24,851,502 against a stored `lastBlock` of
 * 19,641,970 is a 5.2M-block gap, which is 512 sequential RPC windows. Scan
 * f1f7eba8 spent 494 of them and died at 89.5s of a 90s deadline.
 *
 * So the cache was cheapest when fresh and MOST expensive just before it went
 * stale, and past a couple of hours of age it cost strictly more than having no
 * cache at all — the cold path is one explorer call.
 *
 * 100k blocks is ~10 RPC windows (~2.5h of chain). Below it the incremental RPC
 * read is genuinely cheap and avoids a network hop to Blockscout; above it, the
 * explorer answers the same question in one call at a latency that does not
 * grow with the range (§3 of the plan: 0.51s for genesis→head).
 */
const WIDE_TOPUP_BLOCKS = 100_000n;
export interface IndexLogsOptions<Row> {
  /**
   * Stable per (site, subject), e.g. `v4init:{pool}`. The primary key of
   * `pool_log_index`. Changing a call site's row shape needs a new key prefix,
   * since the stored rows are that call site's own mapping.
   */
  cacheKey: string;
  /**
   * One small incremental RPC read over the cached prefix, mapped to
   * JSON-serializable rows. Called with inclusive bounds and only ever a recent,
   * short range — never the whole chain. That is now ENFORCED by
   * `WIDE_TOPUP_BLOCKS` rather than merely promised here; the promise alone was
   * false in production for over a year.
   */
  fetchRange: (fromBlock: bigint, toBlock: bigint) => Promise<Row[]>;
  /**
   * The explorer's indexed logs source (lib/explorer/logs) — the ONLY
   * cold-history path. Contract: null means "source unavailable" (surfaces as
   * `readAny: false`); an empty history is `[]`. Must map to the SAME row
   * shape as `fetchRange` (share one mapping function).
   */
  fetchExplorer: (fromBlock: bigint, toBlock: bigint) => Promise<Row[] | null>;
  /** Optional public RPC fallback when the explorer log API gives up on cold history. */
  fetchColdRpc?: (fromBlock: bigint, toBlock: bigint) => Promise<Row[] | null>;
  /**
   * Lower bound for the COLD full-history read. A pool cannot emit events before
   * it exists, and no pool of a token predates that token, so the token's
   * creation block is a sound floor — it turns a genesis→head walk (currently
   * ~11.5M blocks, most of it provably empty for this token) into just the
   * token's lifetime. Defaults to 0n, which preserves the old genesis→head
   * behavior for callers that don't yet pass it. Only bounds the cold path; the
   * warm incremental top-up is already bounded by the cached prefix.
   */
  minBlock?: bigint;
  /**
   * Discard the stored prefix and re-read the whole history from the explorer.
   *
   * For callers that hold an INDEPENDENT PROOF the stored copy is wrong — today
   * only V4 custody, whose `getLiquidity()` identity is exact. The explorer is
   * an indexer, and an indexer that is behind answers a range query
   * successfully with the blocks it has: PACK's two pools each lost the same
   * ~50-block band, written as `complete: true`, and every later top-up appends
   * from `lastBlock + 1` and can never revisit it (KNOWN-PROBLEMS L7). Without
   * a way to re-read, one lagging response is permanent.
   *
   * Do NOT call this speculatively — it costs a full cold read, and a caller
   * with no proof cannot tell a stale index from a correct one.
   */
  refill?: boolean;
  /** Test hook: skip the live head read. */
  head?: bigint;
}

/**
 * In-flight fills, keyed by `cacheKey`. Bounded by construction: an entry is
 * added immediately before the fill starts and removed in its `finally`, so the
 * map is never larger than the number of concurrent fills. It is NOT a cache —
 * nothing is retained after settling, and it holds no result.
 */
const flights = new Map<string, Promise<unknown>>();

/**
 * Full-history event index for one (call site, subject), with the store's
 * expensive fill single-flighted (CLAUDE.md §5).
 *
 * Without this, concurrent scans of the same token each ran their own cold
 * fill of the same key — the classic cold-cache stampede, where every arrival
 * pays the full refill because none of them can see the others. That was a
 * latent gap here (verified: zero single-flight in this module) and it becomes
 * load-bearing the moment MCP lets an agent fan out over a token list.
 * `lib/explorer/gate.ts` caps explorer CONCURRENCY, which bounds parallelism
 * but does not dedupe identical queries, so it is not a substitute.
 *
 * A follower does not adopt the leader's answer — it re-runs once the leader
 * settles. That is deliberate: the leader's coverage stops at ITS `safeHead`,
 * which on a ~10 block/s chain is already a few blocks behind the follower's,
 * and silently serving it as `complete: true` would be exactly the "unknown
 * laundered into a fact" this codebase keeps getting bitten by (§4). The re-run
 * is cheap by then — the store is warm, so it is one read plus a top-up of a
 * few blocks — and if the leader FAILED, the follower simply pays the full path
 * itself rather than inheriting a failure.
 */
export async function indexLogs<Row>(opts: IndexLogsOptions<Row>): Promise<LogIndex<Row>> {
  const head = opts.head ?? (await rpc().getBlockNumber());
  const safeHead = head > CONFIRMATIONS ? head - CONFIRMATIONS : 0n;

  const leader = flights.get(opts.cacheKey);
  if (leader) {
    // Swallow the leader's rejection: it is the leader's caller's to handle,
    // and either way this call still has to answer for its own safeHead.
    await leader.catch(() => {});
    return fill(opts, safeHead);
  }

  const flight = fill(opts, safeHead);
  flights.set(opts.cacheKey, flight);
  try {
    return await flight;
  } finally {
    // Identity-checked: never evict a newer leader that took the slot.
    if (flights.get(opts.cacheKey) === flight) flights.delete(opts.cacheKey);
  }
}

async function fill<Row>(
  opts: IndexLogsOptions<Row>,
  safeHead: bigint,
): Promise<LogIndex<Row>> {
  // 1 — top-up over the stored prefix.
  const stored = await readLogIndex(opts.cacheKey);
  if (stored && !opts.refill) {
    // The row shape is the CALL SITE's contract — it supplies both mappers and
    // owns the key — so the store hands them back as `unknown[]` and this is
    // where they are named. Nothing downstream re-reads them as anything else.
    const prefix = stored.rows as Row[];
    const lastBlock = stored.lastBlock;
    if (lastBlock >= safeHead) {
      return { rows: prefix, complete: true, readAny: true, ceiling: lastBlock };
    }
    const from = lastBlock + 1n;

    /** Append fresh rows to the verified prefix and re-store the extended index. */
    const extend = async (fresh: Row[]): Promise<LogIndex<Row>> => {
      const rows = [...prefix, ...fresh];
      await writeLogIndex(opts.cacheKey, safeHead, rows);
      return { rows, complete: true, readAny: true, ceiling: safeHead };
    };
    /** The prefix is real, verified data — serve it, but flag the gap. */
    const servePrefix = (): LogIndex<Row> => ({
      rows: prefix,
      complete: false,
      readAny: true,
      ceiling: lastBlock,
    });

    if (safeHead - lastBlock > WIDE_TOPUP_BLOCKS) {
      // Not an increment — hundreds of sequential RPC windows. Ask the index.
      const fresh = await opts.fetchExplorer(from, safeHead);
      if (fresh !== null) return extend(fresh);
      // Deliberately NO RPC fallback on this branch. The walk it would attempt
      // is the exact cost this branch exists to avoid, and attempting it is how
      // a stale entry turned into a 90s deadline death rather than a degraded
      // scan. An unreachable explorer here means the tail is UNKNOWN, and
      // `complete: false` is how the caller is told that (CLAUDE.md §4).
      return servePrefix();
    }

    try {
      return await extend(await opts.fetchRange(from, safeHead));
    } catch {
      // The RPC refused even the small top-up; the explorer can serve it too.
      const fresh = await opts.fetchExplorer(from, safeHead);
      return fresh !== null ? extend(fresh) : servePrefix();
    }
  }

  // 2 — the explorer's index answers a full-history topic query in ~1s no
  // matter how long the chain gets. No RPC fallback behind it — see header.
  // Bounded below by the caller's minBlock (token creation) when supplied: the
  // token's own pools cannot predate it, so there is nothing to find earlier.
  const coldFrom = opts.minBlock && opts.minBlock > 0n ? opts.minBlock : 0n;
  let rows = await opts.fetchExplorer(coldFrom, safeHead);
  if (rows === null && opts.fetchColdRpc) {
    rows = await opts.fetchColdRpc(coldFrom, safeHead);
  }
  if (rows !== null) {
    // Event history is append-only and this range ends LATER than the stored
    // one, so a correct re-read can never return fewer rows. Fewer means the
    // source is lagging harder than when we stored — keep what we have rather
    // than trading one hole for a bigger one. Only reachable on a refill;
    // `stored` is null on a genuine cold fill.
    if (stored && rows.length < stored.rows.length) {
      return { rows: stored.rows as Row[], complete: false, readAny: true, ceiling: stored.lastBlock };
    }
    await writeLogIndex(opts.cacheKey, safeHead, rows);
    return { rows, complete: true, readAny: true, ceiling: safeHead };
  }
  // A failed refill must not erase a real prefix — it is still the best copy we
  // have, and `complete: false` says the repair did not land.
  if (stored) return { rows: stored.rows as Row[], complete: false, readAny: true, ceiling: stored.lastBlock };
  return { rows: [], complete: false, readAny: false, ceiling: 0n };
}
