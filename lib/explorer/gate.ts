/**
 * Process-wide concurrency gate for explorer HTTP reads (audit A4).
 *
 * The 429s that A3's retry policy has to absorb are self-inflicted: a scan
 * fans out its explorer reads with `Promise.all` — holders + address history
 * in the pipeline gather, both currency legs of V4 discovery, one log index per
 * pool per DEX, per-address lineage walks — and Blockscout throttles at roughly
 * ~37 req/min sustained, so a wide enough burst trips the limit on a subset.
 *
 * Rather than reshape every call site (and miss the next one someone adds),
 * throttle at the ONE place they all funnel through: the explorer client. Every
 * `get()` and every `getLogsPage()` acquires a slot here first, so no more than
 * `EXPLORER_MAX_CONCURRENCY` explorer requests are ever in flight at once — and
 * because a rate-limited call keeps its slot through A3's backoff, its queued
 * siblings don't fire into the same throttle window either. The cap is
 * process-wide (not per-scan) on purpose: the Blockscout budget is shared by
 * every concurrent scan, exactly like the RPC scheduler's inflight gate.
 *
 * Slot accounting is conserved: a waiter resumed from the queue inherits the
 * releaser's slot (no decrement on hand-off), so `active` can never drift.
 */

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read per-acquire so tests and ops can retune without a process restart.
 *
 * The default stays 3 because that is right for an UNKEYED environment (local,
 * CI), where Blockscout throttles at roughly the ~37 req/min this file's header
 * describes. Production is keyed and pooled — two PRO keys, ~10 req/sec — so it
 * sets `EXPLORER_MAX_CONCURRENCY` explicitly. This is a concurrency gate, not a
 * rate gate: at the ~2.5s median call this file already measures, 8 in flight
 * is ~3.2 req/sec, comfortably inside that ceiling.
 */
function maxConcurrency(): number {
  return intEnv("EXPLORER_MAX_CONCURRENCY", 3);
}

/**
 * One slot pool for the PRO gateway.
 *
 * Slot accounting is conserved: a waiter resumed from the queue inherits the
 * releaser's slot (no decrement on hand-off), so `active` can never drift.
 */
function createGate(limit: () => number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    /** Resolves `true` when the caller had to WAIT for a slot, `false` when one
     *  was free. The flag exists because elapsed time cannot answer this: a
     *  loaded event loop puts milliseconds between the acquire and the
     *  continuation of a call that never queued at all. */
    acquire(): Promise<boolean> {
      if (active < limit()) {
        active += 1;
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => waiters.push(() => resolve(true)));
    },
    release(): void {
      const next = waiters.shift();
      // Hand the slot straight to the next waiter (count unchanged), or free it.
      if (next) next();
      else active = Math.max(0, active - 1);
    },
    reset(): void {
      active = 0;
      waiters.length = 0;
    },
  };
}

const restGate = createGate(maxConcurrency);

/**
 * Run `fn` while holding one explorer slot; releases even if `fn` throws.
 *
 * `fn` receives the milliseconds this call spent QUEUED before it got a slot.
 * That number matters because the obvious explorer metric lies without it:
 * `explorerWallMs` used to start its timer before the acquire, so queue time
 * was billed as upstream latency AND counted once per queued call — the same
 * wall-clock second showing up in up to `maxConcurrency` different totals. A
 * scan reporting "72s of explorer" was mostly reporting its own queue. Callers
 * that do not care may ignore the argument.
 */
export async function withExplorerSlot<T>(fn: (queuedMs: number) => Promise<T>): Promise<T> {
  return runWithGate(restGate, fn);
}

async function runWithGate<T>(
  gate: ReturnType<typeof createGate>,
  fn: (queuedMs: number) => Promise<T>
): Promise<T> {
  const waitStartedAt = Date.now();
  const queued = await gate.acquire();
  // Never bill scheduler jitter as queue time — an unqueued call is exactly 0.
  const queuedMs = queued ? Date.now() - waitStartedAt : 0;
  try {
    return await fn(queuedMs);
  } finally {
    gate.release();
  }
}

/** Test seam: drain the gates between cases so state never leaks across tests. */
export function resetExplorerGateForTests(): void {
  restGate.reset();
}
