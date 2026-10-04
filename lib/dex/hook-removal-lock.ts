// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { TrustedAddress } from "../config/trusted-addresses";

export function removalLockedHooksFrom(
  rows: readonly Pick<TrustedAddress, "address" | "subtype" | "metadata">[]
): Set<string> {
  throw new NotImplementedInPublicBuild("lib/dex/hook-removal-lock.ts#removalLockedHooksFrom");
}

export function hookBlocksRemoval(hooks: string | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/hook-removal-lock.ts#hookBlocksRemoval");
}
