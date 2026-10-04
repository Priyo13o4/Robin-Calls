// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { Abi } from "viem";
import { parseAbiItem } from "viem";
import type { ChainReader } from "../rpc/client";
import type {
  DexAdapter,
  PoolRef,
  PoolDiscovery,
  ConfigCheck,
  LpCustody,
  OwnerLookThrough,
} from "./types";

export const CL_TICK_SPACINGS_FALLBACK = [1, 10, 50, 60, 100, 200, 2000] as const;

export const clPoolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tickSpacing", stateMutability: "view", inputs: [], outputs: [{ type: "int24" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "stakedLiquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "gauge", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "nft", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const satisfies Abi;

export const clFactoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "int24" }],
    outputs: [{ type: "address" }],
  },
  { type: "function", name: "poolImplementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "tickSpacings", stateMutability: "view", inputs: [], outputs: [{ type: "int24[]" }] },
] as const satisfies Abi;

export const clVoterAbi = [
  { type: "function", name: "isGauge", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "poolForGauge", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
] as const satisfies Abi;

export const clGaugeDepositEvent = parseAbiItem(
  "event Deposit(address indexed user, uint256 indexed tokenId, uint128 indexed liquidityToStake)",
);

export const CL_GAUGE_DEPOSIT_TOPIC =
  "0x1c8ab8c7f45390d58f58f1d655213a82cca5d12179761a87c16f098813b8f211" as const;

export interface ClPoolShape {
  nft: string | null;
  gauge: string | null;
  liquidity: bigint | null;
  stakedLiquidity: bigint | null;
  stakedShare: number | null;
}

export async function readClPoolShape(pool: `0x${string}`): Promise<ClPoolShape> {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#readClPoolShape");
}

export function _resetClSpacingsCache(): void {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#_resetClSpacingsCache");
}

export async function readClTickSpacings(
  client: ChainReader = undefined as any,
  factoryAddress?: `0x${string}`,
): Promise<readonly number[]> {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#readClTickSpacings");
}

export async function verifyClPoolClone(
  client: ChainReader,
  pool: `0x${string}`,
): Promise<{ ok: boolean; implementation?: `0x${string}`; reason?: string }> {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#verifyClPoolClone");
}

export function gaugeLookThrough(
  gauge: `0x${string}`,
  voter?: `0x${string}`,
): OwnerLookThrough {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#gaugeLookThrough");
}

export async function discoverClPools(
  token: `0x${string}`,
  quoteAssets?: readonly `0x${string}`[],
): Promise<PoolDiscovery> {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#discoverClPools");
}

export interface ClProbeTarget {
  factory: `0x${string}`;
  quoteAsset: `0x${string}`;
  dexId: string;
  positionManager: `0x${string}` | null;
}

export async function discoverClPoolsBatched(
  token: `0x${string}`,
  targets: readonly ClProbeTarget[],
): Promise<{ pools: PoolRef[]; complete: boolean }[]> {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#discoverClPoolsBatched");
}

export async function readClLpCustody(pool: PoolRef): Promise<LpCustody> {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#readClLpCustody");
}

export const slipstreamAdapter: DexAdapter = {
  protocol: "slipstream-cl",

  isConfigured(): boolean {
    throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#slipstreamAdapter.isConfigured");
  },

  async validateConfig(): Promise<ConfigCheck> {
    throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#slipstreamAdapter.validateConfig");
  },

  async discoverPools(token: `0x${string}`): Promise<PoolDiscovery> {
    throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#slipstreamAdapter.discoverPools");
  },

  async readLpCustody(
    _token: `0x${string}`,
    _pool: PoolRef,
    _deployer: string | null,
  ): Promise<LpCustody> {
    throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#slipstreamAdapter.readLpCustody");
  },
};

export function clImplementationCodeHash(code: `0x${string}`): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/dex/slipstream.ts#clImplementationCodeHash");
}
