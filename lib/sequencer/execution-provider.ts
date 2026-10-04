// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { createHash } from "node:crypto";

import { OUTBOUND_USER_AGENT } from "@/lib/config/user-agent";

import { authHeaders, withApiKey, v1Base } from "@/lib/explorer/http";

import { explorerFallbackApiUrl } from "@/lib/config/chain";

import { withExplorerSlot } from "@/lib/explorer/gate";

import { recordSequencerMetric, reserveSequencerCredits, readSequencerCheckpoint, writeSequencerCheckpoint, recordSequencerExplorerSpend } from "@/lib/data/sequencer";

import type { ExecutionEvidence, ExecutionLog } from "./confirmed-events";

export type ExecutionLookup = { ok: true; evidence: ExecutionEvidence } | { ok: false; reason: string; retryAfterMs: number };

type ExecutionProvider = "robinscan" | "blockscout_public" | "blockscout";

export function normalizeExecution(raw: unknown, hash: string, source: ExecutionEvidence["source"]): ExecutionEvidence | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/execution-provider.ts#normalizeExecution");
}

export function retryAfterMs(value: string | null, now: any = undefined as any): number {
  throw new NotImplementedInPublicBuild("lib/sequencer/execution-provider.ts#retryAfterMs");
}

export const executionDeps = {} as any;

export async function fetchExecutionEvidence(hash: string, attempts: any = undefined as any): Promise<ExecutionLookup> {
  throw new NotImplementedInPublicBuild("lib/sequencer/execution-provider.ts#fetchExecutionEvidence");
}