// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";

export function v4LiquiditySlot(_poolId: `0x${string}`): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/dex/v4-state-slot.ts#v4LiquiditySlot");
}
