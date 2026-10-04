// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ScanRunContext } from "../../observability/context";
import type { ScanContext } from "../checks";
import type { MarketSnapshot, TokenMark, TokenMeta } from "../../types";
import type { fetchScanMarket } from "../../market/registry";
import type { runServerContractAudit } from "../../audit/server-run";

type AuditOut = Awaited<ReturnType<typeof runServerContractAudit>> | null;
type MarketFetchOut = Awaited<ReturnType<typeof fetchScanMarket>>;

export interface GatherPhaseInput {
  scanCtx: ScanRunContext | undefined;
  address: `0x${string}`;
}

export interface GatherPhaseOutput {
  ctx: ScanContext;
  meta: TokenMeta;
  marketFetch: MarketFetchOut;
  market: MarketSnapshot | null;
  bytecodeRead: { ok: boolean; code: string | null };
  deployerAddress: string | null;
  marks: TokenMark[];
  auditPromise: Promise<AuditOut> | null;
}

export async function gatherPhase(S: GatherPhaseInput): Promise<GatherPhaseOutput> {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/gather.ts#gatherPhase");
}
