// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  isTrustedFactoryDeployer,
  launchpadIdentity,
} from "../../config/trusted-addresses";

import { flags } from "../../config/flags";

import type {
  CheckResult,
} from "../../types";

import { CREATOR_RAISE_FAIL_PCT, CREATOR_RAISE_WARN_PCT } from "./market-checks";

import { ScanContext, weighted } from "./shared";

import { INAPPLICABLE_SKIP, deployerIsShared, historySubject, noSubjectEvidence, subjectEvidence, unattributedOriginNote } from "./subject-origin";

import type { LaunchInsiderBuyResult } from "../../dex/launch-insider-buy";

export function checkDeployerHistory(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/provenance-history.ts#checkDeployerHistory");
}

export function classifyProvenanceGap(otherLaunches: number | null): { oneShot: boolean | null } {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/provenance-history.ts#classifyProvenanceGap");
}

export function withLaunchInsiderBuyEvidence(result: CheckResult, insiderBuy: LaunchInsiderBuyResult | null | undefined): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/provenance-history.ts#withLaunchInsiderBuyEvidence");
}

export function checkLaunchpadProvenance(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/provenance-history.ts#checkLaunchpadProvenance");
}

export function checkFundingLineage(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/provenance-history.ts#checkFundingLineage");
}