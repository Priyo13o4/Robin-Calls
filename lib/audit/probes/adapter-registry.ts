// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { AuditReadContext } from "../read-context";

import type { AuthorityResolution, CapabilityFinding, ProbeAdapter, ProbeResult } from "../types";

import { genericLockV1Adapter } from "./generic-lock-v1";

export const PROBE_ADAPTERS: ProbeAdapter[] = [] as any;

export async function runTargetedProbes(ctx: AuditReadContext, address: string, capabilities: CapabilityFinding[], authorities: AuthorityResolution[], context: { abi: readonly unknown[] | null; runtimeCode: string | null }): Promise<ProbeResult[]> {
  throw new NotImplementedInPublicBuild("lib/audit/probes/adapter-registry.ts#runTargetedProbes");
}