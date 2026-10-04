// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { EntityKind } from "./entity";

import { isWalletKind } from "./entity";

export type OriginVia = "launchpad-record" | "creation-tx";

export const SHARED_LAUNCHER_MAX_LAUNCHES = 25;

export interface LaunchOrigin {
  address: string;
  via: OriginVia;
  kind: EntityKind | null;
  /** May this address be the subject of a per-person check? */
  attributable: boolean;
  /** Why not, when not — published, so a stand-down says what it was missing. */
  why: string | null;
  /**
   * Evidence only, never scored: whether this address holds the token it
   * created. Collected so the launcher-vs-relayer threshold can be decided from
   * data rather than guessed. `null` = not established.
   */
  holdsToken?: boolean | null;
  /** Launches on record for this address. Published so a stand-down is adjudicable. */
  launches?: number | null;
}

export interface LaunchOriginInput {
  deployerAddress: string | null;
  deployerKind: EntityKind | null;
  /** `curve_tokens.creator_address` — the launchpad's own record. */
  padCreator: string | null;
  padCreatorKind: EntityKind | null;
  /**
   * How many launches `padCreator` is on record for. `null` = could not count,
   * which blocks attribution exactly as a null `padCreatorKind` does (L106).
   */
  padCreatorLaunchCount?: number | null;
  /** `from` on the token's creation transaction. Always an EOA on chain. */
  creationTxFrom: string | null;
  creationTxFromKind: EntityKind | null;
  /**
   * Does that sender hold the token it created? `null` when the holder list
   * could not be read — never folded into `false`, which would read a failed
   * lookup as "walked away like a relayer" (CLAUDE.md §4).
   */
  creationTxFromHoldsToken?: boolean | null;
}

export function resolveLaunchOrigin(input: LaunchOriginInput): LaunchOrigin | null {
  throw new NotImplementedInPublicBuild("lib/scanner/launch-origin.ts#resolveLaunchOrigin");
}