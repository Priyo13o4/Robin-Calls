// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { formatUnits } from "viem";

import type { LaunchFeedRow } from "./feed-types";

export function raisedDisplay(weiString: string | null, quote?: { token: string | null; symbol: string | null; decimals: number | null }): string {
  throw new NotImplementedInPublicBuild("lib/launches/raised.ts#raisedDisplay");
}

export function rowRaisedDisplay(row: LaunchFeedRow): string {
  throw new NotImplementedInPublicBuild("lib/launches/raised.ts#rowRaisedDisplay");
}

export function isPureBondingCurve(row: LaunchFeedRow): boolean {
  throw new NotImplementedInPublicBuild("lib/launches/raised.ts#isPureBondingCurve");
}