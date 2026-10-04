// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { AuditReadContext } from "./read-context";
import type { AuditBudget } from "./deadline";
import type { ArtifactCacheDeps } from "./artifact-cache";
import type {
  AuthorityResolution,
  CapabilityFinding,
  ContractAuditResult,
  ProxyResolution,
} from "./types";

export const AUDIT_RULE_VERSION = "audit-v8";

export function unresolvedAudit(_reason: string): ContractAuditResult {
  throw new NotImplementedInPublicBuild("lib/audit/orchestrator.ts#unresolvedAudit");
}

export function artifactTarget(_address: string, _proxyGraph: ProxyResolution): string {
  throw new NotImplementedInPublicBuild("lib/audit/orchestrator.ts#artifactTarget");
}

export function relabelRenouncedOwner(
  _authorities: AuthorityResolution[],
  _owner: string | null | undefined,
): AuthorityResolution[] {
  throw new NotImplementedInPublicBuild("lib/audit/orchestrator.ts#relabelRenouncedOwner");
}

export interface AuditInstanceRecord {
  address: string;
  blockHash: string;
  ruleVersion: string;
  artifactId: string;
  proxyGraph: ProxyResolution;
  authorities: AuthorityResolution[];
  findings: CapabilityFinding[];
}

export interface AuditEnvironment {
  ctx: AuditReadContext;
  artifactDeps: ArtifactCacheDeps;
  budget: AuditBudget;
  persistInstance: ((record: AuditInstanceRecord) => Promise<unknown>) | null;
}

export async function runContractAuthorityAudit(
  _address: string,
  _env: AuditEnvironment,
): Promise<ContractAuditResult> {
  throw new NotImplementedInPublicBuild("lib/audit/orchestrator.ts#runContractAuthorityAudit");
}
