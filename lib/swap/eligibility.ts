// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { encodeAbiParameters, keccak256, type PublicClient } from "viem";

import { isDatabaseConfigured } from "@/lib/db/client";

import { rpc } from "@/lib/rpc/client";

import { resolvePonsGraduatedPool } from "@/lib/launches/modules/pons-v2";

import { readTokenProvenanceRecord, type TokenProvenanceRecord } from "@/lib/data/trade-eligibility";

import { DOPPLER_HOOK_INITIALIZERS } from "@/lib/dex/doppler-lock";

import { PAIR_POOL_HOOKS } from "@/lib/launches/modules/pair-v5";

import { WETH } from "./venues";

import { USDG } from "./plan-context";

import { NATIVE, type Address } from "./types";

import { factCache } from "./fact-cache";

import { runSharedRpcWork } from "../observability/context";

type V4Key = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

export type LaunchKey = { key: V4Key; poolId: `0x${string}` };

export type EligibilityProvenance =
  | { kind: "base-token"; symbol: string }
  | { kind: "canonical-rwa" }
  | { kind: "direct-dex"; family: string }
  | { kind: "graduated-launchpad"; family: string; launchKey?: LaunchKey }
  /** A curve that IS a V4 pool (Doppler, pair.fun): it trades from launch. */
  | { kind: "hook-curve-pool"; family: string; launchKey?: LaunchKey }
  /** Never scanned. Trading is allowed but the UI warns. */
  | { kind: "unscanned" };

export type TradeEligibility =
  | { status: "eligible"; token: Address; provenance: EligibilityProvenance }
  | { status: "ineligible"; token: Address; code: "ACTIVE_BONDING_CURVE"; reason: string }
  | { status: "unavailable"; token: Address; code: "DB_UNAVAILABLE"; reason: string };

export const CANONICAL_BASE_TOKENS: ReadonlySet<Address> = {} as any;

export function isCanonicalBaseToken(address: string): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/eligibility.ts#isCanonicalBaseToken");
}

export interface EligibilityDeps {
  readProvenance?: typeof readTokenProvenanceRecord;
  isDatabaseConfigured?: () => boolean;
  client?: Pick<PublicClient, "call" | "readContract" | "getTransactionReceipt">;
}

export function poolIdOfKey(key: { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string }): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/swap/eligibility.ts#poolIdOfKey");
}

export const _resetPonsProofCacheForTests = (): any => {
  throw new NotImplementedInPublicBuild("lib/swap/eligibility.ts#_resetPonsProofCacheForTests");
};

export async function checkTradeEligibility(subjectToken: Address, deps: EligibilityDeps = undefined as any): Promise<TradeEligibility> {
  throw new NotImplementedInPublicBuild("lib/swap/eligibility.ts#checkTradeEligibility");
}