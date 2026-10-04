// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  parseAbi,
  parseAbiItem,
  type Abi,
  type PublicClient,
} from "viem";

import { batchRead } from "@/lib/rpc/multicall";

import { readTokenMeta } from "@/lib/launches/token-meta";

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

export const DEFAULT_PAIR_PROXY = "0x8660a7f019c7943b0b0a91b8e39aff3b6db6ae62";

export const DEFAULT_PAIR_HOOK = "0x438b86c71840c3b4df3f839aed6bb889e2d780c0";

export const PAIR_POOL_HOOKS: ReadonlySet<string> = {} as any;

export const pairMultiPairLaunchCreatedEvent = {} as any;

export const pairLaunchV2CreatedEvent = {} as any;

export const pairPoolCreatedEvent = {} as any;

export const pairInitialDeveloperBuyEvent = {} as any;

export const pairLaunchGraduatedEvent = {} as any;

export const pairGraduationStatusAbi = {} as any;

interface PairPoolRecord {
  poolId: string;
  quoteToken: string;
  positionId: string;
  weightBps: number;
  projectTokenAmount: string;
  tickLower: number;
  tickUpper: number;
  initialSqrtPriceX96: string;
  quoteUsdAtLaunchE8: string;
}

interface PendingPairLaunch {
  projectToken: string;
  creator: string | null;
  pairCount: number | null;
  totalSupply: bigint | null;
  graduationTargetUsdE8: bigint | null;
  metadataURI: string | null;
  vault: string | null;
  pools: PairPoolRecord[];
  devBuyQuote: bigint | null;
  launchTxHash: string | null;
  createdBlock: number;
}

export const pairV5Module: LauncherModule = {} as any;