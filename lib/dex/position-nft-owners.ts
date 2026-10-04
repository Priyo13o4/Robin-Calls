// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import { toEventSelector } from "viem";
import { V3_POSITION_MANAGERS, V4_POSITION_MANAGER } from "../trade/lp-positions";
import type { RawLpLog } from "../trade/lp-events";
import type { BatchResult } from "../rpc/multicall";
import type {
  appendNftOwnerStep,
  readNftOwnerCursor,
  readNftOwners,
  resetNftOwners,
  seedNftOwners,
  NftCursorRead,
  NftTransfer,
} from "../data/position-nft-owners";

export const NFT_TRANSFER = toEventSelector("Transfer(address,address,uint256)");
export const POSITION_NFT_MANAGERS: readonly string[] = [...V3_POSITION_MANAGERS, V4_POSITION_MANAGER];

export function decodeNftTransfers(logs: readonly RawLpLog[]): NftTransfer[] {
  throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#decodeNftTransfers");
}

export function managerTransferLogs(
  rpc: { request: (args: never) => Promise<unknown> },
  managers: readonly string[],
  from: number,
  to: number,
  stride?: number,
): Promise<RawLpLog[]> {
  throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#managerTransferLogs");
}

export type OwnerResult = { status: "success"; owner: string } | { status: "reverted" } | { status: "faulted"; deadline: boolean };

export interface NftOwnerDeps {
  head: () => Promise<number>;
  blockHash: (block: number) => Promise<string>;
  getLogs: (managers: readonly string[], from: number, to: number) => Promise<RawLpLog[]>;
  readCursor: (manager: string) => Promise<NftCursorRead>;
  readOwners: typeof readNftOwners;
  reset: typeof resetNftOwners;
  seed: typeof seedNftOwners;
  append: typeof appendNftOwnerStep;
  ownerOf: (manager: string, tokenIds: readonly bigint[], opts: { blockNumber?: bigint; forceIndividual?: boolean }) => Promise<BatchResult<unknown>[]>;
  dbConfigured: () => boolean;
}

export const defaultNftOwnerDeps: NftOwnerDeps = {
  head: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.head"); },
  blockHash: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.blockHash"); },
  getLogs: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.getLogs"); },
  readCursor: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.readCursor"); },
  readOwners: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.readOwners"); },
  reset: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.reset"); },
  seed: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.seed"); },
  append: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.append"); },
  ownerOf: () => { throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#defaultNftOwnerDeps.ownerOf"); },
  dbConfigured: () => false,
};

export async function syncNftOwners(managers: readonly string[], safeHead: number, overrides: Partial<NftOwnerDeps> = {}): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#syncNftOwners");
}

export async function appendNftOwnersForStep(from: number, to: number, toHash: string, overrides: Partial<NftOwnerDeps> = {}): Promise<{ advanced: number; updated: number }> {
  throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#appendNftOwnersForStep");
}

export async function resolveNftOwners(
  manager: string,
  tokenIds: readonly bigint[],
  opts: { weights?: readonly bigint[]; retryLimit?: number; deps?: Partial<NftOwnerDeps>; atBlock?: number } = {},
): Promise<{ results: OwnerResult[]; fromStore: number; retried: number; shed: number }> {
  throw new NotImplementedInPublicBuild("lib/dex/position-nft-owners.ts#resolveNftOwners");
}
