// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "../../rpc/client";

import { matchClone1167 } from "../../audit/proxy-resolver";

import {
  erc20Abi,
  EIP1967_SLOTS,
  DANGEROUS_FUNCTIONS,
  BENIGN_ERC20_SELECTORS,
  OPENZEPPELIN_SELECTORS,
} from "../../rpc/abis";

import {
  DEAD_ADDRESSES,
} from "../../config/chain";

import {
  isTrustedAddress,
  isTrustedBeacon,
  isTrustedProxy,
  isTrustedRwaToken,
} from "../../config/trusted-addresses";

import { readBeaconImplementation } from "../../verify/trusted-address";

import type {
  CheckResult,
} from "../../types";

import type {
  AuthorityResolution,
  Capability,
  CapabilityFinding,
  ContractAuditResult,
} from "../../audit/types";

import { ScanContext, isInfraAsset, isTrustedProxyAdmin, slotToAddress, weighted } from "./shared";

export async function checkUpgradeability(ctx: ScanContext): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#checkUpgradeability");
}

export function ozStandardNote(matched: readonly string[]): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#ozStandardNote");
}

export async function checkDangerousSelectors(ctx: ScanContext): Promise<CheckResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#checkDangerousSelectors");
}

export function accountForDispatchTable(bytecodeResult: CheckResult, audit: ContractAuditResult | null): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#accountForDispatchTable");
}

export function scoreDangerousFunctions(bytecodeResultIn: CheckResult, audit: ContractAuditResult | null): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#scoreDangerousFunctions");
}

export function hasDispatcherSelector(code: string, selector: string): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#hasDispatcherSelector");
}

export function enumerateDispatcherSelectors(code: string): string[] {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#enumerateDispatcherSelectors");
}

export function checkSerialClone(ctx: ScanContext): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/audit-scoring.ts#checkSerialClone");
}