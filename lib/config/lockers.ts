import { primeTrustedAddresses, primeTrustedRegistry, trustedAddresses } from "./trusted-addresses";

/**
 * Trusted LP lockers, loaded from the `trusted_lockers` table (managed at
 * /admin/lockers) instead of env. Multi-DEX made the env list unmanageable:
 * every launchpad ships its own locker contract, and blessing one shouldn't
 * need a redeploy.
 *
 * The custody adapters (lib/dex/v2|v3|v4) consult the set synchronously deep
 * inside their read loops, so the DB read happens ONCE up front: the pipeline
 * awaits primeTrustedLockers() before custody runs, and everything downstream
 * reads the module cache. A short TTL keeps admin edits live without a read
 * per scan; a failed refresh keeps serving the last good set (stale lockers
 * beat no lockers — an empty set silently turns every LOCKED pool into a
 * whale WARN).
 */

export type LockerKind = "permanent" | "timelock";

export interface TrustedLocker {
  /** Lowercase 0x address. */
  address: string;
  label: string;
  kind: LockerKind;
}

let cache: { map: Map<string, TrustedLocker>; loadedAt: number } | null = null;
const TTL_MS = 60_000;

/** Install a locker set directly. Used by primeTrustedLockers and unit tests. */
export function setTrustedLockers(rows: readonly TrustedLocker[]): void {
  cache = {
    map: new Map(
      rows.map((r) => {
        const address = r.address.trim().toLowerCase();
        return [address, { ...r, address }];
      }),
    ),
    loadedAt: Date.now(),
  };
}

/**
 * Load enabled lockers from the DB into the module cache. Cheap to call —
 * no-ops inside the TTL — and safe to call without a DB (DB-less mode keeps
 * an empty set, matching the old unset-env behaviour).
 */
export async function primeTrustedLockers(mode: "full" | "registry" = "full"): Promise<void> {
  // Full scan callers still need RWA probes after a quick-check-only registry prime.
  if (mode === "full") await primeTrustedAddresses();
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return;
  if (mode === "registry") await primeTrustedRegistry();
  setTrustedLockers(trustedAddresses()
    // `trustedAddresses()` returns the UNFILTERED rows — the verify_status gate
    // lives in the byCategory index, which this path never touches. Without
    // this an unverified row added at /admin/lockers earned full LOCKED credit
    // and published "can never be withdrawn".
    //
    // Stricter than `install()`'s rule for other categories: `unprobeable` is
    // accepted elsewhere because a label is only a hint, but LOCKED credit is
    // an absolute safety claim about withdrawal, so it needs a positive verify.
    .filter((row) => row.verify_status === "ok")
    .filter((row) => row.category === "lp-locker")
    .map((row) => ({ address: row.address, label: row.label, kind: row.subtype?.includes("permanent") ? "permanent" : "timelock" })));
}

/** The current locker set, keyed by lowercase address. Empty until primed. */
export function trustedLockerMap(): Map<string, TrustedLocker> {
  return cache?.map ?? new Map();
}
