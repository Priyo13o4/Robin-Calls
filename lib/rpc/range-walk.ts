import { configuredLogStride, isSplittableRangeError } from "./provider-pool";

/**
 * Shared block-range walker with splittable-range bisection (Stream 3).
 *
 * TWO families of code read event logs over a block range on this chain:
 *  - `lib/launches/ingest.ts::fetchLogs` (launch registry ingest)
 *    always had bisection, inlined in its own `rpcWalk`.
 *  - `lib/rpc/log-index.ts::indexLogs` (initialization, gauge, and fee-collection
 *    log indexing) did NOT: its incremental `fetchRange` was a
 *    single `client.getLogs`, so a stale cache whose top-up spans millions of
 *    blocks, or a provider with a tighter range cap than expected, failed the
 *    whole read instead of narrowing it.
 *
 * This is the one bisection both now share. It is deliberately THUNK-based
 * rather than a typed `getLogs` wrapper: viem's `getLogs` is heavily overloaded
 * on the event's indexed args, and threading that generic through a wrapper is
 * far more fragile than letting each caller write its own fully-typed call and
 * hand us a `(from, to) => Promise<T[]>`. We own only the range arithmetic.
 *
 * Bisection is gated on `isSplittableRangeError` — a provider that answered but
 * refused an oversized window (including the capability router's own
 * `OversizedLogRangeError` when no provider can serve the span, Stream 2). Any
 * other failure — a real outage, an exhausted circuit, `NoHealthyProviderError`
 * — is NOT splittable: narrowing just re-hits the same unhealthy pool harder,
 * so it rethrows immediately and the caller degrades (log-index falls back to
 * the explorer; the tracker defers the pad to the next tick). The floor stops
 * subdivision from recursing to single blocks against a provider that will
 * never serve any width — below it, the refusal is treated as terminal.
 */

/** Default smallest window we will bisect to before giving up (blocks). */
export const DEFAULT_BISECT_FLOOR = 10_000n;

/**
 * Walk `[fromBlock, toBlock]` calling `fetch` for each window, bisecting on a
 * splittable-range refusal down to `floor`. Results are concatenated in block
 * order (left half before right), matching `eth_getLogs` ordering. `fetch` maps
 * to whatever row shape the caller wants — mapping per-window then concatenating
 * is identical to mapping the whole range, since the map is per-log.
 *
 * The walk STARTS at `stride` — the width `logStrideSpan` derives from what the
 * provider pool declares it can serve — rather than at the full range. Starting
 * wide and halving until something fits spent a guaranteed-refusal round trip
 * for every useful one, and (worse) let the arithmetic of halving choose the
 * final window width, which on the live pool landed just above the public RPC's
 * cap and funnelled every window onto a single provider. See `logStrideSpan`
 * for the measurement. Bisection below the stride is unchanged: a declared cap
 * is a hint, so a provider that refuses anyway still gets narrowed.
 */
export async function walkLogRange<T>(
  fromBlock: bigint,
  toBlock: bigint,
  fetch: (from: bigint, to: bigint) => Promise<T[]>,
  floor: bigint = DEFAULT_BISECT_FLOOR,
  stride: number | null = configuredLogStride(),
): Promise<T[]> {
  const out: T[] = [];

  async function walk(from: bigint, to: bigint): Promise<void> {
    try {
      out.push(...(await fetch(from, to)));
    } catch (error) {
      // Re-stride to a width a healthy narrower provider declares (the pool names it when
      // every wider one faulted). Ahead of the floor: this is routing, not halving.
      const servable = servableSpanOf(error);
      if (servable !== null && to - from > servable) {
        for (let a = from; a <= to; a += servable + 1n) await walk(a, a + servable > to ? to : a + servable);
        return;
      }
      if (to - from < floor) throw error;
      if (!isSplittableRangeError(error)) throw error;
      const mid = from + (to - from) / 2n;
      await walk(from, mid);
      await walk(mid + 1n, to);
    }
  }

  if (fromBlock > toBlock) return out;

  const width = stride !== null && stride > 0 ? BigInt(stride) : null;
  if (width === null || toBlock - fromBlock <= width) {
    await walk(fromBlock, toBlock);
    return out;
  }

  // Inclusive bounds: a window is [a, a+width], so its SPAN is exactly `width`
  // and the next window starts at a+width+1. Off-by-one here would either
  // re-read a block (harmless but wasteful) or skip one (a silently missing
  // event, which is the failure this module exists to avoid).
  for (let a = fromBlock; a <= toBlock; a += width + 1n) {
    const b = a + width > toBlock ? toBlock : a + width;
    await walk(a, b);
  }
  return out;
}

/** The `servableSpan` an `OversizedLogRangeError` carries anywhere in the cause chain, as blocks. */
export function servableSpanOf(error: unknown): bigint | null {
  let cursor: unknown = error;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as { servableSpan?: unknown; cause?: unknown };
    if (typeof e.servableSpan === "number" && Number.isInteger(e.servableSpan) && e.servableSpan > 0) {
      return BigInt(e.servableSpan);
    }
    cursor = e.cause;
  }
  return null;
}
