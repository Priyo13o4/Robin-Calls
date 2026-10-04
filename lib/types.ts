import type { CheckSource, Tier } from "./config/formula";
import type { ContractAuditResult } from "./audit/types";

export type CheckStatus = "PASS" | "WARN" | "FAIL" | "CRITICAL" | "SKIP";

/** One scanner check's outcome, stored verbatim in verdicts.checks. */
export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  /** points removed from 100 (0 for PASS/SKIP, half-weight for WARN) */
  deduction: number;
  weight: number | null; // null for CRITICAL overrides
  reason: string;
  source: CheckSource;
  /** raw machine data — addresses, slots, tx hashes — shown in the EVIDENCE drawer */
  evidence: Record<string, unknown>;
}

export interface MarketSnapshot {
  priceUsd: number | null;
  liquidityUsd: number | null;
  /**
   * USD value of the counter-asset side of the scored pool (L155 item 2).
   * null when the provider did not give enough to compute it (not zero).
   */
  liquidityQuoteUsd?: number | null;
  liquidityQuoteSymbol?: string | null;
  volume24hUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  /** Unique 24h traders (§16.3a) — GeckoTerminal supplies these; DexScreener leaves them null. */
  buyers24h: number | null;
  sellers24h: number | null;
  fdvUsd: number | null;
  poolAddress: string | null;
  poolCreatedAt: string | null;
  /**
   * Which venue the provider says `poolAddress` is on, as the provider's own id
   * ("up-v3" from GeckoTerminal, "up" from DexScreener). Carried so custody can
   * name the venue as DATA beside a scope-only sentence ("was not among the
   * pools this scan assessed") — the sentence itself asserts neither venue
   * capability ("no adapter for") nor transience, both of which have each been
   * wrong here (L41). Null when the provider did not say; never inferred.
   */
  poolDexId: string | null;
  priceChangeH1?: number | null;
  /**
   * The provider's other pools for this token, deepest first, from the same
   * response. L212: when the chain reads `poolAddress` as empty, depth falls to
   * the next of these rather than to zero.
   */
  otherPools?: { poolAddress: string; liquidityUsd: number | null; liquidityQuoteUsd: number | null }[];
}

export interface TokenMeta {
  address: `0x${string}`;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
}

export interface Verdict {
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  score: number;
  tier: Tier;
  criticalOverride: string | null;
  scoreVersion: string;
  checks: CheckResult[];
  market: MarketSnapshot | null;
  /**
   * M8 — weightless contract-authority audit evidence (behind
   * ENABLE_CONTRACT_AUTHORITY_AUDIT). Never scored: absent from
   * `fingerprintVerdict` and every `weighted()` deduction. Undefined when the
   * flag is off or the audit could not complete — never a reason to change
   * `score`/`tier`/`checks`.
   */
  contractAudit?: ContractAuditResult;
}

/** Row shape of public.verdicts as read back from Supabase. */
export interface VerdictRow {
  id: number;
  token_address: string;
  token_name: string | null;
  token_symbol: string | null;
  score: number;
  tier: Tier;
  critical_override: string | null;
  score_version: string;
  checks: CheckResult[];
  market_snapshot: MarketSnapshot | null;
  entry_hash: string;
  prev_hash: string;
  anchor_tx: string | null;
  anchored_at: string | null;
  created_at: string;
}

export interface DirectoryPlatform {
  id: number;
  name: string;
  /** URL segment for /ecosystem/<slug>. Stable across name edits (migration 0066). */
  slug: string;
  url: string;
  description: string | null;
  /** One of DIRECTORY_CATEGORY_VALUES (lib/config/ecosystem.ts). */
  category: string;
  has_mcp: boolean;
  has_agent: boolean;
  /** Per-category optional facts, shaped by lib/config/ecosystem.ts. */
  category_details: Record<string, string | string[] | boolean> | null;
  /** Submitter-declared banner image — checked live before use (see PlatformBanner). */
  banner_url?: string | null;
  contact?: string | null;
  status?: string;
  created_at?: string;
}


export interface TrackedLaunch {
  id: number;
  token_address: string;
  token_name: string | null;
  token_symbol: string | null;
  launchpad: string | null;
  pool_address: string | null;
  trigger_metric: "LIQUIDITY" | "VOLUME";
  trigger_label: string | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  pool_created_at: string | null;
  last_score: number | null;
  surfaced_at: string;
}

export interface OperatorRug {
  deployer: string;
  token_address: string | null;
  token_symbol: string | null;
  rugged_at: string | null;
  /** The shared upstream wallet that links the two deployers. */
  via: string;
}

export interface DeployerRow {
  id: number;
  address: string;
  funder_address: string | null;
  launches_total: number;
  launches_dead: number;
  confirmed_rugs: number;
  taken_usd: number | null;
  taken_is_ceiling: boolean;
  /** Other indicted deployers funded by the same person (L177). Empty hides the field. */
  operator_rugs: OperatorRug[];
  last_seen_block: number | null;
  updated_at: string;
}

// ── Phase 3 — The Memory Upgrades ──

/** One past verdict, condensed for THE RECORD stamp strip (#2). */
export interface RecordStamp {
  id: number;
  score: number;
  tier: Tier;
  criticalOverride: string | null;
  scoreVersion: string;
  entryHash: string;
  createdAt: string;
}

/** Kinds of permanent token marks. pump_dump added by the detection pack (§15.5). */
export type TokenMarkKind = "honeypot" | "pump_dump";

/** Persistent mark on a token (#1, §15.5). */
export interface TokenMark {
  kind: TokenMarkKind;
  sourceVerdictId: number | null;
  liquidityUsdAtMark: number | null;
  firedCount: number;
  createdAt: string;
  /** null = active; set = pardoned (still shown, with the reason). */
  liftedAt: string | null;
  liftedReason: string | null;
}

/** The full record shown on a verdict: history + any active/lifted marks. */
export interface TokenRecord {
  stamps: RecordStamp[];
  /** Total verdicts in the ledger, including rows beyond the rendered window. */
  totalCount: number;
  /** Score from the actual first scan, used when the rendered window is truncated. */
  firstScore: number | null;
  /** The honeypot mark (legacy field — kept for existing UI). */
  mark: TokenMark | null;
  /** Every mark on the token, all kinds (§15.5). */
  marks: TokenMark[];
  /** active slow-rug watch (§4.3) — surfaces as an ON-WATCH stamp */
  watch: boolean;
}

/** One hop in a funding-lineage path — re-verifiable from the chain (#4). */
export interface LineageEdge {
  from: string;
  to: string;
  txHash: string;
  block: number | null;
  valueEth?: number | null;
}

/** A stained wallet: how far from a confirmed rugger, and the proof path. */
export interface WalletStain {
  address: string;
  originDeployer: string;
  hops: 1 | 2;
  direction: "upstream" | "downstream";
  path: LineageEdge[];
  active: boolean;
  liftedReason: string | null;
}
