// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { readDeployerFamilyTree } from "@/lib/data/wanted";

import { getLiveLpCustody, type LpCustodyLiveResult } from "./lp-custody-live";

export function currentWalletShareForSavedPool(tokenAddress: string, savedPoolAddress: string | null, result: LpCustodyLiveResult | null): { pct: number; asOfBlock: number; pool: string } | null {
  throw new NotImplementedInPublicBuild("lib/trade/wanted-custody.ts#currentWalletShareForSavedPool");
}

export async function readFamilyTreeWithCurrentCustody(deployerAddress: string): Promise<Awaited<ReturnType<typeof readDeployerFamilyTree>>> {
  throw new NotImplementedInPublicBuild("lib/trade/wanted-custody.ts#readFamilyTreeWithCurrentCustody");
}