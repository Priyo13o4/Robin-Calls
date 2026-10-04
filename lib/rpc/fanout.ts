/**
 * Bounded parallel map for RPC reads.
 *
 * Why bounded rather than a bare `Promise.all`: the provider pool admits a call
 * only while the chosen endpoint is under its `maxConcurrentRequests` ceiling,
 * and the ceilings across the whole pool sum to a small number (12 in
 * production). A wider fan-out than that does not go faster — the surplus
 * callers find every provider busy and park in `provider-pool`'s saturation
 * wait — it just makes THIS call site crowd out the rest of the scan, and every
 * other scan sharing the process. That starvation is exactly what
 * `lib/config/trusted-addresses.ts`'s ~25-wide probe used to cause.
 *
 * Results come back in INPUT order, never completion order. Several call sites
 * pair a result array against its input by index, and one of them
 * (`resolveNpmPositions`) feeds an order-sensitive `batchRead` downstream, so
 * completion-ordered results would silently re-pair reads to the wrong subject.
 */
export async function mapWithConcurrency<In, Out>(
  items: readonly In[],
  concurrency: number,
  fn: (item: In, index: number) => Promise<Out>,
): Promise<Out[]> {
  const limit = Math.max(1, Math.floor(concurrency));
  const out = new Array<Out>(items.length);
  let next = 0;

  // One worker per slot, each pulling the next index until the list is drained.
  // Cheaper than chunking: a slow item cannot idle the whole batch behind it.
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return out;
}
