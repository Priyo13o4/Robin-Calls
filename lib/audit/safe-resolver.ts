// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { AuditReadContext } from "./read-context";
import type { SafeResolution } from "./types";

export interface SafePrimitives {
  slot0: string | null;
  nonceOk: boolean;
  owners: string[] | null;
  threshold: number | null;
  version: string | null;
  modulesArray: string[] | null;
}

export function extractAddress(_word: string | null): string | null {
  throw new NotImplementedInPublicBuild("lib/audit/safe-resolver.ts#extractAddress");
}

export function classifySafePrimitives(_p: SafePrimitives): SafeResolution {
  throw new NotImplementedInPublicBuild("lib/audit/safe-resolver.ts#classifySafePrimitives");
}

export async function resolveSafe(
  _ctx: AuditReadContext,
  _address: string,
): Promise<SafeResolution> {
  throw new NotImplementedInPublicBuild("lib/audit/safe-resolver.ts#resolveSafe");
}
