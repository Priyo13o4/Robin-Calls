// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { readTokenIndictment } from "@/lib/data/wanted";

import { isDatabaseConfigured } from "@/lib/db/client";

import { reportError } from "@/lib/observability/reporter";

import type { TradeIndictment } from "./types";

import { isClear } from "./ui-state";

export interface IndictmentDeps {
  read?: typeof readTokenIndictment;
  isDatabaseConfigured?: () => boolean;
}

export async function readTradeIndictment(token: string, deps: IndictmentDeps = undefined as any): Promise<TradeIndictment> {
  throw new NotImplementedInPublicBuild("lib/swap/indictment.ts#readTradeIndictment");
}