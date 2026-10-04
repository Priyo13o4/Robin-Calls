// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export const FORMULA_VERSION = "1.54";

export const PRIOR_HONEYPOT_CAP = 59;

export const PRIOR_MARK_CAP = PRIOR_HONEYPOT_CAP;

export const WASH_TRADING_FAIL_CAP = 59;

export const IMPERSONATION_MIMIC_CAP = 59;

export const UNREAD_SURFACE_CLEAR_CAP = 84;

export const CUSTODY_UNREAD_CAP = 60;

export const UNREAD_SURFACE_WEIGHT_DEFAULT = 10;

export type SkipKind = "unavailable" | "inapplicable";

export const SKIP_KIND_BY_CHECK: Record<string, SkipKind> = {} as any;

export function skipKindOf(checkId: string, evidence?: Record<string, unknown>): SkipKind {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#skipKindOf");
}

type ScoredCheck = {
  id: string;
  status: string;
  weight: number | null;
  evidence: Record<string, unknown>;
};

export function unavailableChecks<T extends ScoredCheck>(checks: readonly T[]): T[] {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#unavailableChecks");
}

export function unreadSurfaceWeight(checks: readonly ScoredCheck[]): number {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#unreadSurfaceWeight");
}

export function custodySurfaceUnread(checks: readonly ScoredCheck[]): boolean {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#custodySurfaceUnread");
}

export type CheckSource =
  | "live eth_call"
  | "explorer"
  | "DEX market data"
  | "canonical registry"
  | "RobinCalls DB"
  /** contract-authority audit: proxy/authority resolution + capability classification over verified source/bytecode */
  | "contract audit"
  /** configuration-derived fact (e.g. trusted-infra allowlist), no live probe */
  | "config";

export type Tier = "CLEAR" | "CAUTION" | "DANGER" | "CRITICAL";

export const TIER_BANDS: { tier: Tier; min: number; max: number; label: string }[] = [] as any;

export function tierForScore(score: number, critical: boolean): Tier {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#tierForScore");
}

export interface CriticalOverrideDef {
  id: string;
  name: string;
  mechanism: string;
  source: CheckSource;
}

export const CRITICAL_OVERRIDES: CriticalOverrideDef[] = [] as any;

export interface PostScoreRuleDef {
  id: string;
  name: string;
  mechanism: string;
  source: CheckSource;
  /**
   * The ceiling this rule imposes — the number that actually does the work.
   *
   * Carried on the definition rather than left implicit in `mechanism` prose
   * because two of these rules are emitted into `verdict.checks[]` with
   * `weight: null` and `deduction: 0`, and any consumer reading only those two
   * fields concludes the rule did nothing. `get_methodology` publishes this so
   * the agent has a number to cite instead of inferring one from a zero.
   */
  cap: number;
}

export const POST_SCORE_RULES: PostScoreRuleDef[] = [] as any;

export interface WeightedCheckDef {
  id: string;
  name: string;
  weight: number;
  mechanism: string;
  source: CheckSource;
}

export const WEIGHTED_CHECKS: WeightedCheckDef[] = [] as any;

export const FORMULA_CHANGELOG: {
  version: string;
  date: string;
  changes: string;
}[] = [] as any;

export const TOTAL_WEIGHT = WEIGHTED_CHECKS.reduce((s, c) => s + c.weight, 0);

export const UNREAD_SURFACE_DEFER_WEIGHT = Math.ceil(TOTAL_WEIGHT / 2);

export function exitabilityUnproven(honeypot: {
  evidence?: Record<string, unknown> | null;
} | null | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#exitabilityUnproven");
}

export const CHECK_MECHANISM_BY_ID: Record<string, string> = {} as any;

export function mechanismForCheckId(id: string): string | undefined {
  throw new NotImplementedInPublicBuild("lib/config/formula.ts#mechanismForCheckId");
}