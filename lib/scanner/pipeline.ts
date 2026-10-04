// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ExplorerAddressInfo } from "../explorer/types";
import type { EntityKind } from "./entity";
import type { LaunchOrigin } from "./launch-origin";
import type { ScanContext } from "./checks";
import type { Completeness, DegradedAttempt, HistoryIncompleteDetail } from "../ledger/completeness";
import type { ReceiptAction } from "../scan-control/types";
import type { ScanRunContext } from "../observability/context";
import type { Verdict, VerdictRow } from "../types";

export interface ScanOutcome {
  verdict: Verdict;
  row: VerdictRow | null;
  receiptAction: ReceiptAction;
  completeness: Completeness;
  source: "fresh" | "stale-fallback";
  dexProtocols: string[];
  degradedAttempt?: DegradedAttempt;
  historyIncomplete?: HistoryIncompleteDetail;
  receiptCapacityExceeded?: boolean;
}

export interface ReceiptBudget {
  reserve(): Promise<boolean>;
  release(): Promise<void>;
}

export interface ScanOptions {
  receiptBudget?: ReceiptBudget;
}

export function assertExplorerHealthy(scanCtx: ScanRunContext | undefined): void {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#assertExplorerHealthy");
}

export function assertRpcHealthy(ctx: ScanContext): void {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#assertRpcHealthy");
}

export function rpcGateCause(ctx: ScanContext): string | null {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#rpcGateCause");
}

export async function resolveLaunchOriginForScan(
  address: string,
  deployerAddress: string | null,
  deployerKind: EntityKind | null,
  addrInfo: ExplorerAddressInfo | null,
  curve: { creatorAddress: string | null } | null,
  holders: { address?: { hash?: string } | null }[] | null,
): Promise<LaunchOrigin | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#resolveLaunchOriginForScan");
}

export async function scanToken(
  rawAddress: string,
  opts: ScanOptions = {}
): Promise<ScanOutcome> {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#scanToken");
}

export function dexInfraLabel(address: `0x${string}`): string | null {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#dexInfraLabel");
}

export function honeypotMarkMaterial(liquidityUsd: number | null): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/pipeline.ts#honeypotMarkMaterial");
}

export type ScanErrorCode =
  | "RC_SCAN_INVALID_ADDRESS"
  | "RC_SCAN_NOT_CONTRACT"
  | "RC_SCAN_POOL_INPUT"
  | "RC_SCAN_NOT_TOKEN"
  | "RC_EXPLORER_UNAVAILABLE"
  | "RC_RPC_UNAVAILABLE";

export class ScanError extends Error {
  constructor(
    message: string,
    readonly code: ScanErrorCode = "RC_SCAN_INVALID_ADDRESS",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ScanError";
  }
}
