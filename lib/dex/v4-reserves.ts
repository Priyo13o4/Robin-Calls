// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { BatchCall, BatchResult } from "../rpc/multicall";

export interface V4PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

export interface V4Reserves {
  amount0: string;
  amount1: string;
  customAccounting: boolean;
}

export function lensCannotJudge(_hooks: string): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/v4-reserves.ts#lensCannotJudge");
}

export function reservesLensCall(_key: V4PoolKey): BatchCall | null {
  throw new NotImplementedInPublicBuild("lib/dex/v4-reserves.ts#reservesLensCall");
}

export function reservesFromResult(_result: BatchResult | undefined): V4Reserves | null {
  throw new NotImplementedInPublicBuild("lib/dex/v4-reserves.ts#reservesFromResult");
}

export function isDrained(_r: V4Reserves | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/v4-reserves.ts#isDrained");
}

export async function readV4Reserves(_keys: readonly V4PoolKey[]): Promise<(V4Reserves | null)[]> {
  throw new NotImplementedInPublicBuild("lib/dex/v4-reserves.ts#readV4Reserves");
}
