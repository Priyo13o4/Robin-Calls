// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { isAddress, type Address, type Hex } from "viem";

import {
  hasEvmDispatcherSelector,
  QUICK_CONTROL_LEGACY_SELECTORS,
  QUICK_CONTROL_SELECTORS,
} from "../security/selector-core";

import { CANONICAL_STOCK_TOKENS } from "./canonical-stocks";

import { BASE_SWAP_TOKENS, COMMON_BASES_BY_CHAIN } from "./types";

import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";

import { EIP1967_SLOTS } from "@/lib/rpc/abis";

import { matchClone1167 } from "@/lib/rpc/clone";

import { factCache } from "@/lib/swap/fact-cache";

export type PreflightKind = "ok" | "invalid-address" | "no-code" | "unavailable";

export type KnownControl = keyof typeof QUICK_CONTROL_SELECTORS;

export type KnownOrUnknown<T> = T | "unknown";

export type QuickCheckStatus = "clear" | "controls" | "paused" | "unavailable";

export type QuickCheckTone = "warn" | "amber" | "neutral";

export interface QuickCheckRpc {
  getCode(args: { address: Address }): Promise<Hex | undefined>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getStorageAt(args: { address: Address; slot: Hex }): Promise<Hex | undefined>;
}

export interface TradeQuickCheckResult {
  kind: PreflightKind;
  status: QuickCheckStatus;
  address: Address | null;
  canonicalRwa: boolean;
  exempt: boolean;
  controls: readonly KnownControl[];
  paused: KnownOrUnknown<boolean> | null;
  proxy: {
    implementation: KnownOrUnknown<Address | null>;
    uncertain?: boolean;
  };
  rpcReadsAttempted: number;
  statusText: string;
  statusTone: QuickCheckTone;
  timedOut?: boolean;
}

export interface TradeQuickCheckOptions {
  canonicalRwaAddresses?: Iterable<string>;
  chainId?: number;
}

export const SELECTOR_FAMILIES = {} as any;

export function registerCanonicalRwaAddresses(addresses: Iterable<string>): void {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#registerCanonicalRwaAddresses");
}

export function isCanonicalRwaAddress(address: string, extraCanonicalAddresses?: Iterable<string>): boolean {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#isCanonicalRwaAddress");
}

export function isBaseSwapToken(address: string, chainId: number = undefined as any): boolean {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#isBaseSwapToken");
}

export async function inspectTradeContractQuickCheck(addressInput: string, client: QuickCheckRpc, options: TradeQuickCheckOptions = undefined as any): Promise<TradeQuickCheckResult> {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#inspectTradeContractQuickCheck");
}

export async function runQuickCheckWithTimeout(fn: () => Promise<TradeQuickCheckResult>, address: Address | null, timeoutMs: number = undefined as any): Promise<TradeQuickCheckResult> {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#runQuickCheckWithTimeout");
}

export function _resetQuickCheckCache(): void {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#_resetQuickCheckCache");
}

export async function runTradeContractQuickCheck(args: {
  address: string;
  client: QuickCheckRpc;
  chainId?: number;
  canonicalRwaAddresses?: Iterable<string>;
  timeoutMs?: number;
}): Promise<TradeQuickCheckResult> {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#runTradeContractQuickCheck");
}

export function getSuppressionStorageKey(chainId: number, address: string): string {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#getSuppressionStorageKey");
}

export function isWarningSuppressed(chainId: number, address: string): boolean {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#isWarningSuppressed");
}

export function setWarningSuppressed(chainId: number, address: string, suppress: boolean): void {
  throw new NotImplementedInPublicBuild("lib/trade/quick-check.ts#setWarningSuppressed");
}