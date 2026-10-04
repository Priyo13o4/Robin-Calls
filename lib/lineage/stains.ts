// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { explorer, type ExplorerTx } from "../explorer/blockscout";

import { classifyAddress } from "../scanner/entity";

import { lineageConfig, MIN_FUNDING_WEI } from "../config/lineage";

import { cacheEdge, findFunder } from "./trace";

import type { LineageEdge } from "../types";

import {
  markHubRecord,
  isHubRecord,
  writeStainRecord,
  readActiveStainAddresses,
  retireStainsForAddress,
} from "../data/lineage";

interface Neighbor {
  address: string;
  edge: LineageEdge;
}

interface NeighborResult {
  neighbors: Neighbor[];
  complete: boolean;
  /**
   * The history was incomplete because the READ failed, not because the wallet
   * genuinely has more history than we page. Both are `complete: false`, but
   * only a real truncation justifies persisting a `wallet_hubs` row — a hub
   * record written from a transient explorer fault permanently blocks stain
   * propagation through an innocent wallet.
   */
  faulted?: boolean;
}

export interface PropagationResult {
  origin: string;
  stained: number;
  hubs: number;
  /**
   * L63: a node that WOULD have hub-blocked on fan-out alone, but co-occurred
   * with the origin (funded it, or was funded back by it) and was walked
   * through instead. Not persisted anywhere — this is the only record that an
   * override fired, so a job that logs `PropagationResult` is how it stays
   * auditable without a schema change.
   */
  hubsOverridden: number;
}

export async function propagateStains(args: { rugId: number; deployer: string }): Promise<PropagationResult> {
  throw new NotImplementedInPublicBuild("lib/lineage/stains.ts#propagateStains");
}

export interface RetirementResult {
  checked: number;
  retired: number;
  rowsRetired: number;
  /** Classification faulted — left stained, because absence is not innocence. */
  unreadable: number;
}

export async function retireContractStains(limit: any = undefined as any): Promise<RetirementResult> {
  throw new NotImplementedInPublicBuild("lib/lineage/stains.ts#retireContractStains");
}