// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { TokenMeta } from "../types";

export function normalizeAddress(input: string): `0x${string}` | null {
  throw new NotImplementedInPublicBuild("lib/scanner/metadata.ts#normalizeAddress");
}

export async function fetchTokenMeta(
  address: `0x${string}`
): Promise<TokenMeta> {
  throw new NotImplementedInPublicBuild("lib/scanner/metadata.ts#fetchTokenMeta");
}

export async function isContract(address: `0x${string}`): Promise<boolean> {
  throw new NotImplementedInPublicBuild("lib/scanner/metadata.ts#isContract");
}

export interface V3PoolIdentity {
  token0: `0x${string}`;
  token1: `0x${string}`;
  factory: `0x${string}`;
  fee: number;
}

export interface V2PairIdentity {
  token0: `0x${string}`;
  token1: `0x${string}`;
  factory: `0x${string}`;
}

export async function detectV2Pair(
  address: `0x${string}`
): Promise<V2PairIdentity | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/metadata.ts#detectV2Pair");
}

export async function detectV3Pool(
  address: `0x${string}`
): Promise<V3PoolIdentity | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/metadata.ts#detectV3Pool");
}
