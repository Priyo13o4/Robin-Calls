// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "../../rpc/client";

import {
  EIP1967_SLOTS,
} from "../../rpc/abis";

import { CANONICAL_RWA } from "../../verify/trusted-address";

import { isTransientRpcError } from "../../rpc/fault";

import {
  CRITICAL_OVERRIDES,
} from "../../config/formula";

import type {
  CheckResult,
} from "../../types";

import {
  LIQUIDITY_PULL_METHODS,
} from "../../explorer/blockscout";

import { SKIP_EXPLORER, ScanContext, critical, slotToAddress } from "./shared";

import { SHARED_FUNDER_MAX_FUNDEES, historySubject, noSubjectEvidence, pullLaunchSender, subjectEvidence, unattributedOriginNote } from "./subject-origin";

export async function checkImpersonation(ctx: ScanContext): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#checkImpersonation");
}

export function checkExplorerScamFlag(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#checkExplorerScamFlag");
}

export const NO_POOLS_TO_READ = "" as any;

export const PULL_HANDOFF_TO_CUSTODY = "" as any;

export const PULL_HANDOFF_UNCOVERED = "" as any;

export function reconcilePullHandoffWithCustody(criticals: readonly CheckResult[], lpCustody: CheckResult): CheckResult[] {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#reconcilePullHandoffWithCustody");
}

export function pullGapSentence(unread: readonly string[]): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#pullGapSentence");
}

export function checkDeployerPulledLiquidity(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#checkDeployerPulledLiquidity");
}

export function checkFunderRugHistory(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#checkFunderRugHistory");
}

export function checkTokenConfirmedRug(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/critical-overrides.ts#checkTokenConfirmedRug");
}