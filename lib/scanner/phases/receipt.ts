// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ScanOptions, ScanOutcome } from "../pipeline";
import type { CheckResult, MarketSnapshot, TokenMark, Verdict } from "../../types";
import type { Completeness } from "../../ledger/completeness";
import type { ScanRunContext } from "../../observability/context";
import type { runHoneypotChecks } from "../honeypot";
import type { discoverCustodyPools } from "../../dex/discovery";
import type { fetchScanMarket } from "../../market/registry";

type HoneypotOut = Awaited<ReturnType<typeof runHoneypotChecks>>;
type CustodyDisc = Awaited<ReturnType<typeof discoverCustodyPools>>;
type MarketFetch = Awaited<ReturnType<typeof fetchScanMarket>>;

interface PoolRefLike { protocol: string }

export interface ReceiptPhaseInput {
  verdict: Verdict;
  marks: TokenMark[];
  honeypot: HoneypotOut;
  honeypotResult: CheckResult;
  extraPools: PoolRefLike[];
  custodyDisc: CustodyDisc;
  marketFetch: MarketFetch;
  market: MarketSnapshot | null;
  scanCtx: ScanRunContext | undefined;
  unreadWeight: number;
  flags: { ledgerAppend: boolean };
  address: string;
  opts: Pick<ScanOptions, "receiptBudget">;
  deployerAddress: string | null;
  bytecodeRead: { ok?: boolean; code: string | null };
  launchpadSlug: string | null;
  liquidityHistoryDeferred: boolean;
}

export function receiptCompletenessAfterHistory(
  marketCompleteness: Completeness,
  historyDeferred: boolean,
  criticalOverride: string | boolean | null,
): Completeness {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/receipt.ts#receiptCompletenessAfterHistory");
}

export async function receiptPolicyPhase(S: ReceiptPhaseInput): Promise<ScanOutcome> {
  throw new NotImplementedInPublicBuild("lib/scanner/phases/receipt.ts#receiptPolicyPhase");
}
