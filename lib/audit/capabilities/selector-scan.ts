// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { toFunctionSelector } from "viem";

import { DANGEROUS_FUNCTIONS } from "../../rpc/abis";

import { hasEvmDispatcherSelector } from "../../security/selector-core";

import type { Capability, CapabilityFinding } from "../types";

interface SelectorEntry {
  signature: string;
  selector: string; // 0x + 8 hex, lowercase
  capability: Capability;
}

export const KNOWN_CAPABILITY_SIGNATURES: readonly string[] = [];

export function classifyFromBytecode(runtimeCode: string): CapabilityFinding[] {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/selector-scan.ts#classifyFromBytecode");
}