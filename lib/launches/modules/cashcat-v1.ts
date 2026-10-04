// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parseAbi, parseAbiItem, type Abi, type Address, type PublicClient } from "viem";

import { batchRead } from "@/lib/rpc/multicall";

import { readTokenMeta } from "../token-meta";

import { normaliseLogo } from "./pons-v2";

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

export const TOKEN_LAUNCHED_VNEXT = {} as any;

export const CASHCAT_V1_LAUNCH_EVENTS = [TOKEN_LAUNCHED, TOKEN_LAUNCHED_VNEXT] as const;

interface CatLaunchAccumulator {
  token: string;
  creator: string | null;
  poolId: string | null;
  configId: bigint | null;
  firstBuyIn: bigint | null;
  hook: string | null;
  feeRecipient: string | null;
  quote: string | null;
  moduleSetId: bigint | null;
  splitter: string | null;
  blockNumber: number;
  txHash: string;
  emitter: string;
}

export const cashcatV1Module: LauncherModule = {} as any;