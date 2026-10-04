// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeEventLog, encodeAbiParameters, keccak256, parseAbi, parseAbiItem, type Abi, type Address, type Hex, type PublicClient } from "viem";

import { batchRead, multicallAddress } from "@/lib/rpc/multicall";

import { v4InitializeEvent, v4PositionInfoAbi } from "@/lib/rpc/abis";

import { readTokenMeta } from "../token-meta";

import { KNOWN_BATCHERS } from "../../dex/pool-origin";

import { classifyAddresses, type EntityKind } from "@/lib/scanner/entity";

import type {
  ChainContracts,
  ChainLog,
  DecodeResult,
  IngestContext,
  KnownLaunch,
  LaunchDraft,
  LauncherInstance,
  LauncherModule,
  LifecycleDraft,
  LogSubscription,
  StateReading,
  StateResult,
  TradeDraft,
} from "../types";

export const TOKEN_LAUNCHED = {} as any;

export const POOL_GRADUATED = {} as any;

export const CREATOR_FEE_RECIPIENT_UPDATED = {} as any;

export const CURVE_BUY = {} as any;

export const CURVE_SELL = {} as any;

export const PONS_V2_LAUNCH_EVENTS = [
  TOKEN_LAUNCHED,
  POOL_GRADUATED,
  CREATOR_FEE_RECIPIENT_UPDATED,
] as const;

export const PONS_V2_TRADE_EVENTS = [CURVE_BUY, CURVE_SELL] as const;

export const PONS_V2_FACTORY = "" as any;

export const PONS_V4_POOL_MANAGER = "" as any;

export const PONS_POOL_PROOF_VERSION = "pons-v2-factory-position-initialize-v1";

export interface PonsGraduatedPool {
  poolRef: Hex;
  key: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };
}

export async function resolvePonsGraduatedPool(client: Pick<PublicClient, "readContract" | "getTransactionReceipt">, token: Address, graduationTxHash: Hex, positionId: bigint): Promise<PonsGraduatedPool | null> {
  throw new NotImplementedInPublicBuild("lib/launches/modules/pons-v2.ts#resolvePonsGraduatedPool");
}

interface FactoryRecord {
  token: string;
  curve: string;
  deployer: string;
  creatorFeeRecipient: string;
  pairToken: string;
  graduationThreshold: bigint;
  phase: number;
  exists: boolean;
}

export function progressBpsOf(balance: bigint, threshold: bigint): number | null {
  throw new NotImplementedInPublicBuild("lib/launches/modules/pons-v2.ts#progressBpsOf");
}

export function normaliseLogo(raw: string | undefined): string | null {
  throw new NotImplementedInPublicBuild("lib/launches/modules/pons-v2.ts#normaliseLogo");
}

export const ponsV2Module: LauncherModule = {} as any;