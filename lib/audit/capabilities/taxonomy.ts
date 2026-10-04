// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Capability } from "../types";

export type {
  Capability,
  CapabilityConfidence,
  CapabilityFinding,
  ProbeStatus,
} from "../types";

export const ALL_CAPABILITIES: Capability[] = [] as any;