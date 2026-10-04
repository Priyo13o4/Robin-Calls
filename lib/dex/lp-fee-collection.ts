// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { rpc } from "../rpc/client";

export interface FeeCollectionRow {
  txHash: `0x${string}`;
  recipient: `0x${string}`;
  amount0: string;
  amount1: string;
}

export type FeeCollectionStatus = "resolved" | "unreadable";

export interface FeeCollectionSummary {
  status: FeeCollectionStatus;
  collectionCount: number;
  totalAmount0: string;
  totalAmount1: string;
  complete: boolean;
}

export function summarizeFeeCollections(
  rows: readonly FeeCollectionRow[] | null,
  complete: boolean,
): FeeCollectionSummary {
  throw new NotImplementedInPublicBuild("lib/dex/lp-fee-collection.ts#summarizeFeeCollections");
}

export async function readFeeCollectionSummary(
  client: ReturnType<typeof rpc>,
  npm: string,
  nftId: bigint,
): Promise<FeeCollectionSummary> {
  throw new NotImplementedInPublicBuild("lib/dex/lp-fee-collection.ts#readFeeCollectionSummary");
}
