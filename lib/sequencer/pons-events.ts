// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { LaunchDraft } from "@/lib/launches/types";

import { PONS_V2_FACTORY } from "@/lib/launches/modules/pons-v2";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export interface PonsQuote {
  symbol: string;
  decimals: number;
  assetClass?: string;
}

export interface PonsPendingLaunchEvent {
  type: "newToken";
  status: "pending";
  token: null;
  txHash: `0x${string}`;
  name: string | null;
  symbol: string | null;
  imageUri: string | null;
  description: string | null;
  socials: string[] | null;
  creator: `0x${string}` | null;
  deployer: `0x${string}` | null;
  pairToken: `0x${string}` | null;
  quote: PonsQuote;
  devBuyWei: bigint | null;
  salt?: `0x${string}` | null;
  entry?: `0x${string}` | null;
  block?: number | null;
  blockTimestamp?: number | null;
}

export interface PonsConfirmedLaunchEvent {
  type: "newToken";
  status: "confirmed";
  token: `0x${string}`;
  /** Bonding curve address (not V4 pool ID) */
  pool: `0x${string}`;
  pairToken: `0x${string}` | null;
  quote: PonsQuote;
  graduationThreshold: bigint | null;
  block: number;
  blockTimestamp: number;
  txHash: `0x${string}`;
  creator: `0x${string}` | null;
  deployer: `0x${string}` | null;
  name: string | null;
  symbol: string | null;
  imageUri: string | null;
  description: string | null;
  socials: string[] | null;
  devBuyWei: bigint | null;
  initialBuyWei: bigint | null;
  salt?: `0x${string}` | null;
  entry?: `0x${string}` | null;
}

export interface PonsConfirmedGraduationEvent {
  type: "graduation";
  status: "confirmed";
  token: `0x${string}`;
  block: number;
  txHash: `0x${string}`;
}

export interface PonsTokenMetaEvent {
  type: "tokenMeta";
  token: `0x${string}`;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply?: bigint | null;
}

export type PonsEvent =
  | PonsPendingLaunchEvent
  | PonsConfirmedLaunchEvent
  | PonsConfirmedGraduationEvent
  | PonsTokenMetaEvent;

export function isAddress(val: unknown): val is `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#isAddress");
}

export function isHexHash(val: unknown): val is `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#isHexHash");
}

export function isPonsConfirmedLaunch(event: PonsEvent): event is PonsConfirmedLaunchEvent {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#isPonsConfirmedLaunch");
}

export function isPonsPendingLaunch(event: PonsEvent): event is PonsPendingLaunchEvent {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#isPonsPendingLaunch");
}

export function isPonsConfirmedGraduation(event: PonsEvent): event is PonsConfirmedGraduationEvent {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#isPonsConfirmedGraduation");
}

export function isPonsTokenMeta(event: PonsEvent): event is PonsTokenMetaEvent {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#isPonsTokenMeta");
}

export function normalizePonsEvent(input: unknown): PonsEvent | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#normalizePonsEvent");
}

export function ponsConfirmedToLaunchDraft(event: PonsConfirmedLaunchEvent, meta?: PonsTokenMetaEvent | null): LaunchDraft {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#ponsConfirmedToLaunchDraft");
}

export function ponsEventToLaunchDraft(event: PonsEvent, meta?: PonsTokenMetaEvent | null): LaunchDraft | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#ponsEventToLaunchDraft");
}

export function applyTokenMetaToLaunchDraft(draft: LaunchDraft, meta: PonsTokenMetaEvent): LaunchDraft {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#applyTokenMetaToLaunchDraft");
}

export function mergePonsLaunchEvents(pending: PonsPendingLaunchEvent | null | undefined, confirmed: PonsConfirmedLaunchEvent): PonsConfirmedLaunchEvent {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-events.ts#mergePonsLaunchEvents");
}