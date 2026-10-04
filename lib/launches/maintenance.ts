// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { PublicClient } from "viem";

import { rpc } from "@/lib/rpc/client";

import { createScanContext, runWithScanContext } from "@/lib/observability/context";

import { reportError } from "@/lib/observability/reporter";

import { readEnabledLauncherInstances } from "@/lib/data/launchpads";

import {
  pruneLaunchTelemetry,
  readKnownLaunches,
  readRecentIngestWindows,
} from "@/lib/data/launches";

import {
  INGEST,
  activeModules,
  buildFetchPlan,
  chainContracts,
  contextFrom,
  decodeAll,
  fetchLogs,
  lookupKeys,
  routeLogs,
  subscriptionsFor,
} from "./ingest";

export const MAINTENANCE = {
  recountWindows: 3,
  recountSpan: 10,
  recountLookbackMs: 2 * 60 * 60 * 1000,
  runBudgetMs: 25_000,
} as const;

export async function recountRecentWindows(client: PublicClient): Promise<{ checked: number; missing: string[] }> {
  throw new NotImplementedInPublicBuild("lib/launches/maintenance.ts#recountRecentWindows");
}

export type LaunchMaintenanceResult =
  | {
      ok: true;
      pruned: { hourly: number; anchors: number; windows: number } | null;
      recount: { checked: number; missing: string[] } | null;
      degraded: string[];
    }
  | { ok: false; reason: string };

export async function runLaunchMaintenance(): Promise<LaunchMaintenanceResult> {
  throw new NotImplementedInPublicBuild("lib/launches/maintenance.ts#runLaunchMaintenance");
}