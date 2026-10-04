// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  parseAbi,
  parseAbiItem,
  pad,
  keccak256,
  encodeAbiParameters,
  type Abi,
  type PublicClient,
} from "viem";

import { v4ModifyLiquidityEvent, v4StateViewAbi, v4PoolManagerAbi, type V4PoolKey } from "@/lib/rpc/abis";

import { batchRead } from "@/lib/rpc/multicall";

import { primaryDeployment } from "@/lib/config/dex-registry";

import { readTokenMeta } from "@/lib/launches/token-meta";

import { getAmountsForLiquidity, calculateBondFillBps } from "@/lib/launches/modules/v4-math";

import type {
  LauncherModule,
  LauncherInstance,
  ChainContracts,
  LogSubscription,
  ChainLog,
  IngestContext,
  DecodeResult,
  LaunchDraft,
  LifecycleDraft,
  TradeDraft,
  KnownLaunch,
  StateResult,
} from "@/lib/launches/types";

export const airlockCreateEvent = {} as any;

export const hookLockEvent = {} as any;

export const longRouterLaunchMetadataEvent = {} as any;

export const hookGraduateEvent = {} as any;

export const airlockMigrateEvent = {} as any;

export const hookSwapEvent = {} as any;

export const dopplerGetStateAbi = {} as any;

export function poolIdOfKey(key: V4PoolKey): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/launches/modules/doppler-multicurve.ts#poolIdOfKey");
}

export interface DopplerPositionDetail {
  tickLower: number;
  tickUpper: number;
  liquidityDelta: string;
  salt: string;
}

export const DOPPLER_PROTOCOL_OWNERS: ReadonlySet<string> = {} as any;

export const dopplerMulticurveModule: LauncherModule = {} as any;