// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  readDrainRescanCandidates,
  claimDrainRescanAttempt,
  markDrainRescanDone,
  type DrainRescanCandidate,
} from "@/lib/data/rugs";

import {
  scanCoordinator,
  type ScanCoordinator,
} from "@/lib/scan-control";

import { type TokenLockAcquisition } from "@/lib/scan-control/types";

import {
  scanToken,
  ScanError,
  type ScanOutcome,
} from "@/lib/scanner/pipeline";

import {
  createScanContext,
  runWithScanContext,
  type ScanRunContext,
} from "@/lib/observability/context";

import {
  persistScanRun,
  type ScanRunSummary,
} from "@/lib/observability/scan-run";

import { reportError } from "@/lib/observability/reporter";

export const DRAIN_RESCAN_MAX_PER_RUN = 3;

export const DRAIN_RESCAN_MAX_ATTEMPTS = 3;

export interface DrainRescanSummary {
  considered: number;
  scanned: number;
  done: number;
  failed: number;
  skipped: number;
  stoppedReason: string | null;
}

export interface DrainRescanDeps {
  readCandidates?: (limit: number) => Promise<DrainRescanCandidate[]>;
  claim?: (id: number) => Promise<boolean>;
  markDone?: (tokenAddress: string) => Promise<void>;
  coordinator?: ScanCoordinator | null | (() => ScanCoordinator | null);
  scan?: (
    address: string,
    opts: { receiptBudget: { reserve: () => Promise<boolean>; release: () => Promise<void> } }
  ) => Promise<ScanOutcome>;
  persistRun?: (ctx: ScanRunContext, summary: ScanRunSummary) => Promise<void>;
  report?: (input: {
    code: string;
    message: string;
    operation: string;
    tokenAddress?: string;
    error?: unknown;
    details?: Record<string, unknown>;
  }) => Promise<void>;
}

export async function runDrainRescans(deps: DrainRescanDeps = undefined as any, nowMs: number = undefined as any): Promise<DrainRescanSummary> {
  throw new NotImplementedInPublicBuild("lib/wanted/drain-rescan.ts#runDrainRescans");
}