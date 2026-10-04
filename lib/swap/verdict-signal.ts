// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { latestVerdictRowForToken } from "@/lib/data/ledger";

import { isDatabaseConfigured } from "@/lib/db/client";

import { reportError } from "@/lib/observability/reporter";

import type { VerdictSignal } from "./ui-state";

export interface VerdictSignalDeps {
  latest?: typeof latestVerdictRowForToken;
  isDatabaseConfigured?: () => boolean;
}

export async function readVerdictSignal(token: string, deps: VerdictSignalDeps = undefined as any): Promise<VerdictSignal> {
  throw new NotImplementedInPublicBuild("lib/swap/verdict-signal.ts#readVerdictSignal");
}