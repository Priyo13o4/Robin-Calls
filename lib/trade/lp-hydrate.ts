// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { encodePacked, keccak256, parseEventLogs, type Abi } from "viem";

import { indexPoolPositions } from "@/lib/dex/v4-custody";

import { indexPoolMints } from "@/lib/dex/v3-custody";

import { V3_POSITION_MANAGERS, V4_POSITION_MANAGER } from "@/lib/trade/lp-positions";

import { getPoolIdentity, replaceHydratedPool, type HydratedPosition } from "@/lib/data/lp-positions";

import { addresses } from "@/lib/config/chain";

import { npmAbi, npmIncreaseLiquidityEvent, v3MintEvent, v3PoolStateAbi, v4ModifyLiquidityEvent } from "@/lib/rpc/abis";

import { rpc } from "@/lib/rpc/client";

import { batchRead } from "@/lib/rpc/multicall";

import { walkLogRange } from "@/lib/rpc/range-walk";

import { mapWithConcurrency } from "@/lib/rpc/fanout";

import { flags } from "@/lib/config/flags";

export type TrackResult =
  | { status: "tracked"; through: number; count: number }
  | { status: "not-tracked"; reason: string };

interface MintCandidate {
  owner: `0x${string}`;
  tickLower: number;
  tickUpper: number;
  txHash: `0x${string}`;
}

export function trackingRefused(pool: string): string | null {
  throw new NotImplementedInPublicBuild("lib/trade/lp-hydrate.ts#trackingRefused");
}

export function trackPool(pool: string, protocol: "v3" | "v4", reason: "visit" | "graph" | "scan"): Promise<TrackResult> {
  throw new NotImplementedInPublicBuild("lib/trade/lp-hydrate.ts#trackPool");
}