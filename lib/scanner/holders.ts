// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { erc20Abi } from "../rpc/abis";

import { batchRead, valueOrNull, isFaulted } from "../rpc/multicall";

import type { ExplorerHolder } from "../explorer/types";

export interface VerifiedHolders {
  items: ExplorerHolder[];
  /** Addresses the chain confirmed hold nothing, dropped from `items`. */
  phantoms: number;
  /** Addresses only one source knew about. */
  unionGain: number;
  /** False when any balance could not be read — the set is not fully verified. */
  complete: boolean;
  sources: string[];
}

export async function verifyHolders(token: `0x${string}`, lists: readonly { sourceId: string; items: ExplorerHolder[] | null }[]): Promise<VerifiedHolders | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/holders.ts#verifyHolders");
}