import { enabledLaunchFactories, type LaunchFactoryRow } from "../data/launch-factories";

/**
 * A2 (KNOWN-PROBLEMS L58) — which factory contracts have a chain-verified
 * `TokenLaunched`/`DevBuy` ABI, loaded from `launch_factories` (migration
 * 0073). Mirrors `lib/config/locker-adapters.ts` exactly: module cache, short
 * TTL, a `set*` seam for tests, a `prime*` awaited by the pipeline.
 */

let cache: { rows: LaunchFactoryRow[]; loadedAt: number } | null = null;
const TTL_MS = 60_000;

/** Install a factory set directly. Used by primeLaunchFactories and tests. */
export function setLaunchFactories(rows: readonly LaunchFactoryRow[]): void {
  cache = {
    rows: rows.map((r) => ({ ...r, address: r.address.trim().toLowerCase() })),
    loadedAt: Date.now(),
  };
}

/**
 * Load enabled launch factories from the DB into the module cache. Cheap to
 * call — no-ops inside the TTL — and safe without a DB (keeps an empty set,
 * which resolves every insider-buy read to `not-launched-via-tracked-factory`
 * rather than throwing).
 */
export async function primeLaunchFactories(): Promise<void> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return;
  setLaunchFactories(await enabledLaunchFactories());
}

/** The current factory address set. Empty until primed. */
export function launchFactoryAddresses(): readonly string[] {
  return (cache?.rows ?? []).map((r) => r.address);
}
