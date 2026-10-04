// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { CheckResult } from "../types";

import type { RugEvidenceInput } from "./rug-criteria";

import { assembleRugCandidatesData } from "../data/wanted";

export interface SkippedCandidate {
  tokenAddress: string;
  /** Why this suspect could not be assembled into a judgeable candidate. */
  reason: string;
}

export interface CandidateAssembly {
  candidates: RugEvidenceInput[];
  /** Suspects that were seen but couldn't be evidenced — visible, never silent. */
  skipped: SkippedCandidate[];
  /**
   * L194 — suspects the run's limit cut before any criterion judged them.
   * Same rule as `skipped`, one step earlier: a token the board never looked
   * at must not be indistinguishable from one it cleared.
   */
  nominationsTruncated: number;
  /**
   * Tokens whose custody read DEPLOYER_CONTROLLED at some point but never
   * resolved a wallet-vs-contract kind — the verdict predates `deployerKind`
   * (added this branch) or classification faulted every time it ran.
   * `lpWasControlled` correctly answers `false` for these (an absent field is
   * never an accusation, §8 #9), so they still reach `candidates` and can
   * still be indicted on another criterion. But a reader who only sees
   * `candidates`/`skipped` cannot tell that silence from a genuine BURNED/
   * LOCKED pool — this makes the gap countable instead of invisible.
   */
  controlKindUnresolved: string[];
}

interface TokenEvidence {
  peakLiquidityUsd: number | null;
  currentLiquidityUsd: number | null;
  drainObserved: boolean;
  honeypotConfirmed: boolean;
}

export async function assembleRugCandidates(opts: {
    limit?: number,
    _mockData?: () => Promise<Awaited<ReturnType<typeof assembleRugCandidatesData>>>
  } = undefined as any): Promise<CandidateAssembly> {
  throw new NotImplementedInPublicBuild("lib/wanted/producer.ts#assembleRugCandidates");
}