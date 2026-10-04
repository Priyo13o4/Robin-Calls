import type { ProviderEndpoint } from "./provider-pool";

/**
 * In-process least-inflight provider ranking (PRD Performance Optimization
 * Order step 2), now wired into `provider-pool.ts::poolRequest` (§M15).
 *
 * WHAT IS WIRED (single serverless instance only): `rankLeastInflight`
 * composes with `orderByPreference` to break ties within a preference tier
 * (`provider-pool.ts::rankEligibleProviders`), and a provider's configured
 * `maxConcurrentRequests` is enforced for real — `poolRequest` checks
 * `inflightCount(id) < maxConcurrentRequests` before attempting a provider
 * and skips to the next eligible one at capacity, instead of leaving that
 * field dead config. `markInflight`/`clearInflight` bracket every attempt.
 *
 * WHAT IS STILL NOT WIRED: this tracker only sees ONE process's in-flight
 * calls. Two app containers (or a scan and a cron job) could each independently
 * believe they're within a provider's configured `maxCuPerSecond`/
 * `maxRequestsPerSecond` while jointly exceeding it, because neither knows
 * about the other's traffic — `maxConcurrentRequests` is the one field this
 * module *can* honestly enforce per-instance (it's a per-instance ceiling by
 * definition), but CU/RPS budgets are inherently cross-instance and this
 * module makes no claim to enforce them. `provider-pool.ts` itself documents
 * why that gap is currently tolerable: circuit state is per-instance and
 * cross-instance safety today comes from the Upstash-backed
 * `SCAN_GLOBAL_MAX_CONCURRENT` gate (lib/scan-control/redis-coordinator.ts),
 * which this module does not raise or touch. The real distributed
 * enforcement mechanism — an Upstash-backed CU/RPS token bucket reusing
 * `scan-control`'s atomic-Lua-script idiom — is still a separate, later
 * milestone (lib/rpc/cu-limiter.ts / "M9" in the plan), which will wire in
 * `maxCuPerSecond`/`maxRequestsPerSecond` across instances; this module's
 * `maxConcurrentRequests` enforcement is the local backstop, not a
 * replacement for that.
 */

interface TrackedProvider {
  endpoint: ProviderEndpoint;
  inflight: number;
}

export class ProviderScheduler {
  private readonly tracked = new Map<string, TrackedProvider>();

  private entry(endpoint: ProviderEndpoint): TrackedProvider {
    let e = this.tracked.get(endpoint.id);
    if (!e) {
      e = { endpoint, inflight: 0 };
      this.tracked.set(endpoint.id, e);
    }
    return e;
  }

  markInflight(endpoint: ProviderEndpoint): void {
    this.entry(endpoint).inflight += 1;
  }

  clearInflight(endpoint: ProviderEndpoint): void {
    const e = this.entry(endpoint);
    e.inflight = Math.max(0, e.inflight - 1);
  }

  inflightCount(endpointId: string): number {
    return this.tracked.get(endpointId)?.inflight ?? 0;
  }

  /**
   * Rank eligible providers least-inflight first (ties broken by input
   * order, so a never-tracked provider ranks with the untouched pool rather
   * than arbitrarily first/last). This is a pure ranking function — it does
   * not consult `maxConcurrentRequests`/`maxCuPerSecond`, since those can
   * only be safely enforced once tracking is distributed (see module doc).
   */
  rankLeastInflight<T extends { endpoint: ProviderEndpoint }>(providers: readonly T[]): T[] {
    return [...providers].sort(
      (a, b) => this.inflightCount(a.endpoint.id) - this.inflightCount(b.endpoint.id),
    );
  }
}

/**
 * Method-aware ordering (audit HIGH-2): providers that declare a preference for
 * this method serve first; everyone else keeps the configured order (stable
 * sort). Preference changes who goes FIRST, never who is eligible — a preferred
 * provider that faults still fails over to the rest of the pool.
 */
export function orderByPreference<T extends { endpoint: ProviderEndpoint }>(
  providers: readonly T[],
  method: string
): T[] {
  const rank = (p: T) => (p.endpoint.preferMethods?.includes(method) ? 0 : 1);
  return [...providers].sort((a, b) => rank(a) - rank(b));
}

/**
 * Composes method preference with the (M2/M15) least-inflight hint: preference
 * still decides who goes first — the same two buckets `orderByPreference`
 * produces — and least-inflight only breaks ties WITHIN a bucket. It never lets
 * a busy preferred provider be jumped by an idle non-preferred one, since that
 * would silently undo the routing `preferMethods` exists for (e.g. keeping
 * `eth_getLogs` off the paid primary).
 *
 * Lives here rather than in provider-pool so `admission.ts` can rank without
 * importing the pool it is imported BY.
 */
export function rankEligibleProviders<T extends { endpoint: ProviderEndpoint }>(
  providers: readonly T[],
  method: string,
  scheduler: ProviderScheduler
): T[] {
  const preferred = providers.filter((p) => p.endpoint.preferMethods?.includes(method));
  const rest = providers.filter((p) => !p.endpoint.preferMethods?.includes(method));
  return [...scheduler.rankLeastInflight(preferred), ...scheduler.rankLeastInflight(rest)];
}

/** Process-wide instance — one ranking view per serverless instance, as documented above. */
let scheduler: ProviderScheduler | null = null;

export function providerScheduler(): ProviderScheduler {
  if (!scheduler) scheduler = new ProviderScheduler();
  return scheduler;
}

/** Test hook. */
export function resetProviderSchedulerForTests(): void {
  scheduler = null;
}
