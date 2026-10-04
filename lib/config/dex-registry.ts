import { isAddressConfigured } from "./chain";
import { trustedAddressCachePrimed, trustedAddresses } from "./trusted-addresses";
import { dexEnabledOverride } from "./dex-enablement";
import { CANONICAL_STOCK_TOKENS } from "../trade/canonical-stocks";
import { CANONICAL_STOCK_ADDRESSES } from "../trade/types";

/**
 * Multi-DEX registry (2026-07-18).
 *
 * Robinhood Chain hosts several Uniswap-fork DEXes, and a token's DEEPEST pool
 * can live on any of them — SUSHICAT (0xaA4b…51b0) kept 74% of its liquidity on
 * SushiSwap V3 while a Uniswap-only scan saw only the V4 remainder and wrongly
 * read one wallet as controlling "100% of the price-backing liquidity." This
 * registry is the single source of truth for which DEXes exist and what
 * contracts each exposes, so discovery, materiality, custody, and the honeypot
 * sim can iterate every venue instead of a single hard-coded one.
 *
 * TIERED COVERAGE — a deployment is useful even when partially known:
 *   - a FACTORY (V2/V3) or POOL MANAGER (V4) alone powers pool DISCOVERY and
 *     MATERIALITY (both only need a pool address + `token.balanceOf(pool)`);
 *   - the PERIPHERALS add that DEX's own verdicts: NPM → V3/V4 LP-custody,
 *     Quoter+Router → honeypot sell-sim. Missing peripherals degrade that DEX's
 *     pools to "seen and weighed, custody UNKNOWN" — honest, never invisible,
 *     never a false verdict.
 *
 * Every address is env-driven (see .env.example) and verified on-chain; nulls
 * are absent-by-design (e.g. SushiSwap V4 ships no stock periphery). This module
 * only STRUCTURES the addresses — the discovery/custody wiring that consumes
 * `enabledDexes()` is a separate change; until it lands, behavior is unchanged.
 */

const opt = (v: string | undefined): string | null => {
  const a = (v ?? "").trim().toLowerCase();
  return isAddressConfigured(a) ? a : null;
};

/** V2: factory drives discovery; router is only needed for the sell-sim. */
export interface V2Deployment {
  factory: string;
  router: string | null;
}
/** V3: factory → discovery; NPM → custody; quoter+router → honeypot sim. */
export interface V3Deployment {
  factory: string;
  swapRouter: string | null;
  quoter: string | null;
  positionManager: string | null;
}
/** V4: singleton PoolManager → discovery/custody; stateView/quoter → sim reads. */
export interface V4Deployment {
  poolManager: string;
  stateView: string | null;
  quoter: string | null;
  positionManager: string | null;
}

/**
 * CL (Aerodrome/Velodrome **Slipstream**; "Up" on this chain). Concentrated
 * liquidity like V3, but the factory keys pools on `tickSpacing`, not fee, and a
 * position staked into a gauge has the GAUGE as its `ownerOf`. `voter` is what
 * proves an address is a real gauge rather than an arbitrary contract, so
 * custody can look through it instead of naming it the whale. See lib/dex/slipstream.ts.
 */
export interface ClDeployment {
  factory: string;
  positionManager: string | null;
  voter: string | null;
}

export interface DexDeployment {
  id: string;
  name: string;
  /** Master switch. A DEX with no configured factory is inert regardless. */
  enabled: boolean;
  v2: V2Deployment | null;
  v3: V3Deployment | null;
  v4: V4Deployment | null;
  cl: ClDeployment | null;
}

const role = (dexId: string, category: string, protocol?: "v2" | "v3" | "v4"): string | null => {
  const candidates = trustedAddresses().filter((row) =>
    row.dex_id === dexId && row.category === category &&
    (!protocol || row.metadata.protocol === protocol || row.label.toLowerCase().includes(protocol)),
  );
  return candidates[0]?.address ?? null;
};
/**
 * CL roles match on `metadata.protocol` ONLY. `role()`'s label fallback is a
 * substring test, and "cl" is two characters — it matches "Clanker", "Oracle",
 * "Classic". A wrong address here is not a missed pool, it is custody read
 * against a foreign contract.
 */
const clRole = (dexId: string, category: string, roleTag?: string): string | null =>
  trustedAddresses().find(
    (row) =>
      row.dex_id === dexId &&
      row.category === category &&
      row.metadata.protocol === "cl" &&
      (!roleTag || row.metadata.role === roleTag),
  )?.address ?? null;

const fallbackFlag = (value: string | undefined) => value === "true";

/**
 * The operator's /admin setting wins; absent, the historical default stands
 * (KNOWN-PROBLEMS F2). That default is `primed || env`, which is why flipping
 * `ENABLE_SUSHISWAP` alone never turned SushiSwap off: priming the
 * trusted-address cache re-enabled it. The panel is now the switch.
 */
const dexEnabled = (dexId: string, envFlag: string | undefined): boolean =>
  dexEnabledOverride(dexId) ?? (trustedAddressCachePrimed() || fallbackFlag(envFlag));

const v2 = (factory: string | null, router: string | null): V2Deployment | null =>
  factory ? { factory, router } : null;
const v3 = (
  factory: string | null,
  swapRouter: string | null,
  quoter: string | null,
  positionManager: string | null,
): V3Deployment | null => (factory ? { factory, swapRouter, quoter, positionManager } : null);
const v4 = (
  poolManager: string | null,
  stateView: string | null,
  quoter: string | null,
  positionManager: string | null,
): V4Deployment | null => (poolManager ? { poolManager, stateView, quoter, positionManager } : null);
const cl = (
  factory: string | null,
  positionManager: string | null,
  voter: string | null,
): ClDeployment | null => (factory ? { factory, positionManager, voter } : null);

/**
 * The primary deployment (Uniswap) reuses the long-standing flat `addresses` so
 * nothing about its behavior changes; SushiSwap and PancakeSwap read the
 * per-DEX env blocks. Order is priority: earlier DEXes are the canonical venues
 * discovery should weigh first.
 */
/**
 * Built fresh on each call (reads process.env at call time, not import time) so
 * env-load ordering can never freeze an empty registry, and tests can vary the
 * config. Cheap — a handful of string reads.
 */
export function dexes(): DexDeployment[] {
  return [
  {
    id: "uniswap",
    name: "Uniswap",
    // Uniswap holds every V4 pool on this chain, so switching it off blinds the
    // scanner to the venue custody depends on most. An explicit `false` row is
    // still honoured — the panel warns; it does not overrule.
    enabled: dexEnabledOverride("uniswap") ?? true,
    v2: v2(
      role("uniswap", "dex-factory", "v2"),
      role("uniswap", "dex-router", "v2"),
    ),
    v3: v3(
      role("uniswap", "dex-factory", "v3"),
      role("uniswap", "dex-router", "v3"),
      role("uniswap", "dex-quoter", "v3"),
      role("uniswap", "dex-position-manager", "v3"),
    ),
    v4: v4(
      role("uniswap", "dex-pool-manager"),
      role("uniswap", "dex-state-view", "v4"),
      role("uniswap", "dex-quoter", "v4"),
      role("uniswap", "dex-position-manager", "v4"),
    ),
    cl: null, // Uniswap ships no Slipstream deployment
  },
  {
    id: "sushiswap",
    name: "SushiSwap",
    enabled: dexEnabled("sushiswap", process.env.ENABLE_SUSHISWAP),
    v2: v2(role("sushiswap", "dex-factory", "v2"), role("sushiswap", "dex-router", "v2")),
    v3: v3(
      role("sushiswap", "dex-factory", "v3"),
      role("sushiswap", "dex-router", "v3"),
      role("sushiswap", "dex-quoter", "v3"),
      role("sushiswap", "dex-position-manager", "v3"),
    ),
    // SushiSwap ships NO V4 on this chain (only V2 + V3 — confirmed against
    // github.com/sushiswap). The contract that looked V4-ish (0x0e867974, unlock/
    // take/settle selectors) is SushiSwap's RedSnwapper route executor, NOT a
    // Uniswap-V4 singleton: it has an owner(), lacks extsload/protocolFeesAccrued/
    // ERC-6909, and holds ~0 tokens. All V4 liquidity on this chain is Uniswap's.
    v4: null,
    cl: null,
  },
  {
    id: "pancakeswap",
    name: "PancakeSwap",
    enabled: dexEnabled("pancakeswap", process.env.ENABLE_PANCAKESWAP),
    v2: v2(role("pancakeswap", "dex-factory", "v2"), role("pancakeswap", "dex-router", "v2")),
    v3: v3(
      role("pancakeswap", "dex-factory", "v3"),
      role("pancakeswap", "dex-router", "v3"),
      role("pancakeswap", "dex-quoter", "v3"),
      role("pancakeswap", "dex-position-manager", "v3"),
    ),
    v4: null, // no PancakeSwap V4 on this chain
    cl: null,
  },
  {
    // "Up" — `up-v3` on GeckoTerminal, `up` on DexScreener. Slipstream CL only:
    // no V2/V3/V4 deployment exists, and its 991-pool factory holds the deepest
    // pool of ~20% of scanned tokens (KNOWN-PROBLEMS L10).
    id: "up",
    name: "Up",
    enabled: dexEnabled("up", process.env.ENABLE_UP),
    v2: null,
    v3: null,
    v4: null,
    cl: cl(
      clRole("up", "dex-factory"),
      clRole("up", "dex-position-manager"),
      // The voter has no category of its own — `trusted_address.category` is
      // CHECK-constrained and `dex-infra` is the general slot, so the role is
      // carried in metadata rather than by widening the constraint.
      clRole("up", "dex-infra", "voter"),
    ),
  },
  ];
}

/** DEXes that are switched on AND have at least one configured venue. */
export function enabledDexes(): DexDeployment[] {
  return dexes().filter((d) => d.enabled && (d.v2 || d.v3 || d.v4 || d.cl));
}

/**
 * Look up one enabled DEX deployment by its dex-registry id (as stamped onto a
 * `PoolRef.dexId` by cross-DEX discovery). Returns null for an absent/unknown
 * id — the caller falls back to the primary Uniswap deployment's own default
 * addresses, never guesses a substitute.
 */
export function dexById(dexId: string | undefined): DexDeployment | null {
  if (!dexId) return null;
  return enabledDexes().find((d) => d.id === dexId) ?? null;
}

/**
 * The PRIMARY (Uniswap) deployment, built from the flat env `addresses`
 * (lib/config/chain.ts) — NOT the DB-backed `role()` registry that the
 * multi-DEX `dexes()` list uses. This split is deliberate and load-bearing:
 * the honeypot sim and custody reads have ALWAYS resolved the primary
 * deployment from these env addresses, so sourcing `primaryDeployment()` the
 * same way keeps it byte-identical to today — a cache-unprimed process (local
 * dev, no DB) still gets the primary router/quoter/factory, where a
 * `role()`-sourced value would be null. Stream 4: the registry becomes the
 * single ACCESSOR every sim path consumes for "the primary venue", while
 * chain.ts stays the single env READ — no adapter reaches into `addresses`
 * behind the registry's back anymore.
 */
export function primaryDeployment(): DexDeployment {
  return {
    id: "uniswap",
    name: "Uniswap",
    enabled: true,
    v2: v2(opt(process.env.V2_FACTORY_ADDRESS), opt(process.env.V2_ROUTER02_ADDRESS)),
    v3: v3(
      opt(process.env.V3_FACTORY_ADDRESS),
      opt(process.env.SWAP_ROUTER_ADDRESS),
      opt(process.env.QUOTER_V2_ADDRESS),
      opt(process.env.NONFUNGIBLE_POSITION_MANAGER_ADDRESS),
    ),
    v4: v4(
      opt(process.env.V4_POOL_MANAGER_ADDRESS),
      opt(process.env.V4_STATE_VIEW_ADDRESS),
      opt(process.env.V4_QUOTER_ADDRESS),
      opt(process.env.V4_POSITION_MANAGER_ADDRESS),
    ),
    cl: null, // Slipstream is its own DEX ("up"), never part of the primary venue
  };
}

/** Every configured V3 factory across enabled DEXes, with its deployment. */
export function v3Factories(): { dex: DexDeployment; v3: V3Deployment }[] {
  return enabledDexes()
    .filter((d): d is DexDeployment & { v3: V3Deployment } => d.v3 !== null)
    .map((d) => ({ dex: d, v3: d.v3 }));
}

/** Every configured Slipstream/CL factory across enabled DEXes. */
export function clFactories(): { dex: DexDeployment; cl: ClDeployment }[] {
  return enabledDexes()
    .filter((d): d is DexDeployment & { cl: ClDeployment } => d.cl !== null)
    .map((d) => ({ dex: d, cl: d.cl }));
}

/** Every configured V2 factory across enabled DEXes, with its deployment. */
export function v2Factories(): { dex: DexDeployment; v2: V2Deployment }[] {
  return enabledDexes()
    .filter((d): d is DexDeployment & { v2: V2Deployment } => d.v2 !== null)
    .map((d) => ({ dex: d, v2: d.v2 }));
}

/**
 * Quote assets discovery pairs a scanned token against. WETH is the native
 * quote; USDG is Robinhood Chain's canonical settlement stable and backs the
 * deepest pools of many launchpad tokens (SUSHICAT's real market is USDG-quoted
 * on V4). Extend via QUOTE_ASSET_ADDRESSES (comma-separated) without code.
 */
export function quoteAssets(): string[] {
  const infra = trustedAddresses().filter((r) => r.category === "infra-asset").map((r) => r.address);
  const fallbackInfra = trustedAddressCachePrimed()
    ? []
    : [opt(process.env.WETH_ADDRESS), opt(process.env.USDG_ADDRESS) ?? "0x5fc5360d0400a0fd4f2af552add042d716f1d168"];
  const extra = (process.env.QUOTE_ASSET_ADDRESSES ?? "")
    .split(",")
    .map((s) => opt(s))
    .filter((a): a is string => a !== null);
  return [...new Set([...infra, ...fallbackInfra, ...extra].filter((a): a is string => !!a && isAddressConfigured(a)))];
}

/**
 * All quote assets recognized for launch discovery and direct DEX pairing.
 * Includes infra assets plus the caller's verified stock registry addresses.
 * The small client-safe canonical list covers bootstrapping without a DB.
 *
 * Kept separate from `quoteAssets()` so `discoverCustodyPools()` does not fan out
 * thousands of speculative getPool calls per scan across the stock registry.
 */
export function launchQuoteAssets(verifiedRwaAddresses: readonly string[] = []): string[] {
  const base = quoteAssets();
  const fallbackStocks = [
    ...Array.from(CANONICAL_STOCK_ADDRESSES),
    ...CANONICAL_STOCK_TOKENS.map((t) => t.address),
  ];
  return [...new Set([...base, ...fallbackStocks, ...verifiedRwaAddresses].map((a) => a.toLowerCase()).filter((a) => isAddressConfigured(a)))];
}
