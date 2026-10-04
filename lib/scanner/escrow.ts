// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Abi } from "viem";

import { batchRead } from "../rpc/multicall";

export interface EscrowLookThrough {
  /** Beneficial owner (lowercased) → amount held on their behalf. */
  owners: Map<string, bigint>;
  /** Share of the wrapper's ENUMERATED locked total that reached a named owner. */
  attributedPct: number;
  /**
   * Every non-zero position was read AND attributed. False makes every number
   * here a FLOOR: it may escalate a finding and must never soften one.
   */
  complete: boolean;
  positionsMinted: number;
  positionsWithBalance: number;
  ownersResolved: number;
  /** Total of the positions we actually read, attributed or not. */
  lockedTotal: bigint;
  stopReason: "complete" | "position-cap" | "owner-cap" | "unreadable";
}

export interface EscrowDeps {
  read: typeof batchRead;
}

export async function wrapsToken(holder: string, token: string, deps: EscrowDeps = undefined as any): Promise<boolean | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/escrow.ts#wrapsToken");
}

export async function lookThroughEscrow(wrapper: string, deps: EscrowDeps = undefined as any): Promise<EscrowLookThrough | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/escrow.ts#lookThroughEscrow");
}