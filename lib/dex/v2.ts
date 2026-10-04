// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type {
  DexAdapter,
  PoolRef,
  PoolDiscovery,
  ConfigCheck,
  LpCustody,
} from "./types";

export const uniswapV2Adapter: DexAdapter = {
  protocol: "uniswap-v2",

  isConfigured(): boolean {
    throw new NotImplementedInPublicBuild("lib/dex/v2.ts#uniswapV2Adapter.isConfigured");
  },

  async validateConfig(): Promise<ConfigCheck> {
    throw new NotImplementedInPublicBuild("lib/dex/v2.ts#uniswapV2Adapter.validateConfig");
  },

  async discoverPools(_token: `0x${string}`): Promise<PoolDiscovery> {
    throw new NotImplementedInPublicBuild("lib/dex/v2.ts#uniswapV2Adapter.discoverPools");
  },

  async readLpCustody(
    _token: `0x${string}`,
    _pool: PoolRef,
    _deployer: string | null,
  ): Promise<LpCustody> {
    throw new NotImplementedInPublicBuild("lib/dex/v2.ts#uniswapV2Adapter.readLpCustody");
  },
};
