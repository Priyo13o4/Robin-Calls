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

export const BOUGHT = {} as any;

export const SOLD = {} as any;

export const PROGRESS = {} as any;

export const FLAP_V1_LAUNCH_EVENTS = [TOKEN_CREATED, PROGRESS] as const;

export const FLAP_V1_TRADE_EVENTS = [BOUGHT, SOLD] as const;

export const flapV1Module: LauncherModule = {} as any;