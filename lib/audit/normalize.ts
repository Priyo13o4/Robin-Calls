// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";

export function normalizeAbi(_abi: unknown[]): string {
  throw new NotImplementedInPublicBuild("lib/audit/normalize.ts#normalizeAbi");
}

export function normalizeSource(
  _mainSource: string,
  _additionalSources: { file_path: string; source_code: string }[],
): string {
  throw new NotImplementedInPublicBuild("lib/audit/normalize.ts#normalizeSource");
}

export function hashAbi(_normalizedAbi: string): string {
  throw new NotImplementedInPublicBuild("lib/audit/normalize.ts#hashAbi");
}

export function hashSource(_normalizedSource: string): string {
  throw new NotImplementedInPublicBuild("lib/audit/normalize.ts#hashSource");
}

export function computeExactRuntimeHash(_runtimeCode: string): string {
  throw new NotImplementedInPublicBuild("lib/audit/normalize.ts#computeExactRuntimeHash");
}
