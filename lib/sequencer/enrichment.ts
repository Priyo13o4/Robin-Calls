// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { PublicClient } from "viem";

import { activeModules } from "@/lib/launches/ingest";

import { rpc } from "@/lib/rpc/client";

import { recordSequencerMetric } from "@/lib/data/sequencer";

import type { LaunchDraft, LauncherInstance, LauncherModule, KnownLaunch } from "@/lib/launches/types";

type EnrichmentModule = Pick<LauncherModule, "family" | "enrich">;

export type SequencerEnrichmentDeps = {
  modules: (instances: readonly LauncherInstance[]) => readonly EnrichmentModule[];
  rpc: () => PublicClient;
  metric: typeof recordSequencerMetric;
};

export async function enrichNewLaunches(drafts: LaunchDraft[], known: readonly KnownLaunch[], instances: readonly LauncherInstance[], deps: SequencerEnrichmentDeps = undefined as any): Promise<LaunchDraft[]> {
  throw new NotImplementedInPublicBuild("lib/sequencer/enrichment.ts#enrichNewLaunches");
}