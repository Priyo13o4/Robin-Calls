import { enabledLockerAdapters, type LockerAdapterRow } from "../data/locker-adapters";

/**
 * A1 (KNOWN-PROBLEMS L58) — which lock ABI a locker contract answers, loaded
 * from `locker_adapters` (migration 0072). Mirrors `lib/config/lockers.ts`
 * exactly: module cache, short TTL, a `set*` seam for tests, a `prime*`
 * awaited by the pipeline before anything reads the map.
 *
 * Deliberately a SEPARATE table/cache from `trusted_lockers`: that one governs
 * whether a locker is EXEMPT from whale detection (a registry opinion); this
 * one governs whether we know how to CALL a locker's getter at all (a fact
 * about its bytecode). L56 (registering UNCX as trusted) and A1 (reading its
 * terms) must not be conflated — see the plan doc's "Sequencing is
 * load-bearing" note.
 */

let cache: { map: Map<string, LockerAdapterRow>; loadedAt: number } | null = null;
const TTL_MS = 60_000;

/** Install an adapter set directly. Used by primeLockerAdapters and tests. */
export function setLockerAdapters(rows: readonly LockerAdapterRow[]): void {
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
 * Load enabled locker adapters from the DB into the module cache. Cheap to
 * call — no-ops inside the TTL — and safe without a DB (keeps an empty set,
 * which resolves every lock-terms read to `unreadable`/`no-adapter` rather
 * than throwing).
 */
export async function primeLockerAdapters(): Promise<void> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return;
  setLockerAdapters(await enabledLockerAdapters());
}

/** The current adapter set, keyed by lowercase address. Empty until primed. */
export function lockerAdapterMap(): Map<string, LockerAdapterRow> {
  return cache?.map ?? new Map();
}
