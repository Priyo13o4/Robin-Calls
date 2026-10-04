import { isAddress } from "viem";
import { flags } from "@/lib/config/flags";
import { readSiteConfigKeys } from "@/lib/data/site-config";
import { isDatabaseConfigured as defaultIsDatabaseConfigured } from "@/lib/db/client";
import { reportError } from "@/lib/observability/reporter";
import { SUSHI_ROUTE_PROCESSOR, UR_PROFILES } from "./venues";

export const SWAP_CONFIG_KEYS = {
  execution: "swap_execution_enabled",
  gasless: "swap_gasless_enabled",
  equityBasis: "equity_basis_enabled",
  v4: "swap_v4_enabled",
  venueUniswap: "swap_venue_uniswap_enabled",
  venuePancake: "swap_venue_pancake_enabled",
  venueSushi: "swap_venue_sushi_enabled",
  multihop: "swap_multihop_enabled",
  routeGraph: "swap_route_graph_enabled",
  feeRecipient: "swap_fee_recipient",
  feeBps: "swap_fee_bps",
} as const;

export type SwapFeatureName =
  | "execution"
  | "gasless"
  | "equityBasis"
  | "v4"
  | "venueUniswap"
  | "venuePancake"
  | "venueSushi"
  | "multihop"
  | "routeGraph";

export type FeatureState =
  | { on: true }
  | {
      on: false;
      reason: "env-off" | "admin-off" | "requires-off" | "config-unavailable" | "permanently-disabled";
      detail: string;
    };

export type SwapFeeConfig =
  | { kind: "set"; recipient: `0x${string}`; bps: number }
  | { kind: "unconfigured"; detail: string }
  | { kind: "unavailable" };

export interface SwapConfig {
  features: Record<SwapFeatureName, FeatureState>;
  fee: SwapFeeConfig;
}

// A fee paid to a router or Permit2 rests there and anyone can sweep it. Derived from the
// venue profiles so a new venue cannot arrive without its router, and lowercased because
// validateFeeRecipient compares a lowercased input.
export const FORBIDDEN_FEE_RECIPIENTS: readonly `0x${string}`[] = [
  ...new Set(
    [
      ...UR_PROFILES.flatMap((p) => [p.router, p.permit2, p.weth]),
      SUSHI_ROUTE_PROCESSOR,
      "0x5fc5360d0400a0fd4f2af552add042d716f1d168", // USDG
      "0x8366a39cc670b4001a1121b8f6a443a643e40951", // Uniswap V4 PoolManager
      // Universal Router recipient sentinels: 0x…01 pays the caller, 0x…02 the router itself.
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
    ].map((a) => a.toLowerCase() as `0x${string}`),
  ),
];

export type ValidatedFeeRecipient =
  | { ok: true; address: `0x${string}` }
  | { ok: false; detail: string };

export function validateFeeRecipient(raw: string | undefined | null): ValidatedFeeRecipient {
  if (raw == null) {
    return { ok: false, detail: "The fee recipient is not configured." };
  }
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, detail: "The fee recipient is not configured." };
  }
  if (!isAddress(trimmed)) {
    return { ok: false, detail: "The fee recipient must be a valid address." };
  }
  if (trimmed === "0x0000000000000000000000000000000000000000") {
    return { ok: false, detail: "The fee recipient cannot be the zero address." };
  }
  if ((FORBIDDEN_FEE_RECIPIENTS as readonly string[]).includes(trimmed)) {
    return { ok: false, detail: "The fee recipient cannot be a router or token address." };
  }
  return { ok: true, address: trimmed as `0x${string}` };
}

export function parseFeeBps(
  raw: string | undefined
): { ok: true; bps: number } | { ok: false; detail: string } {
  if (raw === undefined) {
    return { ok: true, bps: 100 };
  }
  const trimmed = raw.trim();
  if (/^(0|[1-9]\d*)$/.test(trimmed)) {
    const n = Number(trimmed);
    if (n >= 0 && n <= 100) {
      return { ok: true, bps: n };
    }
  }
  return {
    ok: false,
    detail: "The swap fee must be a whole number of basis points from 0 to 100.",
  };
}

export function resolveSwapConfig(input: {
  env: {
    swapQuotes: boolean;
    swapExecution: boolean;
    /** @deprecated ignored: gasless execution is permanently disabled. */
    gaslessSwaps?: boolean;
    equityBasis: boolean;
    swapMultihop?: boolean;
  };
  rows: Record<string, string> | "unavailable";
}): SwapConfig {
  const { env, rows } = input;
  const unavailable = rows === "unavailable";

  let execution: FeatureState;
  if (!env.swapExecution) {
    execution = {
      on: false,
      reason: "env-off",
      detail: "Swap trading is off in the environment: ENABLE_SWAP_TRADING.",
    };
  } else if (unavailable) {
    execution = {
      on: false,
      reason: "config-unavailable",
      detail: "Settings could not be read.",
    };
  } else if (rows[SWAP_CONFIG_KEYS.execution] !== "true") {
    execution = {
      on: false,
      reason: "admin-off",
      detail: "Turned off in admin settings.",
    };
  } else if (!env.swapQuotes) {
    execution = {
      on: false,
      reason: "requires-off",
      detail: "ENABLE_SWAP_TRADING is off in the environment.",
    };
  } else {
    execution = { on: true };
  }

  const resolveExecutionDependent = (
    envVarName: string,
    envOn: boolean,
    rowKey: string
  ): FeatureState => {
    if (!envOn) {
      return {
        on: false,
        reason: "env-off",
        detail: `${envVarName} is off in the environment.`,
      };
    }
    if (unavailable) {
      return {
        on: false,
        reason: "config-unavailable",
        detail: "Settings could not be read.",
      };
    }
    if (rows[rowKey] !== "true") {
      return {
        on: false,
        reason: "admin-off",
        detail: "Turned off in admin settings.",
      };
    }
    if (!execution.on) {
      return {
        on: false,
        reason: "requires-off",
        detail: "Swap execution must be enabled.",
      };
    }
    return { on: true };
  };

  // Product decision: the first execution surface sends direct wallet swaps to
  // the venue routers. A stored legacy row or a future environment value must
  // never revive a relayer path that does not exist.
  const gasless: FeatureState = {
    on: false,
    reason: "permanently-disabled",
    detail: "Gasless relays are permanently disabled. Swaps are sent directly from the connected wallet.",
  };

  const v4 = resolveExecutionDependent(
    "ENABLE_SWAP_TRADING",
    env.swapExecution,
    SWAP_CONFIG_KEYS.v4
  );

  const venueUniswap = resolveExecutionDependent(
    "ENABLE_SWAP_TRADING",
    env.swapExecution,
    SWAP_CONFIG_KEYS.venueUniswap
  );

  const venuePancake = resolveExecutionDependent(
    "ENABLE_SWAP_TRADING",
    env.swapExecution,
    SWAP_CONFIG_KEYS.venuePancake
  );

  const venueSushi = resolveExecutionDependent(
    "ENABLE_SWAP_TRADING",
    env.swapExecution,
    SWAP_CONFIG_KEYS.venueSushi
  );

  const multihop = resolveExecutionDependent(
    "ENABLE_SWAP_TRADING",
    env.swapMultihop ?? false,
    SWAP_CONFIG_KEYS.multihop
  );

  // 1 to 3 pool routes from the pool graph (lib/swap/graph-candidates.ts). Admin row absent = off.
  const routeGraph = resolveExecutionDependent("ENABLE_SWAP_TRADING", env.swapExecution, SWAP_CONFIG_KEYS.routeGraph);

  let equityBasis: FeatureState;
  if (!env.equityBasis) {
    equityBasis = {
      on: false,
      reason: "env-off",
      detail: "ENABLE_EQUITY_BASIS is off in the environment.",
    };
  } else if (unavailable) {
    equityBasis = {
      on: false,
      reason: "config-unavailable",
      detail: "Settings could not be read.",
    };
  } else if (rows[SWAP_CONFIG_KEYS.equityBasis] !== "true") {
    equityBasis = {
      on: false,
      reason: "admin-off",
      detail: "Turned off in admin settings.",
    };
  } else {
    equityBasis = { on: true };
  }

  let fee: SwapFeeConfig;
  if (unavailable) {
    fee = { kind: "unavailable" };
  } else {
    const rawRecipient = rows[SWAP_CONFIG_KEYS.feeRecipient];
    const recRes = validateFeeRecipient(rawRecipient);
    if (!recRes.ok) {
      fee = { kind: "unconfigured", detail: recRes.detail };
    } else {
      const rawBps = rows[SWAP_CONFIG_KEYS.feeBps];
      const bpsRes = parseFeeBps(rawBps);
      if (!bpsRes.ok) {
        fee = { kind: "unconfigured", detail: bpsRes.detail };
      } else {
        fee = { kind: "set", recipient: recRes.address, bps: bpsRes.bps };
      }
    }
  }

  return {
    features: {
      execution,
      gasless,
      equityBasis,
      v4,
      venueUniswap,
      venuePancake,
      venueSushi,
      multihop,
      routeGraph,
    },
    fee,
  };
}

/**
 * Whether a Trade entry point may be shown at all. Execution on is not enough: with no fee
 * recipient every plan answers "fee-unconfigured", so a button would lead to a dead page.
 * A config that could not be read is closed, never open (§4).
 */
export function isTradingOpen(cfg: SwapConfig): boolean {
  return cfg.features.execution.on && cfg.fee.kind === "set";
}

export interface SwapConfigDeps {
  readKeys?: (keys: string[]) => Promise<Record<string, string>>;
  isDatabaseConfigured?: () => boolean;
  env?: {
    swapQuotes: boolean;
    swapExecution: boolean;
    /** @deprecated ignored: gasless execution is permanently disabled. */
    gaslessSwaps?: boolean;
    equityBasis: boolean;
    swapMultihop?: boolean;
  };
}

let generation = 0;
let cachedConfig: { config: SwapConfig; expiresAt: number; generation: number } | null = null;
let inFlight: { generation: number; promise: Promise<SwapConfig> } | null = null;

const CACHE_TTL_MS = 15_000;
const ALL_KEYS = Object.values(SWAP_CONFIG_KEYS);

export function resetSwapConfigForTests(): void {
  generation++;
  cachedConfig = null;
  inFlight = null;
}

function resolveEnv(deps?: SwapConfigDeps) {
  return (
    deps?.env ?? {
      swapQuotes: flags.swapQuotes,
      swapExecution: flags.swapExecution,
      equityBasis: flags.equityBasis,
      swapMultihop: flags.swapTrading,
    }
  );
}

async function fetchSwapConfig(
  deps?: SwapConfigDeps
): Promise<{ config: SwapConfig; unavailable: boolean }> {
  const env = resolveEnv(deps);
  const isDbConfigured = deps?.isDatabaseConfigured ?? defaultIsDatabaseConfigured;
  let rows: Record<string, string> | "unavailable";

  if (!isDbConfigured()) {
    rows = "unavailable";
  } else {
    try {
      const readKeys = deps?.readKeys ?? readSiteConfigKeys;
      rows = await readKeys(ALL_KEYS);
    } catch (error) {
      await reportError({
        code: "RC_CONFIG_INVALID",
        message: "Failed to read swap site config.",
        error,
      }).catch(() => {});
      rows = "unavailable";
    }
  }

  const config = resolveSwapConfig({ env, rows });
  return { config, unavailable: rows === "unavailable" };
}

export async function readSwapConfig(deps?: SwapConfigDeps): Promise<SwapConfig> {
  const now = Date.now();
  if (cachedConfig && cachedConfig.generation === generation && now < cachedConfig.expiresAt) {
    return cachedConfig.config;
  }

  if (inFlight?.generation === generation) {
    return inFlight.promise;
  }

  const requestGeneration = ++generation;
  let promise!: Promise<SwapConfig>;
  promise = (async () => {
    try {
      const { config, unavailable } = await fetchSwapConfig(deps);
      if (!unavailable && requestGeneration === generation) {
        cachedConfig = { config, expiresAt: Date.now() + CACHE_TTL_MS, generation: requestGeneration };
      }
      return config;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  })();
  inFlight = { generation: requestGeneration, promise };
  return promise;
}

export async function refreshSwapConfig(deps?: SwapConfigDeps): Promise<SwapConfig> {
  const requestGeneration = ++generation;
  // A forced read owns the next cached value. Let unrelated ordinary reads start their own
  // single-flight generation; neither the forced read nor an older read may overwrite it.
  cachedConfig = null;
  const { config, unavailable } = await fetchSwapConfig(deps);
  if (!unavailable && requestGeneration === generation) {
    cachedConfig = { config, expiresAt: Date.now() + CACHE_TTL_MS, generation: requestGeneration };
  }
  return config;
}
