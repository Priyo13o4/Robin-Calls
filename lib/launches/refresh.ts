// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { createScanContext, runWithScanContext } from "@/lib/observability/context";

import { reportError } from "@/lib/observability/reporter";

import { readEnabledLauncherInstances } from "@/lib/data/launchpads";

import { recordCurvePollRun } from "@/lib/data/curve-poll-runs";

import {
  readListedRefreshSet,
  readMarketRefreshSet,
  readStateRefreshSet,
} from "@/lib/data/launches";

import { rpc } from "@/lib/rpc/client";

import { INGEST, activeModules, dedupeRefreshTokens, refreshMarket, refreshState } from "./ingest";

export const REFRESH = {
  intervalMinutes: 5,
  healingStateLimit: INGEST.healingStateLimit,
  marketTokensPerRun: INGEST.marketTokensPerRun,
  listedTokensPerRun: INGEST.listedTokensPerRun,
} as const;

export type LaunchRefreshResult = {
  ok: true;
  state: { read: number; unread: number } | null;
  market: { read: number; missing: number; faulted: number; nominated: number } | null;
  degraded: string[];
};

export function runLaunchRefresh(): Promise<LaunchRefreshResult> {
  throw new NotImplementedInPublicBuild("lib/launches/refresh.ts#runLaunchRefresh");
}