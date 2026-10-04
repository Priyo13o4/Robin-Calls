import type { ProviderEndpoint } from "../rpc/provider-pool";
import { readRpcEndpoints, type RpcEndpointRow } from "../data/rpc-endpoints";
import { reportError } from "../observability/reporter";

/**
 * Operator-editable RPC pool (migration 0061, /admin/rpc).
 *
 * WHY IT EXISTS. KNOWN-PROBLEMS L19 — an Alchemy key hit its monthly cap and
 * 429'd every call for 12h. The circuit breaker did its job for 60s at a time
 * and then re-probed a provider that could not recover until the 1st of the
 * month. A breaker cannot know a billing cycle; the missing control is an
 * operator switch, and it lived in a gitignored file behind a container
 * restart. `enabled = false` here is that switch, and it takes effect on the
 * next pool build (seconds), not the next deploy.
 *
 * THE THREE STATES, which is the whole design (§4, §8 #9):
 *
 *   cache null / DB unreachable → `null`  → caller uses the env seed
 *   rows exist, no shared row on → `null` → env seed + a reported fault
 *   rows exist, ≥1 shared on    → that list, authoritative (swap rows ride alongside)
 *
 * An empty table is NOT an empty pool. Reading it that way would mean an
 * unset DATABASE_URL takes the scanner off the chain entirely — the exact
 * shape of §8 #9, where a documented empty return got read as a fact.
 *
 * NO IMPORT OF provider-pool AT RUNTIME. `ProviderEndpoint` is a type-only
 * import; provider-pool imports this module, and a value import here would
 * close the cycle.
 */

interface Cache {
  /** null once loaded means "loaded, and the operator has no usable opinion". */
  endpoints: ProviderEndpoint[] | null;
  /** pool = 'swap' rows (migration 0106). Never a reason to leave the env seed. */
  swapEndpoints: ProviderEndpoint[];
  disabledIds: string[];
  loadedAt: number;
}

const TTL_MS = 60_000;

let cache: Cache | null = null;
let inFlight: Promise<void> | null = null;
/** Bumped whenever the active set CHANGES, so the pool knows to rebuild. */
let generation = 0;

export function rpcEndpointGeneration(): number {
  return generation;
}

/**
 * A row is only usable if it would also have survived `parseEndpointConfig`.
 * The DB has CHECK constraints for the same things, but a table edited by hand
 * (or restored from a backup taken before a constraint) must not be able to
 * throw inside `buildProviders`, which every scan in the process shares.
 */
function toProviderEndpoint(row: RpcEndpointRow): ProviderEndpoint | null {
  if (!row.id.trim()) return null;
  if (!/^https?:\/\//.test(row.url)) return null;
  for (const n of [
    row.maxCuPerSecond,
    row.maxRequestsPerSecond,
    row.maxConcurrentRequests,
    row.maxLogSpan,
  ]) {
    if (n !== null && (!Number.isInteger(n) || n <= 0)) return null;
  }
  const capabilities =
    row.maxLogSpan !== null || row.denyMethods.length > 0 || row.allowMethods.length > 0
      ? {
          maxLogSpan: row.maxLogSpan ?? undefined,
          denyMethods: row.denyMethods.length ? row.denyMethods : undefined,
          allowMethods: row.allowMethods.length ? row.allowMethods : undefined,
        }
      : undefined;
  return {
    id: row.id,
    url: row.url,
    maxCuPerSecond: row.maxCuPerSecond ?? undefined,
    maxRequestsPerSecond: row.maxRequestsPerSecond ?? undefined,
    maxConcurrentRequests: row.maxConcurrentRequests ?? undefined,
    preferMethods: row.preferMethods.length ? row.preferMethods : undefined,
    capabilities,
    ...(row.pool === "swap" ? { swapOnly: true } : {}),
  };
}

/**
 * Rows → the pool's active set, or null when the DB has no usable SHARED
 * opinion. Swap rows never count toward it: scans cannot use them.
 */
export function activeSetFromRows(rows: readonly RpcEndpointRow[]): {
  endpoints: ProviderEndpoint[] | null;
  swapEndpoints: ProviderEndpoint[];
  disabledIds: string[];
  malformedIds: string[];
} {
  const disabledIds = rows.filter((r) => !r.enabled).map((r) => r.id);
  const malformedIds: string[] = [];
  const endpoints: ProviderEndpoint[] = [];
  const swapEndpoints: ProviderEndpoint[] = [];
  for (const row of rows) {
    if (!row.enabled) continue;
    const ep = toProviderEndpoint(row);
    // A malformed row is dropped rather than thrown on, but it is NEVER
    // silent: a dropped provider shrinks the pool, and the whole point of
    // this module is that the operator knows which endpoints are in play.
    if (!ep) malformedIds.push(row.id);
    else (ep.swapOnly ? swapEndpoints : endpoints).push(ep);
  }
  return { endpoints: endpoints.length > 0 ? endpoints : null, swapEndpoints, disabledIds, malformedIds };
}

/** Install a set directly. Used by primeRpcEndpoints and unit tests. */
export function setRpcEndpointCache(
  endpoints: ProviderEndpoint[] | null,
  disabledIds: string[] = [],
  swapEndpoints: ProviderEndpoint[] = [],
): void {
  const before = JSON.stringify([cache?.endpoints ?? null, cache?.swapEndpoints ?? []]);
  cache = { endpoints, swapEndpoints, disabledIds, loadedAt: Date.now() };
  if (JSON.stringify([endpoints, swapEndpoints]) !== before) generation += 1;
}

export function resetRpcEndpointsForTests(): void {
  cache = null;
  inFlight = null;
  generation = 0;
}

/**
 * Load the table into the module cache. Single-flight (§5): the pool refreshes
 * from `buildProviders`, which a cold process hits from every concurrent scan
 * at once, and without this each one would run its own query. A forced refresh
 * deliberately does NOT join the in-flight read — an admin who just hit
 * "disable" must not be served the answer from before their write.
 */
export async function primeRpcEndpoints(force = false): Promise<void> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return;
  if (!force && inFlight) return inFlight;

  const run = (async () => {
    let rows: RpcEndpointRow[];
    try {
      rows = await readRpcEndpoints();
    } catch (error) {
      // A config read must never be the thing that takes the pool down: leave
      // whatever is cached in place (or null, i.e. the env seed) and move on.
      void reportError({
        code: "RC_CONFIG_INVALID",
        message: error instanceof Error ? error.message : "rpc_endpoints read failed",
        operation: "rpcEndpoints.prime",
      });
      return;
    }

    // Zero rows is the unseeded table: no opinion, use the env seed. This is
    // NOT reported — it is the documented cold-start state, and an alert that
    // fires on every fresh database trains its reader to ignore it.
    if (rows.length === 0) {
      setRpcEndpointCache(null, []);
      return;
    }

    const { endpoints, swapEndpoints, disabledIds, malformedIds } = activeSetFromRows(rows);
    if (malformedIds.length > 0) {
      void reportError({
        code: "RC_CONFIG_INVALID",
        message: `rpc_endpoints rows dropped as malformed: ${malformedIds.join(", ")}`,
        operation: "rpcEndpoints.prime",
      });
    }
    if (endpoints === null) {
      // Rows exist and not one is usable. Falling back to env is the only
      // move that keeps the scanner on the chain, but it silently re-enables
      // providers the operator switched off, so it must be loud.
      void reportError({
        code: "RC_CONFIG_INVALID",
        message:
          "rpc_endpoints has rows but no usable enabled endpoint — falling back to RPC_ENDPOINTS_JSON",
        operation: "rpcEndpoints.prime",
      });
    }
    setRpcEndpointCache(endpoints, disabledIds, swapEndpoints);
  })();

  if (!force) inFlight = run.finally(() => (inFlight = null));
  await run;
}

/**
 * The operator's pool, or null when they have not configured one. Synchronous
 * on purpose: `buildProviders` is sync and is called from every RPC path in
 * the process, so the DB read happens out of band (see `refreshRpcEndpoints`).
 */
export function configuredEndpoints(): ProviderEndpoint[] | null {
  return cache?.endpoints ?? null;
}

/** Enabled swap-only endpoints; empty means the swap uses the shared pool alone. */
export function configuredSwapEndpoints(): ProviderEndpoint[] {
  return cache?.swapEndpoints ?? [];
}

/** Endpoints the operator switched OFF. Non-empty means the pool is smaller. */
export function disabledEndpointIds(): string[] {
  return cache?.disabledIds ?? [];
}

/** Has the table ever been read in this process? */
export function rpcEndpointsPrimed(): boolean {
  return cache !== null;
}

/**
 * Fire-and-forget refresh, called from `buildProviders`.
 *
 * THIS IS THE WIRING, and it is placed here rather than at a list of call
 * sites on purpose. §8 #10: `primeTrustedLockers()` was correct, tested, and
 * had zero callers for months. The one function that cannot be forgotten is
 * the one the feature already goes through — every RPC request in this process
 * builds the pool, so refreshing from inside the build is the only wiring with
 * no second place to remember.
 *
 * Cost of the async seam: the first pool build after a cold start uses the env
 * seed. That is one build, and `buildProviders` re-checks the generation on
 * every call, so the DB set takes over as soon as the read lands.
 */
export function refreshRpcEndpoints(): void {
  void primeRpcEndpoints().catch(() => {});
}
