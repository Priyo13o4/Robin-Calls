// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "@/lib/rpc/client";

import { buildFetchPlan, chainContracts, fetchLogs, routeLogs, subscriptionsFor } from "./ingest";

import { LAUNCHER_MODULES } from "./modules";

import { POOL_FAMILIES } from "./labels";

import type { LauncherFamily } from "./types";

export interface ProbeCheck {
  id: "contract" | "launch-events";
  ok: boolean;
  detail: string;
}

export interface ProbeResult {
  ok: boolean;
  at: string;
  family: LauncherFamily;
  kind: "curve" | "direct";
  checks: ProbeCheck[];
}

export const PAD_FAMILIES: readonly LauncherFamily[] = [] as any;

export async function probeLaunchpad(address: string, family: LauncherFamily, config: Record<string, unknown> = undefined as any): Promise<ProbeResult> {
  throw new NotImplementedInPublicBuild("lib/launches/probe.ts#probeLaunchpad");
}

export async function detectLaunchpad(address: string): Promise<{ family: LauncherFamily | null; probe: ProbeResult }> {
  throw new NotImplementedInPublicBuild("lib/launches/probe.ts#detectLaunchpad");
}