import type { AbiEvent, PublicClient } from "viem";

/**
 * Launch registry contract (docs/ways-of-work/plan/launchpad-tracking/ARCHITECTURE.md §6).
 *
 * Identity is learned from events once and never updated. Progress is READ from
 * contract state, never folded from trades. Labels (Bonding, DEX, stalled) are
 * computed when reading, so nothing here stores a status.
 *
 * A launcher family is one module implementing `LauncherModule`. Another
 * deployment of a known family is a `launchpads` row, not code.
 */

export type LauncherFamily =
  | "pons-v2"
  | "pons-v1"
  | "flap-v1"
  | "curve-events-v1"
  | "cashcat-v1"
  | "party-v1"
  | "doppler-multicurve"
  | "pair-v5"
  | "direct-dex"
  | "v4-pools";

/**
 * CURVE: a bonding-curve contract holds the raise (shared or per token).
 * HOOK_CURVE: the curve is liquidity positions inside a V4 pool (Doppler).
 * POOL: born straight into a DEX pool; there is no raise to fill.
 */
export type VenueKind = "CURVE" | "HOOK_CURVE" | "POOL";

/** One `launchpads` row: a deployed instance of a family. Addresses lowercase. */
export interface LauncherInstance {
  id: number;
  slug: string;
  name: string;
  family: LauncherFamily;
  address: string;
  config: Record<string, unknown>;
}

/** Chain-level contracts a family may subscribe to beyond its own instances. */
export interface ChainContracts {
  v4PoolManager: string | null;
  v2Factories: string[];
  v3Factories: string[];
  clFactories: string[];
  /** Registered quote assets (WETH, USDG, ...), lowercase. */
  quoteAssets: string[];
}

/** A decoded log. `address` lowercase. Ordering fields are chain order. */
export interface ChainLog {
  address: string;
  eventName: string;
  args: Record<string, unknown>;
  topics: readonly string[];
  blockNumber: number;
  logIndex: number;
  transactionHash: string;
}

/**
 * What a module wants fetched each window.
 *
 * `addresses: null` is a topic-only query (Pons V2's per-token curves). The
 * module MUST then resolve every emitter through `IngestContext`, and drop a log
 * whose emitter it cannot resolve: the 0089 allowlist rule. `topics` adds
 * positional filters after topic0 (e.g. ModifyLiquidity with sender = a hook),
 * and such a subscription is fetched by its own call.
 */
export interface LogSubscription {
  addresses: string[] | null;
  events: readonly AbiEvent[];
  topics?: readonly (readonly string[] | null)[];
}

/** Written once into `launches`. Never updated afterwards. */
export interface LaunchDraft {
  tokenAddress: string;
  /** `launchpads.id`; null for families with no row (direct-dex). */
  launchpadId: number | null;
  family: LauncherFamily;
  /**
   * The creator from PROTOCOL STATE or the launch event's own field, never
   * `tx.from` (CLAUDE.md §8 #19). null = unknown, not "no creator".
   */
  creatorAddress: string | null;
  createdBlock: number;
  launchTxHash: string | null;
  venueKind: VenueKind;
  /** The contract holding the raise: per-token curve, shared curve, or hook. */
  curveAddress: string | null;
  /** DEX pool address, or a V4 poolId (0x + 64 hex). */
  poolRef: string | null;
  /** null = native ETH. */
  quoteToken: string | null;
  quoteSymbol: string | null;
  /** Measured, never assumed 18. null = not read. */
  quoteDecimals: number | null;
  /** Raise needed to graduate, in quote base units. null = not applicable or unread. */
  targetQuote: bigint | null;
  name: string | null;
  symbol: string | null;
  metadataUri: string | null;
  /**
   * Quote the creator spent inside the launch transaction. null = not measured,
   * which is different from 0n (measured, no buy).
   */
  devBuyQuote: bigint | null;
  /** Immutable family-specific facts a state reader needs (Doppler positions, poolKey). JSON-safe: bigints as decimal strings. */
  detail: Record<string, unknown> | null;
}

export type LifecycleKind =
  | "GRADUATED"
  | "LOCKED"
  | "MIGRATED"
  | "FEE_RECIPIENT_CHANGED"
  | "CREATOR_BUY";

/** Append-only fact about a launch after it happened. */
export interface LifecycleDraft {
  tokenAddress: string;
  kind: LifecycleKind;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  poolRef: string | null;
  /** Quote amount for CREATOR_BUY; null otherwise. */
  amount: bigint | null;
  detail: Record<string, unknown> | null;
}

/** One trade, counted into hourly buckets. Never stored individually. */
export interface TradeDraft {
  tokenAddress: string;
  blockNumber: number;
  side: "BUY" | "SELL";
  /** Quote amount in base units; null when the event does not carry it. */
  quoteAmount: bigint | null;
  /** The party the protocol records, or null. A router here is not a person. */
  trader: string | null;
}

export interface V4PoolDraft {
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  blockNumber: number;
  txHash: string;
}

/** What a module sees of a launch already in the registry (or created this window). */
export interface KnownLaunch {
  tokenAddress: string;
  family: LauncherFamily;
  launchpadId: number | null;
  creatorAddress: string | null;
  createdBlock: number | null;
  venueKind: VenueKind;
  curveAddress: string | null;
  poolRef: string | null;
  quoteToken: string | null;
  quoteDecimals: number | null;
  targetQuote: bigint | null;
  detail: Record<string, unknown> | null;
  /** Set when read from the registry; the loop uses it for the label window. */
  createdAtIso?: string | null;
}

/**
 * Lookups a decoder needs to map a log back to its token. Backed by the registry
 * plus this window's new launches, so a trade in the same window as its launch
 * still resolves.
 */
export interface IngestContext {
  byCurveAddress(address: string): KnownLaunch | undefined;
  byPoolRef(poolRef: string): KnownLaunch | undefined;
  byToken(tokenAddress: string): KnownLaunch | undefined;
}

export interface DecodeResult {
  launches: LaunchDraft[];
  events: LifecycleDraft[];
  trades: TradeDraft[];
  v4Pools: V4PoolDraft[];
  /** State carried authoritatively by an event (flap progress, a running reserve). Last one per token wins. */
  readings: { tokenAddress: string; reading: StateReading }[];
}

/**
 * A state reading. `fillBps` 0..10000 is the bond fill the Bonding tab ranks on.
 * `quoteBalance` is the raise currently held, in quote base units.
 */
export interface StateReading {
  fillBps: number | null;
  quoteBalance: bigint | null;
  atBlock: number | null;
}

/**
 * `unread` means we could not look (fault, deadline): the caller keeps the last
 * stored reading. It must never be turned into a zero fill (CLAUDE.md §4).
 */
export type StateResult = { ok: true; reading: StateReading } | { ok: false; unread: true };

export interface LauncherModule {
  readonly family: LauncherFamily;
  /** Launch and lifecycle logs. `instances` are this family's enabled rows. */
  launchSubscriptions(instances: readonly LauncherInstance[], chain: ChainContracts): LogSubscription[];
  /** Trade logs, counted only. Return [] for families with nothing to count. */
  tradeSubscriptions(instances: readonly LauncherInstance[], chain: ChainContracts): LogSubscription[];
  /**
   * Pure: no I/O. Receives only logs matching this module's subscriptions, in
   * chain order. Launch logs and trade logs of one window arrive together.
   */
  decode(
    logs: readonly ChainLog[],
    instances: readonly LauncherInstance[],
    chain: ChainContracts,
    ctx: IngestContext,
  ): DecodeResult;
  /**
   * Fill fields events do not carry (name, symbol, quote decimals, creator from
   * protocol state). Must return every draft it was given, same order; a failed
   * read leaves the field null.
   */
  enrich?(client: PublicClient, drafts: readonly LaunchDraft[]): Promise<LaunchDraft[]>;
  /** One result per input token; never throws. Absent family = no fill to read. */
  readState?(client: PublicClient, launches: readonly KnownLaunch[]): Promise<Map<string, StateResult>>;
}
