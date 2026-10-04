// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { PublicClient } from "viem";

import { readBlockAnchors, writeBlockAnchor } from "@/lib/data/launches";

import { interpolateBlockTime, type BlockAnchor } from "./block-times";

export interface BlockTimeResolverStore {
  read: (from: number, to: number) => Promise<BlockAnchor[]>;
  write: (block: number, iso: string) => Promise<void>;
}

export async function createBlockTimeResolver(client: PublicClient, from: number, to: number, store: BlockTimeResolverStore = undefined as any): Promise<{ milliseconds: (block: number) => number | null; seconds: (block: number) => Promise<number> }> {
  throw new NotImplementedInPublicBuild("lib/launches/time-resolver.ts#createBlockTimeResolver");
}

export function createWindowTimestampResolver(client: PublicClient, from: number, to: number, store: BlockTimeResolverStore = undefined as any): (block: number, exactSeconds?: number) => Promise<number> {
  throw new NotImplementedInPublicBuild("lib/launches/time-resolver.ts#createWindowTimestampResolver");
}