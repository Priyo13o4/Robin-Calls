// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "../../rpc/client";

import {
  erc20Abi,
} from "../../rpc/abis";

import {
  addresses,
  DEAD_ADDRESSES,
  isAddressConfigured,
} from "../../config/chain";

import {
  trustedAddressSet,
  permanentLockerSet,
} from "../../config/trusted-addresses";

import { isTransientRpcError } from "../../rpc/fault";

import type {
  CheckResult,
} from "../../types";

import {
  type ExplorerHolder,
} from "../../explorer/blockscout";

import type {
  AuthorityResolution,
  CapabilityFinding,
  Completeness,
  ProxyResolution,
} from "../../audit/types";

import { SKIP_EXPLORER, ScanContext, isInfraAsset, weighted } from "./shared";

import { INAPPLICABLE_SKIP } from "./subject-origin";

import { classifyAddresses, subjectFrom, subjectNounOf, type EntityKind } from "../entity";

import { wrapsToken, lookThroughEscrow, type EscrowLookThrough } from "../escrow";

export function redistributeEscrowedStake(wallets: readonly ExplorerHolder[], wrapper: string, seen: EscrowLookThrough, isExcluded: (address: string) => boolean = undefined as any): ExplorerHolder[] {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/holders-ownership.ts#redistributeEscrowedStake");
}

export async function checkHolderConcentration(ctx: ScanContext, classify: (addrs: readonly string[]) => Promise<Record<string, EntityKind>> = undefined as any, escrow: {
    wrapsToken: typeof wrapsToken;
    lookThroughEscrow: typeof lookThroughEscrow;
  } = undefined as any): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/holders-ownership.ts#checkHolderConcentration");
}

export function reconcileOwnershipWithAudit(check: CheckResult, authorities: readonly AuthorityResolution[] | undefined, capabilities: readonly CapabilityFinding[], completeness: Completeness, sourceVerified: boolean | null): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/holders-ownership.ts#reconcileOwnershipWithAudit");
}

export function reconcileUpgradeabilityWithAudit(check: CheckResult, proxyGraph: ProxyResolution | undefined): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/holders-ownership.ts#reconcileUpgradeabilityWithAudit");
}

export async function checkOwnership(ctx: ScanContext): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/holders-ownership.ts#checkOwnership");
}