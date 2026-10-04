// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { CloneAssessment } from "./checks";

import { assessCloneData, recordCloneData } from "../data/clone";

import { computeBytecodeHash } from "./bytecode-hash";

export { computeBytecodeHash };

export async function assessClone(tokenAddress: string, bytecode: string | null): Promise<CloneAssessment | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/clone.ts#assessClone");
}

export async function recordClone(args: {
    tokenAddress: string;
    deployerId: number | null;
    bytecode: string | null;
    /** L116 — the pad slug this scan resolved, or null. */
    launchpad?: string | null;
  }): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/scanner/clone.ts#recordClone");
}