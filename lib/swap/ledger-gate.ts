// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { TokenTradeGate } from "@/lib/data/ledger";

export function ledgerSwapAllowed(gate: TokenTradeGate | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/ledger-gate.ts#ledgerSwapAllowed");
}

export function tradeableTokens(gates: Map<string, TokenTradeGate>): string[] {
  throw new NotImplementedInPublicBuild("lib/swap/ledger-gate.ts#tradeableTokens");
}