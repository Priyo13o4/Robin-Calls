// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { keccak256, toHex } from "viem";

import { isTransientRpcError } from "../rpc/fault";

import { auditCallKey, type AuditReadContext } from "./read-context";

import type { CapabilityFinding, CapabilityLiveness, LivenessPrecondition, LivenessState } from "./types";

export async function resolveCapabilityLiveness(ctx: AuditReadContext, address: string, capabilities: readonly CapabilityFinding[], nowS: number = undefined as any): Promise<CapabilityLiveness[]> {
  throw new NotImplementedInPublicBuild("lib/audit/liveness.ts#resolveCapabilityLiveness");
}