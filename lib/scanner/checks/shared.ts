// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { LaunchInsiderBuyResult } from "../../dex/launch-insider-buy";

import type { SourceVerificationReadStatus } from "../../explorer/source-verification-retry";

import {
  isTrustedAddress,
} from "../../config/trusted-addresses";

import {
  CRITICAL_OVERRIDES,
  WEIGHTED_CHECKS,
  type CheckSource,
} from "../../config/formula";

import type {
  CheckResult,
  CheckStatus,
  LineageEdge,
  MarketSnapshot,
  TokenMeta,
} from "../../types";

import {
  type ExplorerAddressInfo,
  type ExplorerHolder,
  type ExplorerTx,
  type ExplorerVerificationDetail,
} from "../../explorer/blockscout";

import type { ProxyVerificationTarget } from "../../explorer/verification-target";

import type { LaunchOrigin } from "../launch-origin";

import type {
  ContractAuditResult,
} from "../../audit/types";

import type { PoolRef } from "../../dex/types";

import type { LiquidityPullEvidence } from "../../dex/liquidity-pulls";

import type { PromotionData } from "../../market/dexscreener";

import type { LaunchProvenance } from "../../data/launches";

import { type EntityKind } from "../entity";

export const isInfraAsset = (address: string | null | undefined): any => {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/shared.ts#isInfraAsset");
};

export const isTrustedProxyAdmin = (address: string | null | undefined): any => {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/shared.ts#isTrustedProxyAdmin");
};

export interface ScanContext {
  meta: TokenMeta;
  market: MarketSnapshot | null;
  addrInfo: ExplorerAddressInfo | null;
  /**
   * Verification match precision (full vs partial/bytecode-DB match). Refines
   * the SOURCE VERIFICATION / bytecode-fingerprint labels only — the
   * authoritative verified/unverified signal stays `addrInfo.is_verified`.
   * Null means unverified OR the refinement read missed; never read as "fully".
   */
  verification: ExplorerVerificationDetail | null;
  /**
   * WHOSE verification `verification` describes. For a proxy that is the
   * implementation, so the check must name the hop rather than publish the
   * label as if it were the scanned address's own (§8 #13/#14).
   */
  verificationTarget?: ProxyVerificationTarget | null;
  holders: ExplorerHolder[] | null;
  deployerAddress: string | null;
  /**
   * What `deployerAddress` IS. For a factory-deployed token the explorer's
   * creator is the FACTORY, so every "this deployer's track record" check is
   * really describing a shared launchpad — and its dead-launch tally is the
   * tally of every token that pad ever made. null means the classification
   * faulted, which is not "a person".
   */
  deployerKind: EntityKind | null;
  /**
   * Item 7 — who is behind a CONTRACT creator. Read it through
   * `historySubject`, never directly: a resolved origin is not necessarily an
   * attributable one (lib/scanner/launch-origin.ts).
   */
  launchOrigin?: LaunchOrigin | null;
  deployerTxs: ExplorerTx[] | null;
  /** canonical registry rows (name/symbol/address) from Supabase */
  registry: { asset_name: string; asset_symbol: string; address: string }[];
  /** persistent deployer record from RobinCalls DB, if we've seen them before */
  dbDeployer: {
    launches_dead: number;
    confirmed_rugs: number;
    funder_address: string | null;
    /** A4 (KNOWN-PROBLEMS L58) — lifetime token count in OUR registry for this
     *  deployer. Eventually-consistent (refreshDeployerLaunchCounts), not
     *  live-counted — same tradeoff as the two fields above. */
    launches_total: number;
  } | null;
  /**
   * True when the RobinCalls DB is a live boundary (DATABASE_URL set). Checks
   * that turn a null/empty read into a sentence about the token gate on this to
   * tell "nothing on record" apart from "we never looked". Populated by the
   * pipeline from `isDatabaseConfigured()` — before that it was never assigned,
   * so every one of these checks always claimed "DB not configured".
   */
  db?: boolean;
  /**
   * Round eight's seam: audit an ARBITRARY contract (an LP whale), not the token.
   * A seam rather than a direct import because the subject is only known partway
   * through the custody read — the pipeline cannot audit it up front — and this
   * keeps the one place that owns the audit environment (and therefore the scan's
   * shared deadline) in the pipeline. Absent means the audit flag is off: every
   * contract-whale finding is still stamped `attempted:false`, so a dead wire
   * shows up on a passing scan instead of looking like a clean result.
   */
  auditContract?: (address: string) => Promise<ContractAuditResult | null>;
  bytecode: string | null;


  /** funding-lineage assessment (#4) — null when tracing is unavailable/off */
  lineage: LineageAssessment | null;
  /** serial-clone assessment (§4.4) — null when the registry is unavailable */
  cloneMatch: CloneAssessment | null;
  /**
   * A2 (KNOWN-PROBLEMS L58) — same-transaction insider buy, read async during
   * gather (checkLaunchpadProvenance runs sync, so this cannot be fetched
   * inline there). Null when the flag is off OR the read itself faulted before
   * even reaching a launch-factory query — see lib/dex/launch-insider-buy.ts's
   * `unreadable` state for "found the launch, couldn't confirm either way".
   */
  launchInsiderBuy?: LaunchInsiderBuyResult | null;
  /**
   * Every pool address this token is known to sit in, across ALL adapters
   * (V2 pairs + V3 pools), lowercased. Populated by the pipeline from the
   * market anchor pool + honeypot discovery, then verified against on-chain
   * code (§15.8: EOAs and EIP-7702 wallets are rejected so a mis-reported
   * "pool" can't remove a real holder from the float). Used to exclude the
   * full pool set — not just the single anchor — from holder-concentration
   * math, so a token spread across V2/V3/V4 isn't falsely flagged as
   * concentrated.
   */
  knownPools?: readonly string[];
  /**
   * Protocol-tagged pool refs from the DEX adapters (V2 pairs, V4 pools).
   * lp_custody uses these to read custody off the actual pair contract
   * instead of guessing from the deployer's global NPM book (§15.9).
   */
  poolRefs?: readonly PoolRef[];
  /** Pool-flow history that is intentionally queued for a bounded background refill. */
  liquidityHistoryDeferred?: { reason: string; pools: number } | null;
  /**
   * §15.10c — whether V3 route discovery got an answer for every fee tier.
   * `false` means the factory refused at least one, so `poolRefs` may be missing
   * a real pool and no pool's share of the set can be trusted. Undefined when
   * discovery never ran (see the pipeline); only an explicit `false` gates.
   */
  v3DiscoveryComplete?: boolean;
  /**
   * KNOWN-PROBLEMS L6 — whether the V4 `Initialize` sweep was WHOLE.
   *
   * Distinct from `v3DiscoveryComplete`, which is the hard-fault flag: this one
   * is "we read some of the pools", which on V4 is a truncated explorer page
   * rather than an outage. It still matters because a V4-only token's pool set
   * is the denominator of every share lp_custody publishes AND the input to the
   * materiality downgrade — a dropped pool can move a SECOND pool's status by
   * shrinking that denominator. Undefined when discovery never ran; only an
   * explicit `false` gates.
   */
  /**
   * NAME DEBT (R1/W5): despite the name, this does NOT mean "V4 finished".
   * It is set true only when EVERY extra-pool discovery leg swept whole -
   * the primary V3/V2 adapters AND the cross-DEX sweep's v2/v3/cl legs
   * (`extraDisc.complete` plus every `custodyDisc.*Complete`). The literal
   * string is a published evidence key and scripts/invariant-sweep.sql
   * matches it, so it must not be renamed casually; see KNOWN-PROBLEMS L44.
   */
  v4DiscoveryComplete?: boolean;
  /** D2/D3: how the token's pooled amount splits between checked pools and the rest (raw units as strings). */
  poolCoverage?: {
    pools: number;
    materialPools: number;
    restPools: number;
    unmeasuredRestPools: number;
    measuredTotal: string;
    restAmount: string;
    v4Leftover: string | null;
    poolManagerBalance: string | null;
  } | null;
  /** Which discovery legs set `v3DiscoveryComplete = false`, for the scan_runs cause. */
  discoveryFaultLegs?: string[];
  /**
   * L44 — which discovery legs went short, so a custody SKIP names the leg
   * that actually faulted instead of always describing V4's Initialize sweep.
   */
  v4DiscoveryIncompleteLegs?: string[];
  /**
   * L39 — which explorer adapter served `addrInfo`, and whether it came from
   * the durable cache. Recorded so the next PASS/FAIL flip names its own
   * source instead of leaving the L39 question ("which explorer lied?")
   * unanswerable after the fact.
   */
  addrInfoSource?: { sourceId: string | null; servedFrom: "cache" | "fresh" };
  /**
   * L39 — a SECOND read of `is_verified`, fetched by the pipeline only when the
   * first said `false`. `read: false` means the corroborating source could not
   * be reached, which is not agreement (§4).
   */
  sourceCorroboration?: { read: boolean; isVerified: boolean | null; hasSource: boolean };
  /**
   * L59 — a THIRD state for the same doubt L39 addresses: a lone `false` may
   * be a real negative or Blockscout's `/addresses/<addr>` mid-outage (500s
   * intermittently, chain-verified 2026-08-28). Set only when the first read
   * said `false`. `unreadable` must SKIP, never FAIL — see
   * lib/explorer/source-verification-retry.ts.
   */
  sourceVerificationReadStatus?: SourceVerificationReadStatus;
  /**
   * L46 — provenance for `holders`: which sources were unioned, how many
   * reported balances the chain contradicted, and whether every balance was
   * confirmed. `complete: false` means some balance is still the explorer's
   * word, never that a holder is absent.
   */
  holdersVerified?: {
    sources: string[];
    phantomsDropped: number;
    unionGain: number;
    complete: boolean;
  } | null;
  /**
   * Entity classification of the top holder addresses (§15.8), keyed by
   * lowercase address. EIP-7702 delegated accounts classify as WALLET_7702 —
   * they are user wallets and count as dumpable concentration, whatever the
   * explorer's is_contract says.
   */
  /**
   * Token-scoped liquidity-pull evidence (§15.9): on-chain removal events on
   * THIS token's own pools attributed to the deployer. Pre-fetched by the
   * pipeline so `checkDeployerPulledLiquidity` judges the token, not the
   * deployer's global history. Null when there is no deployer to attribute to.
   */
  liquidityPulls?: LiquidityPullEvidence | null;
  /**
   * Paid-visibility signals from DexScreener (v1.9 `paid_promotion`): active
   * boost count + paid-order history. Null when the fetch never ran; inner
   * fields are null when that read specifically was unreadable.
   */
  promotion?: PromotionData | null;
  /**
   * Launchpad provenance from the curve registry (curve_tokens): who launched
   * this token, how much was raised, and how much of the raise was the creator
   * buying their own curve. Null when the token was never seen on a tracked
   * launchpad (or the DB read failed) — that is a neutral fact, not a fault.
   */
  curve?: LaunchProvenance | null;
  /** The curve-registry read threw, so `curve: null` means unknown, not absent. */
  curveReadFaulted?: boolean;
  /** The lineage trace threw, so `lineage: null` means untraced, not clean. */
  /**
   * The stored deployer record could not be READ this scan. Distinct from a
   * null `dbDeployer`, which means the deployer is genuinely not on file: the
   * rug checks speak that absence as "no rugs behind them", so a transport
   * fault needs its own state rather than borrowing the negative one (§4).
   */
  /**
   * How many launches the CREATOR address is on record for. Feeds the fan-out
   * gate in `historySubject`. `null` = we could not count, never "few".
   */
  creatorLaunchCount?: number | null;
  /**
   * Tokens this creator deployed that are NOT the one being scanned, counted
   * live from the registry. Distinct from `creatorLaunchCount`, which counts
   * pad records; this one counts `tokens` rows, which is the "registry" the
   * one-shot sentence names.
   */
  deployerOtherRegistryLaunches?: number | null;
  dbDeployerReadFaulted?: boolean;
  /** The subject's launches and rugs with the scanned token removed. */
  deployerPriorHistory?: {
    launchesTotal: number;
    launchesDead: number;
    confirmedRugs: number;
  } | null;
  /** The wallet that funded the subject, and that wallet's own record. */
  funderHistory?: {
    funder: string;
    fanOut: number;
    confirmedRugs: number;
    launchesDead: number;
  } | null;
  funderReadFaulted?: boolean;
  /** A confirmed-rug row for the token being scanned, not for its deployer. */
  tokenRug?: {
    ruggedAt: string | null;
    extractedUsd: number | null;
    criteriaVersion: string | null;
  } | null;
  tokenRugReadFaulted?: boolean;
  lineageReadFaulted?: boolean;
  /**
   * Did the lineage trace RUN? False when the feature is off or there was no
   * subject — distinct from both "traced and clean" and "faulted" (N1). A null
   * `lineage` answered all three, and the checks read it as the first.
   */
  lineageTraced?: boolean;
  /** getCode threw, so a null `cloneMatch` means unmatched-because-unread. */
  bytecodeUnavailable?: boolean;
}

export interface LineageAssessment {
  /** deployer, or a wallet one hop away, carries an active hop=1 stain → kill shot */
  hop1Stained: boolean;
  /** a hop=2 stain reaches the deployer → weighted FAIL */
  hop2Stained: boolean;
  /** fresh wallet funded by another fresh wallet — classic pre-rug setup → WARN */
  freshWalletSetup: boolean;
  originDeployer: string | null;
  funder: string | null;
  /** re-verifiable path to the nearest stained ancestor */
  path: LineageEdge[];
  /**
   * Set when the stored stain stood down under SHARED_FUNDER_MAX_FUNDEES: the
   * stain's last edge into this deployer came from a wallet whose own fan-out
   * is past the shared-funder line. Only ever present alongside flags that are
   * all false — the consumer must never read it as an extra stain.
   */
  sharedFunder?: { address: string; fanOut: number };
}

export interface CloneAssessment {
  matched: boolean;
  classification: "legit-template" | "scam-template" | "unknown";
  /** same bytecode as a token whose deployer lineage is stained → FAIL */
  stainedLineage: boolean;
  seenCount: number;
  bytecodeHash: string | null;
  label: string | null;
}

export function slotToAddress(word: string | null | undefined): string | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/shared.ts#slotToAddress");
}

export const weightOf = (id: string): any => {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/shared.ts#weightOf");
};

export function weighted(id: string, status: CheckStatus, reason: string, source: CheckSource, evidence: Record<string, unknown> = undefined as any, deductionOverride?: number): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/shared.ts#weighted");
}

export function critical(id: string, fired: boolean, reason: string, evidence: Record<string, unknown> = undefined as any, skipped: any = undefined as any): CheckResult {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/shared.ts#critical");
}

export const SKIP_EXPLORER = "Explorer unreachable. Source data unavailable.";

export const LIQUIDITY_DEAD_USD = 1_000;

export const LIQUIDITY_THIN_USD = 10_000;