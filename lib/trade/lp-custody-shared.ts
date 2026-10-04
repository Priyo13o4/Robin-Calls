// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export const LP_CUSTODY_BUCKETS = ["wallet", "timelock", "permanent", "burned", "contractUnknown", "unknown", "unchecked"] as const;

export type LpCustodyBuckets = Record<typeof LP_CUSTODY_BUCKETS[number], number>;

export type LpCustodyLiveResult =
  | { status: "complete"; pool: string; protocol: "v2" | "v3" | "v4"; asOfBlock: number;
      buckets: LpCustodyBuckets; largestWalletPct: number; summary: string; poolSharePct: number | null }
  | { status: "not-checked" | "checking" | "incomplete" | "faulted"; pool: string; reason?: string; disabled?: true };

export const LP_CUSTODY_POLL_MS = 10_000;

type PlanPools = {
  pool?: string | null;
  poolId?: string | null;
  route?: { routeType: "direct" | "multihop"; hops: readonly { pool: string | null; tokenIn: string; tokenOut: string }[] };
};

export function custodyPoolForPlan(plan: PlanPools, token: string): string | null {
  throw new NotImplementedInPublicBuild("lib/trade/lp-custody-shared.ts#custodyPoolForPlan");
}