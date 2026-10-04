// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Hex } from "viem";

import { dexById, primaryDeployment, type DexDeployment } from "../config/dex-registry";

import { quoteLegFrom, type LegShape, type QuoteLeg } from "./route-quote";

export type { LegShape };

export function legTarget(dex: string, protocol: LegShape["protocol"]): Hex | null {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote-targets.ts#legTarget");
}

export function toQuoteLeg(leg: LegShape, target: Hex | null = undefined as any): QuoteLeg | null {
  throw new NotImplementedInPublicBuild("lib/swap/route-quote-targets.ts#toQuoteLeg");
}