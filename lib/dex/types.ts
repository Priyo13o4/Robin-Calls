/**
 * Modular DEX adapter layer (PRD §12).
 *
 * A token can hold liquidity across Uniswap V2, V3 and V4 at once. Each adapter
 * knows how to (a) validate its on-chain config, (b) discover the token's pools,
 * (c) read LP custody, and (d) simulate a sell. The orchestrator (registry.ts)
 * fans out across every enabled adapter and aggregates the results, so scoring
 * never assumes a single pool or a single protocol.
 *
 * Honesty rule carried from the honeypot design: an unsupported or empty route
 * is never a CRITICAL. A CRITICAL sell failure requires complete infrastructure
 * and failure across all material supported routes (§12.5).
 */

/**
 * `slipstream-cl` is the Aerodrome/Velodrome CL family (the `CLPool`
 * implementation, "Up V3" on this chain). It is concentrated liquidity like V3,
 * but its factory keys pools on `tickSpacing` rather than `fee`, and positions
 * may be staked into a gauge that becomes their `ownerOf`. See lib/dex/slipstream.ts.
 */
export type DexProtocol = "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "slipstream-cl";

/** One pool a token sits in, from any protocol. */
export interface PoolRef {
  protocol: DexProtocol;
  /** Pool/pair contract address. For V4 this is the singleton PoolManager. */
  pool: `0x${string}`;
  /** The non-token side of the pool (WETH or a canonical quote asset). */
  quoteAsset: `0x${string}`;
  /** Fee tier in hundredths of a bip (V3/V4) or the fixed 30 bps for V2. */
  feeTier: number;
  /**
   * Which DEX deployment this pool belongs to (dex-registry id, e.g. "sushiswap").
   * Absent means the primary Uniswap deployment. Carried so custody can use the
   * RIGHT peripheral contracts and evidence can name the venue.
   */
  dexId?: string;
  /**
   * V3 only: the NonfungiblePositionManager for THIS pool's DEX. V3 LP custody
   * resolves NFT positions through the NPM, and each DEX has its own — a
   * SushiSwap pool's positions live in SushiSwap's NPM, not Uniswap's. Absent
   * falls back to the primary `addresses.positionManager`.
   */
  positionManager?: `0x${string}`;
  /** V4 only: the PoolKey hooks address (a malicious hook is a honeypot vector). */
  hooks?: `0x${string}`;
  /** V4 only: keccak256(PoolKey) — the pool identity inside the singleton. */
  poolId?: `0x${string}`;
  /**
   * V4 only: the full ordered PoolKey. Carried so the sell-sim can quote through
   * the Quoter (which needs currency0/currency1/tickSpacing, not just the poolId)
   * without re-deriving it. Populated by V4 discovery.
   */
  v4Key?: {
    currency0: `0x${string}`;
    currency1: `0x${string}`;
    fee: number;
    tickSpacing: number;
    hooks: `0x${string}`;
    /** L69(b) — the Initialize tx, i.e. who opened this pool. See V4PoolKey. */
    initTxHash?: `0x${string}`;
  };
}

/**
 * Resolves a position holder that is really a WRAPPER into the party behind it.
 *
 * Slipstream stakes a position INTO its gauge, which then answers `ownerOf`, so
 * 68 separate depositors read as one contract holding 99.9% of a pool. Naming
 * the gauge is a false accusation; dropping it is a false all-clear (§8 #13/#14)
 * — so this looks THROUGH it, and says `"faulted"` when it cannot, which costs
 * coverage rather than inventing either answer.
 */
export interface OwnerLookThrough {
  /**
   * `null` — not a wrapper, the owner stands in its own name.
   * an address — the party the wrapper holds this position for.
   * `"faulted"` — this IS a wrapper and we could not see through it.
   */
  resolve(
    owner: `0x${string}`,
    tokenId: bigint,
  ): Promise<`0x${string}` | null | "faulted">;
}

/** LP-custody normalization (PRD §14.8) — who controls the ability to rug. */
export type LpCustodyState =
  | "BURNED"
  | "LOCKED"
  | "DEPLOYER_CONTROLLED"
  /**
   * §15.10 — a single NON-deployer live wallet holds a controlling share of the
   * unburned/unlocked LP. Pullable liquidity concentrated outside the deployer:
   * the deployer renouncing does not protect against it. Distinct from
   * DEPLOYER_CONTROLLED so the Wanted producer never indicts the deployer for a
   * whale it doesn't control.
   */
  | "LP_CONCENTRATED"
  | "DISTRIBUTED"
  | "UNKNOWN";

export interface LpCustody {
  state: LpCustodyState;
  /** Fraction of LP supply provably at burn addresses, 0..1. */
  burnedPct: number;
  /** Fraction held by the deployer / related wallets, 0..1. */
  deployerPct: number;
  /** Fraction held by configured trusted lockers, 0..1. */
  lockedPct: number;
  /**
   * §15.10 — largest share held by a SINGLE non-burn/non-locker wallet, 0..1.
   * The pullable-liquidity risk BOWScan surfaces ("largest LP holder controls
   * X%"). null when the LP holder list could not be read (explorer down), in
   * which case custody degrades to the deployer-only signal. May be the deployer
   * itself — see largestPullerIsDeployer on evidence.
   */
  largestPullerPct: number | null;
  evidence: Record<string, unknown>;
}

/**
 * Sell-simulation outcome for one route.
 * - PASS: a random wallet could sell the tested amount.
 * - CRITICAL: reproducible, sender-independent sell failure on a live route.
 * - INCONCLUSIVE: infrastructure incomplete (no verified sim path yet) — never
 *   scored as CRITICAL on its own.
 * - NOT_APPLICABLE: this adapter does not own the pool.
 */
export type SellSimStatus = "PASS" | "CRITICAL" | "INCONCLUSIVE" | "NOT_APPLICABLE";

export interface SellSim {
  status: SellSimStatus;
  reason: string;
  evidence: Record<string, unknown>;
}

export interface ConfigCheck {
  ok: boolean;
  reason?: string;
  evidence?: Record<string, unknown>;
}

/**
 * A DEX adapter. Discovery/custody are the parts that are correct and cheap to
 * read today; `simulateSell` is optional so an adapter can ship discovery first
 * and add a verified simulation path later without a false CRITICAL in between.
 */
/**
 * One adapter's pool sweep, plus whether that sweep was WHOLE (KNOWN-PROBLEMS L6).
 *
 * `PoolRef[]` alone had nowhere to say "this list may be short", so a truncated
 * log index and a token that genuinely sits in one pool were the same value —
 * and this list is the denominator of every share lp_custody publishes.
 *
 * `complete: false` means "read something, but not all of it": degrade the
 * conclusion, keep the verdict. NOTHING readable is still a THROW, which is a
 * different and harder fault — see `discoverExtraPools`.
 */
export interface PoolDiscovery {
  pools: PoolRef[];
  complete: boolean;
}

export interface DexAdapter {
  readonly protocol: DexProtocol;
  /** True when the required addresses are set and non-zero (not validated yet). */
  isConfigured(): boolean;
  /** One-time on-chain validation (bytecode present, identity round-trips). */
  validateConfig(): Promise<ConfigCheck>;
  /** All pools the scanned token sits in, for this protocol. */
  discoverPools(token: `0x${string}`): Promise<PoolDiscovery>;
  /** LP custody for a discovered pool, when the adapter supports it. */
  readLpCustody?(
    token: `0x${string}`,
    pool: PoolRef,
    deployer: string | null,
  ): Promise<LpCustody>;
  /**
   * Start this pool's full-history log index WITHOUT waiting for it, so several
   * pools' explorer reads overlap instead of running back to back.
   *
   * Purely a latency hint: it fills the pool liquidity history that
   * `readLpCustody` will read, so the later `readLpCustody` joins or finds
   * ready history rather than starting cold. Skipping it entirely changes
   * nothing but the wall clock: which is why it is optional and why the
   * caller ignores its result AND its rejection.
   *
   * Implement it only where custody actually reads liquidity history (V3, V4).
   * V2 custody is a balance read and has nothing to warm.
   */
  warmLpCustodyIndex?(token: `0x${string}`, pool: PoolRef): Promise<unknown>;
  /** Deep sell simulation for a discovered pool, when a verified path exists. */
  simulateSell?(token: `0x${string}`, pool: PoolRef): Promise<SellSim>;
}
