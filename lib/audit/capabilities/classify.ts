// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { classifyFromSource } from "./ast-walker";

import { classifyFromBytecode } from "./selector-scan";

import type { Capability, CapabilityConfidence, CapabilityFinding } from "../types";

export interface ClassifyCapabilitiesInput {
  abi: unknown[] | null;
  sourceNormalized: string | null;
  runtimeCode: string;
  /** Blockscout's verified `contract_name` — scopes source classification to this contract + its inheritance chain (M8 handoff issue #4). Null/absent analyzes every contract in the flattened source. */
  contractName?: string | null;
}

export function classifyCapabilities(input: ClassifyCapabilitiesInput): CapabilityFinding[] {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/classify.ts#classifyCapabilities");
}