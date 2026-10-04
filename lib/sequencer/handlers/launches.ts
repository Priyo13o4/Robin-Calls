// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  decodeAbiParameters,
  decodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from "viem";

import type { SequencerTransaction } from "../types";

import type { LaunchDraft, LauncherFamily, VenueKind } from "@/lib/launches/types";

import { addresses, isAddressConfigured } from "@/lib/config/chain";

import { v2Factories, v3Factories, enabledDexes } from "@/lib/config/dex-registry";

export const PONS_V2_ROUTER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948" as const;

export const CASHCAT_FACTORY = "0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661" as const;

export const PONS_V2_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as const;

export const UNISWAP_V2_FACTORY = "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f" as const;

export const UNISWAP_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;

export const UNISWAP_V3_POSITION_MANAGER = "0x73991a25c818bf1f1128deaab1492d45638de0d3" as const;

export const PONS_LAUNCH_SELECTOR = "0xf85f8e41";

export const CASHCAT_LAUNCH_SELECTOR = "0xa80ac0c2";

export const V3_CREATE_POOL_SELECTOR = "0xa1688643";

export const V3_CREATE_POOL_CANONICAL_SELECTOR = "0xa1671295";

export const V3_CREATE_AND_INIT_SELECTOR = "0x13ead562";

export const V2_CREATE_PAIR_SELECTOR = "0xc9c65396";

export const NON_CREATOR_ADDRESSES = {} as any;

export const DEFAULT_QUOTE_ASSETS = [] as any;

export function sanitizeCreatorAddress(creator: string | null | undefined): string | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#sanitizeCreatorAddress");
}

export function isKnownV2Factory(target: string | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#isKnownV2Factory");
}

export function isKnownV3Factory(target: string | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#isKnownV3Factory");
}

export function isKnownV3PositionManager(target: string | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#isKnownV3PositionManager");
}

export interface DecodedLaunchCalldata {
  family: LauncherFamily;
  venueKind: VenueKind;
  name: string | null;
  symbol: string | null;
  metadataUri: string | null;
  quoteToken: string | null;
  devBuyQuote: bigint | null;
  creatorAddress: string | null;
  pairTokens?: { token0: string; token1: string };
  detail?: Record<string, unknown>;
}

export function extractLaunchCalldata(to: string | null, data: string): DecodedLaunchCalldata | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#extractLaunchCalldata");
}

export interface HandleLaunchOptions {
  blockNumber?: number;
  tokenAddress?: string;
  curveAddress?: string;
  creatorAddress?: string;
  quoteAssets?: readonly string[];
  targetQuote?: bigint | null;
  quoteDecimals?: number | null;
}

export const PONS_TOKEN_LAUNCHED_TOPIC = "" as any;

export interface ResolveReceiptDeps {
  fetch?: typeof fetch;
  rpcUrl?: string;
}

export async function resolveLaunchReceipt(txHash: string, rpcUrlOrDeps?: string | ResolveReceiptDeps, deps?: ResolveReceiptDeps): Promise<{
  tokenAddress: string;
  curveAddress?: string;
  creatorAddress?: string;
  deployerAddress?: string;
  blockNumber?: number;
} | null> {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#resolveLaunchReceipt");
}

export function handleLaunchTransaction(tx: SequencerTransaction | { hash?: string; to: string | null; data: string; from?: string | null }, options: HandleLaunchOptions = undefined as any): LaunchDraft | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#handleLaunchTransaction");
}

export async function evaluateLaunchTransaction(tx: SequencerTransaction, blockNumber?: number, _timestamp?: number, rpcUrl?: string, deps?: ResolveReceiptDeps): Promise<LaunchDraft | null> {
  throw new NotImplementedInPublicBuild("lib/sequencer/handlers/launches.ts#evaluateLaunchTransaction");
}