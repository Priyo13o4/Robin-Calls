// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parseAbiItem, type PublicClient } from "viem";

import { readTokenMeta } from "../token-meta";

import type {
  ChainContracts,
  ChainLog,
  DecodeResult,
  IngestContext,
  LaunchDraft,
  LauncherInstance,
  LauncherModule,
  LifecycleDraft,
  LogSubscription,
  StateReading,
  TradeDraft,
} from "../types";

export const TOKEN_CREATED = {} as any;

export const BUY = {} as any;

export const SELL = {} as any;

export const CURVE_EVENTS_V1_LAUNCH_EVENTS = [TOKEN_CREATED] as const;

export const CURVE_EVENTS_V1_TRADE_EVENTS = [BUY, SELL] as const;

export function targetOf(pad: LauncherInstance | undefined, ethA: bigint, ethB: bigint): bigint {
  throw new NotImplementedInPublicBuild("lib/launches/modules/curve-events-v1.ts#targetOf");
}

export const curveEventsV1Module: LauncherModule = {} as any;