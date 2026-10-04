// Type-only: erased at compile time, so it cannot drag a runtime module in.
import type { TrustCategory } from "../verify/trusted-address";

/**
 * The database and RPC dependencies below are imported DYNAMICALLY, inside
 * `loadTrustedAddresses`, and that is load-bearing — not a style choice.
 *
 * `lib/config/chain.ts` calls `isTrustedAddress` from this module, and
 * `chain.ts` exports plain constants (`explorerWebUrl`, `geckoTerminalNetwork`)
 * that CLIENT components import — `app/components/site/VerdictView.tsx` among
 * them. A static `import { rpc } from "../rpc/client"` here therefore builds a
 * chain of chain.ts → trusted-addresses.ts → rpc/client.ts → provider-pool.ts →
 * observability/context.ts, and that last module pulls Node-only `async_hooks`
 * and `crypto`. The result is a hard production build failure (Turbopack, 8
 * errors) even though `next dev` and `tsc` both stay green — the same hazard
 * `ScanForm.tsx` documents when it duplicates `ScanProgressEvent` locally
 * rather than importing it.
 *
 * Keeping these dynamic means the client bundle sees only the pure cache
 * lookup. Server behavior is unchanged: `loadTrustedAddresses` is async and
 * only ever runs server-side.
 */

export interface TrustedAddress {
  address: string;
  chain_id: number;
  category: TrustCategory;
  subtype: string | null;
  label: string;
  dex_id: string | null;
  metadata: Record<string, unknown>;
  verify_status: "ok" | "failed" | "unchecked" | "unprobeable";
}

interface Cache {
  rows: TrustedAddress[];
  byCategory: Map<TrustCategory, Set<string>>;
  rwaTokens: Set<string>;
  /** When the registry rows (a DB read) were loaded. */
  loadedAt: number;
  /**
   * When the 194-token RWA probe last RAN. Null means never — a separate clock
   * because the two halves have different costs and different callers, and a
   * cheap registry refresh must not make the expensive probe look fresh.
   */
  rwaLoadedAt: number | null;
}

const TTL_MS = 10 * 60_000;
let cache: Cache | null = null;

const address = (v: string | undefined) => v?.trim().toLowerCase() ?? "";
const splitEnv = (v: string | undefined) => (v ?? "").split(",").map(address).filter((a) => /^0x[0-9a-f]{40}$/.test(a));

/**
 * One row the code seed intends to produce, and the env var it reads.
 *
 * The env var name is carried because a seed row that never materialises is
 * invisible in the rows themselves: `envSeed()` simply returns a shorter array.
 * `seedPlan()` below exposes the intent so a reconciliation can tell
 * "the registry is missing this" from "the env var that would have seeded it is
 * unset" — two very different bugs that produce an identical, empty symptom.
 * `V4_POSITION_MANAGER_ADDRESS` unset on the VPS is exactly this: V4 custody
 * silently SKIPs and nothing anywhere says why.
 */
interface SeedIntent {
  env: string;
  category: TrustCategory;
  label: string;
  dex_id: string | null;
  /** Used when the env var is unset — only USDG has one. */
  fallback?: string;
}

const SEED_PLAN: readonly SeedIntent[] = [
  { env: "WETH_ADDRESS", category: "infra-asset", label: "Environment WETH", dex_id: null },
  { env: "USDG_ADDRESS", category: "infra-asset", label: "Environment USDG", dex_id: null, fallback: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" },

  { env: "V2_FACTORY_ADDRESS", category: "dex-factory", label: "Uniswap V2 factory", dex_id: "uniswap" },
  { env: "V2_ROUTER02_ADDRESS", category: "dex-router", label: "Uniswap V2 router", dex_id: "uniswap" },
  { env: "V3_FACTORY_ADDRESS", category: "dex-factory", label: "Uniswap V3 factory", dex_id: "uniswap" },
  { env: "SWAP_ROUTER_ADDRESS", category: "dex-router", label: "Uniswap V3 router", dex_id: "uniswap" },
  { env: "QUOTER_V2_ADDRESS", category: "dex-quoter", label: "Uniswap V3 quoter", dex_id: "uniswap" },
  { env: "NONFUNGIBLE_POSITION_MANAGER_ADDRESS", category: "dex-position-manager", label: "Uniswap V3 position manager", dex_id: "uniswap" },
  { env: "V4_POOL_MANAGER_ADDRESS", category: "dex-pool-manager", label: "Uniswap V4 pool manager", dex_id: "uniswap" },
  { env: "V4_STATE_VIEW_ADDRESS", category: "dex-state-view", label: "Uniswap V4 state view", dex_id: "uniswap" },
  { env: "V4_QUOTER_ADDRESS", category: "dex-quoter", label: "Uniswap V4 quoter", dex_id: "uniswap" },
  { env: "V4_POSITION_MANAGER_ADDRESS", category: "dex-position-manager", label: "Uniswap V4 position manager", dex_id: "uniswap" },
  { env: "SUSHI_V2_FACTORY_ADDRESS", category: "dex-factory", label: "Sushi V2 factory", dex_id: "sushiswap" },
  { env: "SUSHI_V2_ROUTER02_ADDRESS", category: "dex-router", label: "Sushi V2 router", dex_id: "sushiswap" },
  { env: "SUSHI_V3_FACTORY_ADDRESS", category: "dex-factory", label: "Sushi V3 factory", dex_id: "sushiswap" },
  { env: "SUSHI_V3_SWAP_ROUTER_ADDRESS", category: "dex-router", label: "Sushi V3 router", dex_id: "sushiswap" },
  { env: "SUSHI_V3_QUOTER_V2_ADDRESS", category: "dex-quoter", label: "Sushi V3 quoter", dex_id: "sushiswap" },
  { env: "SUSHI_V3_POSITION_MANAGER_ADDRESS", category: "dex-position-manager", label: "Sushi V3 position manager", dex_id: "sushiswap" },
  { env: "PANCAKE_V2_FACTORY_ADDRESS", category: "dex-factory", label: "Pancake V2 factory", dex_id: "pancakeswap" },
  { env: "PANCAKE_V2_ROUTER02_ADDRESS", category: "dex-router", label: "Pancake V2 router", dex_id: "pancakeswap" },
  { env: "PANCAKE_V3_FACTORY_ADDRESS", category: "dex-factory", label: "Pancake V3 factory", dex_id: "pancakeswap" },
  { env: "PANCAKE_V3_SWAP_ROUTER_ADDRESS", category: "dex-router", label: "Pancake V3 router", dex_id: "pancakeswap" },
  { env: "PANCAKE_V3_QUOTER_V2_ADDRESS", category: "dex-quoter", label: "Pancake V3 quoter", dex_id: "pancakeswap" },
  { env: "PANCAKE_V3_POSITION_MANAGER_ADDRESS", category: "dex-position-manager", label: "Pancake V3 position manager", dex_id: "pancakeswap" },
];

const seedAddress = (intent: SeedIntent): string =>
  address(process.env[intent.env] ?? intent.fallback);

const isSeedable = (a: string) => /^0x[0-9a-f]{40}$/.test(a) && !/^0x0{40}$/.test(a);

/** Bootstrap only: the database is authoritative once a primed cache is available. */
function envSeed(): TrustedAddress[] {
  const rows: TrustedAddress[] = [];
  for (const intent of SEED_PLAN) {
    const a = seedAddress(intent);
    if (!isSeedable(a)) continue;
    rows.push({
      address: a, chain_id: 4663, category: intent.category, subtype: null,
      label: intent.label, dex_id: intent.dex_id, metadata: {}, verify_status: "ok",
    });
  }
  return rows;
}

/**
 * The seed's *intent* — every row it means to produce, whether or not the env
 * var behind it is set. This is what `envSeed()` cannot tell you, and what a
 * registry reconciliation needs: a seed row missing from the database and a
 * seed row that was never generated look identical downstream, and only the
 * first one is fixed by a migration.
 *
 * Exported for `lib/internal/reads.ts` (the agent plane's `get_dex_registry`)
 * and read-only — nothing may mutate the plan.
 */
export function seedPlan(): Array<SeedIntent & { address: string | null }> {
  return SEED_PLAN.map((intent) => {
    const a = seedAddress(intent);
    return { ...intent, address: isSeedable(a) ? a : null };
  });
}

/**
 * `rwaTokens === null` means "registry-only refresh": keep the RWA probe result
 * already cached, and keep its clock. Overwriting it with an empty set would
 * publish "not a canonical RWA token" about every stock token in the registry —
 * §4, laundering a read we did not perform into a negative answer.
 */
function install(rows: readonly TrustedAddress[], rwaTokens: Iterable<string> | null = []): void {
  const normalized = rows.map((r) => ({ ...r, address: r.address.toLowerCase(), metadata: r.metadata ?? {} }));
  const byCategory = new Map<TrustCategory, Set<string>>();
  for (const row of normalized) {
    if (row.verify_status !== "ok" && row.verify_status !== "unprobeable") continue;
    const set = byCategory.get(row.category) ?? new Set<string>();
    set.add(row.address);
    byCategory.set(row.category, set);
  }
  cache = {
    rows: normalized,
    byCategory,
    rwaTokens: rwaTokens === null ? (cache?.rwaTokens ?? new Set<string>()) : new Set([...rwaTokens].map((a) => a.toLowerCase())),
    loadedAt: Date.now(),
    rwaLoadedAt: rwaTokens === null ? (cache?.rwaLoadedAt ?? null) : Date.now(),
  };
}

export function setTrustedAddressesForTest(rows: readonly TrustedAddress[], rwaTokens: readonly string[] = []): void {
  install(rows, rwaTokens);
}

/**
 * Single-flight guard. A cold cache is hit by every concurrent render at
 * once; without this, each one fires its own full registry read plus a
 * ~25-way live RPC probe burst — which is itself what rate-limits the probes
 * and produces the spurious "Review" labels this function is meant to avoid.
 */
let inFlight: Promise<void> | null = null;
/** Separate from `inFlight` so a full prime can never be satisfied by a registry-only one. */
let inFlightRegistry: Promise<void> | null = null;

/**
 * Live probes in flight at once (L80). The probes share one RPC pool with every
 * scan running at the same time, so this is a courtesy limit, not a throughput
 * knob — raising it is what produced the transient burst it exists to stop.
 */
const PROBE_CONCURRENCY = 8;

/** How many probes replayed stored trust on the last refill. Read by /admin/trusted. */
let lastProbeTransientCount = 0;

export function rwaProbeTransientCount(): number {
  return lastProbeTransientCount;
}

/** `Promise.all` with a worker cap, preserving input order. */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The three modules below are reached through dynamic `import()` (see the
 * import-block comment at the top of this file). `mock.module` does NOT
 * intercept a dynamic import on the Linux CI runner: it no-ops in silence, the
 * real repository runs and returns its documented empty value, and the test
 * then asserts against a count nobody produced. It works on macOS, so the gap
 * is invisible locally and CI is the only place it shows.
 *
 * Defaults to the real imports. Never set outside a test.
 */
type AdminTrustDeps = Pick<
  typeof import("../data/admin-trust"),
  "readEnabledTrustedAddresses" | "readVerifiedRwaRegistry"
>;
type RpcDeps = Pick<typeof import("../rpc/client"), "rpc">;
type VerifyDeps = Pick<typeof import("../verify/trusted-address"), "verifyRwaToken">;

interface TrustedAddressDeps {
  adminTrust: () => Promise<AdminTrustDeps>;
  rpcClient: () => Promise<RpcDeps>;
  verify: () => Promise<VerifyDeps>;
}

const realDeps: TrustedAddressDeps = {
  adminTrust: () => import("../data/admin-trust"),
  rpcClient: () => import("../rpc/client"),
  verify: () => import("../verify/trusted-address"),
};

let deps: TrustedAddressDeps = realDeps;

export function _setTrustedAddressDeps(overrides: Partial<TrustedAddressDeps> | null): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

async function loadTrustedAddresses(): Promise<void> {
  try {
    // Dynamic on purpose — see the import-block comment at the top of this file.
    const [{ readEnabledTrustedAddresses, readVerifiedRwaRegistry }, { rpc }, { verifyRwaToken }] =
      await Promise.all([deps.adminTrust(), deps.rpcClient(), deps.verify()]);

    const [trustedRows, registryRows] = await Promise.all([
      readEnabledTrustedAddresses(4663),
      readVerifiedRwaRegistry(),
    ]);

    // `verify_status === "ok"` is the durable, admin-curated verification
    // result. The live probe below is a re-confirmation, so it may only
    // *demote* on a definitive negative — never on an RPC hiccup.
    const candidates = (registryRows ?? [])
      .filter((r) => r.verify_status === "ok")
      .map((r) => r.address.toLowerCase());

    // KNOWN-PROBLEMS L80 — bounded, not `Promise.all`. This fans out one live
    // RPC probe per candidate, and the candidate list is the registry: it was
    // 25 addresses when this was written and became 194 the day the canonical
    // stock-token registry was synced (L78). The unbounded burst rate-limited
    // ITSELF — 15 of 194 probes came back transient on the first refill and
    // replayed stored trust — which is the exact "spurious Review" this
    // function exists to prevent, arriving through the back door.
    let transient = 0;
    const verified = await mapBounded(candidates, PROBE_CONCURRENCY, async (a) => {
      try {
        const probe = await verifyRwaToken(rpc(), a);
        if (probe.ok) return a;
        if (probe.transient) {
          // Could not reach a verdict — keep the stored trust rather than
          // silently demoting a canonical token to "Review".
          transient += 1;
          console.warn(`[RC_RWA_PROBE_TRANSIENT] keeping stored trust for ${a}: ${probe.reason}`);
          return a;
        }
        return null; // definitive negative: the token really is not canonical
      } catch (error) {
        transient += 1;
        console.warn(`[RC_RWA_PROBE_TRANSIENT] keeping stored trust for ${a}:`, error);
        return a;
      }
    });

    // The fallback is correct (§4) but it is NOT free: the badge promises the
    // address still matches the canonical beacon, and a replayed result did not
    // re-confirm that. One `console.warn` per address is invisible at 194 rows,
    // so state the fraction once — a silent degradation is the thing that grows.
    lastProbeTransientCount = transient;
    if (transient > 0) {
      console.warn(
        `[RC_RWA_PROBE_DEGRADED] ${transient}/${candidates.length} RWA authenticity probes fell back to stored trust`,
      );
    }

    install(trustedRows, verified.filter((a): a is string => !!a));
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] trusted_address load failed:", error);
    // `null`, not `[]`: the probe did not run, so its clock must stay stale or
    // the next full prime would skip it for a whole TTL.
    if (!cache) install(envSeed(), null);
    else cache.loadedAt = Date.now();
  }
}

/**
 * Registry rows only — one DB read, no RPC. For callers that need the DEX/venue
 * registry (`dexEnabled`, `configuredFactories`) and nothing that the 194-token
 * RWA probe produces.
 *
 * Exists because the tracker job needs the registry every tick, and priming it
 * through `primeTrustedAddresses` dragged ~2,300 RPC calls/hour of RWA
 * re-verification into a process that has no reader for the result.
 */
async function loadRegistryRows(): Promise<void> {
  try {
    // Dynamic on purpose — see the import-block comment at the top of this file.
    // Only the registry module: this path must not drag in the RPC chain.
    const { readEnabledTrustedAddresses } = await deps.adminTrust();
    install(await readEnabledTrustedAddresses(4663), null);
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] trusted_address registry load failed:", error);
    if (!cache) install(envSeed(), null);
    else cache.loadedAt = Date.now();
  }
}

export async function primeTrustedAddresses(force = false): Promise<void> {
  // BOTH halves must be fresh. Keyed on `rwaLoadedAt` as well as `loadedAt`
  // because `primeTrustedRegistry` refreshes the registry clock alone: without
  // this clause a registry prime would satisfy this gate, and every scan
  // sharing the process would read an EMPTY rwaTokens set — publishing "not a
  // canonical RWA token" about all 194 of them.
  if (
    !force &&
    cache &&
    Date.now() - cache.loadedAt < TTL_MS &&
    cache.rwaLoadedAt !== null &&
    Date.now() - cache.rwaLoadedAt < TTL_MS
  ) {
    return;
  }

  // A forced refresh must never join an in-flight load that started before
  // the mutation it is meant to pick up — admin writes call this immediately
  // after changing the registry.
  if (!force && inFlight) return inFlight;

  const load = loadTrustedAddresses().finally(() => {
    if (inFlight === load) inFlight = null;
  });
  inFlight = load;
  return load;
}

/**
 * Prime the registry half only. Safe to call on a hot path: one DB read.
 *
 * Joins a full prime if one is already running (it is a superset), but a full
 * prime must NEVER join this one — that direction would silently drop the RWA
 * probe, which is why `primeTrustedAddresses` tracks its own in-flight promise.
 */
export async function primeTrustedRegistry(force = false): Promise<void> {
  if (!force && cache && Date.now() - cache.loadedAt < TTL_MS) return;
  if (!force && inFlight) return inFlight;
  if (!force && inFlightRegistry) return inFlightRegistry;

  const load = loadRegistryRows().finally(() => {
    if (inFlightRegistry === load) inFlightRegistry = null;
  });
  inFlightRegistry = load;
  return load;
}


export function trustedAddresses(): readonly TrustedAddress[] { return cache?.rows ?? envSeed(); }
export const trustedAddressCachePrimed = () => cache !== null;
export function trustedAddressSet(category: TrustCategory): Set<string> { return cache?.byCategory.get(category) ?? new Set(envSeed().filter((r) => r.category === category).map((r) => r.address)); }
export function isTrustedAddress(category: TrustCategory, value: string | null | undefined): boolean { return !!value && trustedAddressSet(category).has(value.toLowerCase()); }
export const isTrustedBeacon = (a: string | null | undefined) => isTrustedAddress("rwa-beacon", a);
export const isTrustedVault = (a: string | null | undefined) => isTrustedAddress("rwa-vault", a);
export const isRwaOperator = (a: string | null | undefined) => isTrustedAddress("rwa-operator", a);
export const isTrustedFactoryDeployer = (a: string | null | undefined) => isTrustedAddress("rwa-factory", a);
export const isTrustedProxy = (a: string | null | undefined) => isTrustedAddress("trusted-proxy", a);
export const isTrustedRwaToken = (a: string | null | undefined) => !!a && (cache?.rwaTokens ?? new Set<string>()).has(a.toLowerCase());
export function clearTrustedAddressCache(): void { cache = null; }

/**
 * Lockers whose custody is PERMANENT — supply they hold can never re-enter the
 * float, so it is not circulating supply (L91).
 *
 * `subtype` is the gate, not `category`. A `timelock` row (UNCX) has an unlock
 * DATE: treating its balance as gone would be an all-clear about supply that
 * comes back, which is §8 #13's trade in the losing direction. Only `permanent`
 * qualifies, and only because those rows carry `withdrawPath: "none"` proven by
 * a dispatcher census — a locker that can release is not one of these.
 *
 * This RECLASSIFIES, it does not delete: callers must disclose the quantity in
 * the published sentence, exactly as the pool exclusion already does.
 */
export function permanentLockerSet(): Set<string> {
  return new Set(
    trustedAddresses()
      .filter((r) => r.category === "lp-locker" && r.subtype === "permanent")
      .map((r) => r.address.toLowerCase()),
  );
}

/**
 * The launchpad that deployed a token, when the registry names it.
 *
 * KNOWN-PROBLEMS L22. Migrations 0059/0060 wrote 12 launchpad identities with a
 * `launchpad-*` subtype and NOTHING read `subtype` — every lookup went by
 * `category`, where all 12 sit in `dex-infra` alongside routers and quoters.
 * `checkLaunchpadProvenance` therefore asked `curve_tokens` (three curve
 * pollers, 8 of 71 scanned tokens) and published "not in the launchpad
 * registry" about pads we had audited — 54 of 63 of its SKIPs.
 *
 * Keyed on `subtype`, never on `category`: L23 attributes V4 liquidity through
 * this same lookup, and a category match would name a swap router or the
 * position manager as a pool's holder (L11, §8 #14).
 *
 * Identity ONLY. This says which pad deployed the token; it says nothing about
 * the raise, and callers must not let it stand in for one — no row records a
 * `venueModel`, and L12 chain-verified that Pons V2 (`launchpad-deployer`) does
 * run a bonding curve, so the subtype cannot imply "no curve, no raise".
 */
export interface LaunchpadIdentity {
  address: string;
  label: string;
  /** `launchpad-deployer` | `launchpad-factory` | `launchpad-curve`. */
  subtype: string;
}

export function launchpadIdentity(value: string | null | undefined): LaunchpadIdentity | null {
  if (!value) return null;
  const needle = value.toLowerCase();
  for (const row of trustedAddresses()) {
    if (row.address !== needle) continue;
    if (!row.subtype?.startsWith("launchpad-")) continue;
    return { address: row.address, label: row.label, subtype: row.subtype };
  }
  return null;
}
