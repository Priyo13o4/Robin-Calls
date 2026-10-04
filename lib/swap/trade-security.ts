// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { latestVerdictRowForToken } from "@/lib/data/ledger";

import { isDatabaseConfigured } from "@/lib/db/client";

import { FORMULA_VERSION } from "@/lib/config/formula";

import { reportError } from "@/lib/observability/reporter";

import { isOwnToken } from "@/lib/sale/token";

export type TradeSecuritySignal =
  | { kind: "unknown" }
  | { kind: "unscanned" }
  | {
      kind: "verdict";
      token: string;
      tier: string;
      score: number;
      scoreVersion: string;
      scannedAt: string;
      honeypot: {
        status: string;
        reason: string;
        sellCoverageIncomplete: boolean;
        sellCoverageReason?: string;
        evidence?: { poolId?: string };
        blockedRoutes?: Array<{ poolId?: string; protocol?: string; reason: string }>;
      } | null;
      currentFormula: boolean;
      /** Our own token: the UI shows "not scored" in place of tier and score (lib/sale/token.ts). */
      ownToken?: true;
      /** Saved FAIL/WARN checks plus LP custody, so the trade card is not honeypot-only. */
      highlights?: TradeSecurityHighlight[];
    };

export interface TradeSecurityHighlight {
  id: string;
  name: string;
  status: string;
  reason: string;
}

export function tradeSecurityHighlights(checks: unknown): TradeSecurityHighlight[] {
  throw new NotImplementedInPublicBuild("lib/swap/trade-security.ts#tradeSecurityHighlights");
}

export interface TradeSecurityDeps {
  latest?: typeof latestVerdictRowForToken;
  isDatabaseConfigured?: () => boolean;
}

export interface TradeSecurityOptions {
  /** null returns every conclusive route for server-side execution checks. */
  maxBlockedRoutes?: number | null;
}

export async function readTradeSecuritySignal(token: string, deps: TradeSecurityDeps = undefined as any, options: TradeSecurityOptions = undefined as any): Promise<TradeSecuritySignal> {
  throw new NotImplementedInPublicBuild("lib/swap/trade-security.ts#readTradeSecuritySignal");
}