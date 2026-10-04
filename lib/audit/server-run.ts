// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ArtifactCacheDeps } from "./artifact-cache";
import type { AuditScanClock } from "./deadline";
import type { ContractAuditResult } from "./types";

export function scanClock(): AuditScanClock | null {
  throw new NotImplementedInPublicBuild("lib/audit/server-run.ts#scanClock");
}

export function serverArtifactDeps(): ArtifactCacheDeps {
  throw new NotImplementedInPublicBuild("lib/audit/server-run.ts#serverArtifactDeps");
}

export async function runServerContractAudit(
  _address: string,
  _opts: { persist?: boolean } = {},
): Promise<ContractAuditResult> {
  throw new NotImplementedInPublicBuild("lib/audit/server-run.ts#runServerContractAudit");
}
