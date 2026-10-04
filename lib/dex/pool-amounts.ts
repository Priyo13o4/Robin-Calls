// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { batchRead } from "../rpc/multicall";
import type { V4Reserves } from "./v4-reserves";
import type { PoolRef } from "./types";

export const poolKeyOf = (p: PoolRef): string => {
  throw new NotImplementedInPublicBuild("lib/dex/pool-amounts.ts#poolKeyOf");
};

export interface PoolAmounts {
  amounts: Map<string, bigint | null>;
  v4Reserves: Record<string, V4Reserves | null>;
  faulted: number;
}

export const REVERT_REASK_MAX = 40;

export async function readPoolTokenAmounts(
  token: string,
  refs: readonly PoolRef[],
  read: typeof batchRead = undefined as any,
): Promise<PoolAmounts> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-amounts.ts#readPoolTokenAmounts");
}

export const MATERIAL_COVER_BPS = 9_900n;
export const MATERIAL_MAX = 25;
export const UNMEASURED_MAX = 10;

export interface MaterialSplit {
  material: PoolRef[];
  rest: PoolRef[];
  restAmount: bigint;
  unmeasuredRest: PoolRef[];
  measuredTotal: bigint;
}

export function selectMaterialPools(
  refs: readonly PoolRef[],
  amounts: ReadonlyMap<string, bigint | null>,
  pinned: ReadonlySet<string>,
): MaterialSplit {
  throw new NotImplementedInPublicBuild("lib/dex/pool-amounts.ts#selectMaterialPools");
}

export function v4Leftover(
  poolManagerBalance: bigint | null,
  refs: readonly PoolRef[],
  amounts: ReadonlyMap<string, bigint | null>,
): { leftover: bigint; unmeasured: number } | null {
  throw new NotImplementedInPublicBuild("lib/dex/pool-amounts.ts#v4Leftover");
}