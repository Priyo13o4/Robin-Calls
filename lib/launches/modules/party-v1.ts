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
  LogSubscription,
} from "../types";

export const TOKEN_LAUNCHED = {} as any;

export const PARTY_V1_LAUNCH_EVENTS = [TOKEN_LAUNCHED] as const;

export const partyV1Module: LauncherModule = {} as any;