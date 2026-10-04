// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { V3_FEE_TIERS } from "../rpc/abis";

import { SIM_WALLET, randomSimWallet } from "../dex/erc20-sim";

import { validateDexConfig, discoverV3Pools, quoterPass, deepPass } from "../dex/v3";

import { discoverExtraPools } from "../dex/registry";

import type { PoolRef } from "../dex/types";

export { SIM_WALLET, randomSimWallet };

export interface HoneypotResult {
  status: "PASS" | "WARN" | "CRITICAL" | "SKIP";
  reason: string;
  evidence: Record<string, unknown>;
}

export interface HoneypotSignals {
  pass1Failed: boolean;
  pass2Failed: boolean;
  senderGated: boolean;
  deepInconclusive: boolean;
  buySellAsymmetry: boolean;
  /**
   * A buy quote actually produced tokens at some fee tier. A honeypot LETS you
   * buy and blocks the exit; when even buying is impossible the pool is not
   * provably tradable, and a sell revert on it is a fact about the pool, not
   * the token (WOOD regression — empty V3 pools, real market on V2). Without
   * this proof a failed deep pass caps at WARN so the V2/V4 adapters get to
   * answer instead.
   */
  /**
   * The chain's gas price could not be read, so the sell ran at gas price 0 and
   * a gas-keyed gate would not have been exercised.
   *
   * WARN, not PASS, and this is the precedent in `applyV4TransferResidual`:
   * disclosing the gap in the PROSE while the STATUS publishes the all-clear is
   * a shape this codebase has already been burned by, and the status is what the
   * reader sees. Only reachable when both gas-price sources faulted, i.e. a dead
   * node — rare, and a scan in that state should not be certifying exits.
   */
  gasPriceUnreadable: boolean;
  buyProven: boolean;
  /**
   * The sell cleared at gas price 0 and reverted at the chain's real one
   * (KNOWN-PROBLEMS L14). Unconditionally CRITICAL, and deliberately NOT gated
   * on `buyProven` like the other sell failures: those need independent proof
   * that the pool trades at all, and here the zero-gasprice arm IS that proof —
   * the same sell, through the same pool, completed. Nothing is left for a buy
   * quote to establish.
   */
  gasConditional: boolean;
}

export function classifyHoneypotSignals(signals: HoneypotSignals): HoneypotResult["status"] {
  throw new NotImplementedInPublicBuild("lib/scanner/honeypot.ts#classifyHoneypotSignals");
}

export async function runHoneypotChecks(token: `0x${string}`, market: { buys24h: number | null; sells24h: number | null } | null, opts?: {
    wallets?: [`0x${string}`, `0x${string}`];
    decimals?: number | null;
    candidatePools?: readonly PoolRef[];
  }): Promise<HoneypotResult> {
  throw new NotImplementedInPublicBuild("lib/scanner/honeypot.ts#runHoneypotChecks");
}