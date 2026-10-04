/** GET /api/launches row. A public contract: the shape predates the registry and must not change. */

export type SourceKind = "DIRECT_DEX" | "LAUNCHPAD";
export type VenueModel = "BONDING_CURVE" | "DEX_RESTRICTED";
export type LifecycleState = "CANDIDATE" | "SURFACED" | "GRADUATED" | "EXPIRED";

export interface LaunchFeedRow {
  token_address: string;
  source_kind: SourceKind;
  launchpad_id: number | null;
  launchpad_name: string | null;
  launchpad_slug: string | null;
  venue_model: VenueModel | null;
  lifecycle_state: LifecycleState;
  pool_address: string | null;
  token_name: string | null;
  token_symbol: string | null;
  liquidity_usd: number | null;
  volume_24h_usd: number | null;
  buys_24h: number | null;
  sells_24h: number | null;
  progress_bps: number | null;
  created_at: string;
  surfaced_at: string | null;
  graduated_at: string | null;
  /** Launchpad-native icon pointer; null for direct DEX launches and pads that emit none. */
  metadata_uri: string | null;
  /** Newest published verdict, or null. NULL MEANS UNSCANNED, never "clean" (§4). */
  verdict: {
    verdict_id: number;
    score: number;
    tier: string;
    created_at: string;
  } | null;
  /** Raise held by the curve, quote base units as a numeric string. Display only, never scored. */
  raised_wei: string | null;
  /** null symbol with null address = native ETH; an address with a null symbol means the ticker did not read. */
  quote_symbol: string | null;
  quote_token: string | null;
  quote_decimals: number | null;
  /** Trades in the last 1h window; null for unmeasured families. */
  trades_1h: number | null;
  /** Hourly trade counts for the last 24h, oldest first; null for unmeasured families. */
  trades_hourly: number[] | null;
  /** Quote base units traded on the curve in the last 24h (buys plus sells); null for unmeasured families. */
  volume_24h_quote?: string | null;
  /** DexScreener 1h price change percentage; null if unmeasured or no pool. */
  price_change_h1: number | null;
  liquidity_pulled: boolean;
}
