// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parseAbiItem } from "viem";

import type {
  LauncherModule,
  LauncherInstance,
  ChainContracts,
  LogSubscription,
  ChainLog,
  IngestContext,
  DecodeResult,
  V4PoolDraft,
} from "@/lib/launches/types";

export const DEFAULT_V4_POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

export const v4InitializeEvent = {} as any;

export const v4PoolsModule: LauncherModule = {} as any;