// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { DexAdapter, PoolRef, PoolDiscovery, ConfigCheck, LpCustody, SellSim } from "./types";
import type { V4PoolKey } from "./v4-reserves";

export function poolIdOf(key: V4PoolKey): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#poolIdOf");
}

export const uniswapV4Adapter: DexAdapter = {
  protocol: "uniswap-v4",

  isConfigured(): boolean {
    throw new NotImplementedInPublicBuild("lib/dex/v4.ts#uniswapV4Adapter.isConfigured");
  },

  async validateConfig(): Promise<ConfigCheck> {
    throw new NotImplementedInPublicBuild("lib/dex/v4.ts#uniswapV4Adapter.validateConfig");
  },

  async discoverPools(token: `0x${string}`): Promise<PoolDiscovery> {
    throw new NotImplementedInPublicBuild("lib/dex/v4.ts#uniswapV4Adapter.discoverPools");
  },

  async readLpCustody(
    _token: `0x${string}`,
    _pool: PoolRef,
    _deployer: string | null,
  ): Promise<LpCustody> {
    throw new NotImplementedInPublicBuild("lib/dex/v4.ts#uniswapV4Adapter.readLpCustody");
  },

  async simulateSell(token: `0x${string}`, pool: PoolRef): Promise<SellSim> {
    throw new NotImplementedInPublicBuild("lib/dex/v4.ts#uniswapV4Adapter.simulateSell");
  },
};

export const STORE_DISCOVERY_MAX_POOLS = 5_000;
export const STORE_DISCOVERY_MAX_LAG_BLOCKS = 200_000;

export async function discoverViaStore(token: `0x${string}`): Promise<PoolDiscovery | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#discoverViaStore");
}

export async function discoverViaInitialize(
  token: `0x${string}`,
  opts: { refill?: boolean } = {},
): Promise<PoolDiscovery> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#discoverViaInitialize");
}

export interface V4CoverageInput {
  poolManagerBalance: bigint | null;
  discoveredPoolIds: readonly string[];
  oraclePoolId: string | null;
}

export interface V4CoverageSignals {
  contradicted: boolean;
  oracleMissing: boolean;
}

export function assessV4DiscoveryCoverage(input: V4CoverageInput): V4CoverageSignals {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#assessV4DiscoveryCoverage");
}

export async function censusInitializePoolsViaRpc(
  token: `0x${string}`,
): Promise<PoolRef[] | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#censusInitializePoolsViaRpc");
}

export async function refreshV4DiscoveryIndex(token: `0x${string}`): Promise<PoolDiscovery | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#refreshV4DiscoveryIndex");
}

export async function readV4PoolRefById(
  token: `0x${string}`,
  poolId: string,
): Promise<PoolRef | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#readV4PoolRefById");
}

export function mergeDiscoveredPools(existing: readonly PoolRef[], added: readonly PoolRef[]): PoolRef[] {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#mergeDiscoveredPools");
}

export async function readV4PoolManagerBalance(token: `0x${string}`): Promise<bigint | null> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#readV4PoolManagerBalance");
}

export async function readV4LiquidityBatch(
  poolIds: readonly `0x${string}`[],
): Promise<(bigint | null)[]> {
  throw new NotImplementedInPublicBuild("lib/dex/v4.ts#readV4LiquidityBatch");
}
