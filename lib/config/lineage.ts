/**
 * Tunables for the stained-funds web (#4). All configurable via env so the
 * propagation policy is auditable and adjustable without a redeploy.
 */
export const lineageConfig = {
  /** Max hops guilt propagates from a confirmed rugger. */
  maxHops: 2,
  /**
   * A wallet that has funded more than this many distinct wallets is a hub
   * (CEX hot wallet / faucet / bridge). Hubs never transmit guilt — the walk
   * stops at them. This is the false-positive firewall.
   */
  hubFanoutThreshold: Number(process.env.LINEAGE_HUB_FANOUT ?? 20),
  /**
   * "Fresh wallet funded by a fresh wallet" heuristic: a funder with at most
   * this many outgoing txs looks like a purpose-built funding wallet.
   */
  freshWalletMaxTxs: Number(process.env.LINEAGE_FRESH_MAX_TXS ?? 5),
} as const;

/**
 * Minimum native value (wei) for a transfer to count as "funding".
 *
 * 0.00001 ETH was fee-scale on this chain, so a launchpad fee, a bonding-curve
 * buy or a swap all read as one wallet funding another — and the stain walk
 * propagates a CRITICAL along those edges. "Funding" has to mean a transfer big
 * enough to have started a wallet, not any payment that happened to move value.
 */
export const MIN_FUNDING_WEI = BigInt(
  process.env.LINEAGE_MIN_FUNDING_WEI ?? (10n ** 16n).toString(),
); // 0.01 ETH

// Shared by the scanner's funder checks and the Wanted board's operator link (L177).
/**
 * Above this many wallets funded, a funder is plumbing rather than a person,
 * and its record must not be read onto anyone it paid gas for. Sibling of
 * `SHARED_LAUNCHER_MAX_LAUNCHES` (lib/scanner/launch-origin.ts): §8 #19 one
 * layer out, since a shared FUNDER is no more a person than a shared deployer.
 *
 * Measured over the 77 edges in `wallet_edges` (2026-09-07): 69 funders paid
 * exactly one wallet, and the whole tail is 2, 2, 3, 9 and 27. The busiest is
 * stained one hop from a confirmed rug AND funds 27 unrelated deployers, so
 * without this it would indict all 27. Set above the dense part of the tail so
 * a person seeding their own handful of wallets stays attributable, which is a
 * FINDING, not plumbing.
 *
 * Direction is the safe one: crossing it turns an accusation into a SKIP.
 */
export const SHARED_FUNDER_MAX_FUNDEES = 3;
