// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { DexAdapter, PoolRef, PoolDiscovery, ConfigCheck, LpCustody, SellSim } from "./types";
import type { GasSensitivity } from "./sim-env";

export interface DexConfigValidation {
  ok: boolean;
  reason: string;
  contracts: Record<string, string>;
  transient?: boolean;
  unconfigured?: boolean;
}

export function validateDexConfig(): Promise<DexConfigValidation> {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#validateDexConfig");
}

export interface DiscoveredPool {
  feeTier: number;
  pool: `0x${string}`;
  quoteAsset: `0x${string}`;
}

export interface V3Discovery {
  pools: DiscoveredPool[];
  tiers: number[];
  transientFault?: boolean;
  complete: boolean;
}

export async function discoverV3Pools(token: `0x${string}`): Promise<V3Discovery> {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#discoverV3Pools");
}

export interface SellResult {
  ok: boolean;
  detail: string;
  transient?: boolean;
  insufficientFunds?: boolean;
  gasSensitivity?: GasSensitivity;
}

export interface V3SimDeployment {
  swapRouter: `0x${string}`;
  weth: `0x${string}`;
  exactInputHasDeadline?: boolean;
}

export async function routerHasDeadline(router: `0x${string}`): Promise<boolean | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#routerHasDeadline");
}

export function resetRouterFlavorCacheForTests(): void {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#resetRouterFlavorCacheForTests");
}

export async function quoterPass(
  token: `0x${string}`,
  tiers: number[]
): Promise<{
  ok: boolean;
  poolFound: boolean;
  detail: string;
  buyOut?: string;
  roundTripRatio?: number;
  fee?: number;
} | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#quoterPass");
}

export interface DeepPass {
  ok: boolean;
  disagreement: boolean;
  detail: string;
  walletA: SellResult;
  walletB: SellResult;
  inconclusive?: boolean;
  transient?: boolean;
  simGasSensitivity?: GasSensitivity;
}

export async function deepPass(
  token: `0x${string}`,
  wallets: [`0x${string}`, `0x${string}`],
  decimals: number | null | undefined,
  tiers: number[],
  deployment?: V3SimDeployment
): Promise<DeepPass | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#deepPass");
}

export const uniswapV3Adapter: DexAdapter = {
  protocol: "uniswap-v3",

  isConfigured(): boolean {
    throw new NotImplementedInPublicBuild("lib/dex/v3.ts#uniswapV3Adapter.isConfigured");
  },

  async validateConfig(): Promise<ConfigCheck> {
    throw new NotImplementedInPublicBuild("lib/dex/v3.ts#uniswapV3Adapter.validateConfig");
  },

  async discoverPools(token: `0x${string}`): Promise<PoolDiscovery> {
    throw new NotImplementedInPublicBuild("lib/dex/v3.ts#uniswapV3Adapter.discoverPools");
  },

  async readLpCustody(
    _token: `0x${string}`,
    _pool: PoolRef,
    _deployer: string | null,
  ): Promise<LpCustody> {
    throw new NotImplementedInPublicBuild("lib/dex/v3.ts#uniswapV3Adapter.readLpCustody");
  },

  async simulateSell(token: `0x${string}`, pool: PoolRef): Promise<SellSim> {
    throw new NotImplementedInPublicBuild("lib/dex/v3.ts#uniswapV3Adapter.simulateSell");
  },
};

export async function simulateSellV3(
  token: `0x${string}`,
  pool: PoolRef,
  deployment?: V3SimDeployment,
): Promise<SellSim> {
  throw new NotImplementedInPublicBuild("lib/dex/v3.ts#simulateSellV3");
}
