import { readSiteConfigKeys } from "../data/site-config";

/**
 * Per-DEX enablement, editable at /admin/settings (KNOWN-PROBLEMS F2).
 *
 * Turning a venue OFF hides every pool on it, so the token's remaining pools
 * become the whole denominator and a narrow all-clear can be published over a
 * fraction of its real liquidity (CLAUDE.md §8 #13 — every exclusion is an
 * all-clear). `disabledDexIds()` exists so a scan can say which venues it did
 * not search; do not add a caller of this module that cannot disclose that.
 *
 * An absent row means "no operator opinion" and leaves the registry's existing
 * env/cache default exactly as it was — enabling this is a no-op until someone
 * sets a row.
 */

const KEY_PREFIX = "dex_enabled_";

export function dexEnablementKey(dexId: string): string {
  return `${KEY_PREFIX}${dexId}`;
}

/** null = no row, i.e. defer to the registry's cold-start default. */
export type DexEnablementOverrides = Record<string, boolean>;

let cache: { value: DexEnablementOverrides; loadedAt: number } | null = null;
const TTL_MS = 60_000;

/** Install overrides directly. Used by primeDexEnablement and unit tests. */
export function setDexEnablement(value: DexEnablementOverrides): void {
  cache = { value, loadedAt: Date.now() };
}

export function resetDexEnablementForTests(): void {
  cache = null;
}

/**
 * Only "true"/"false" are opinions. Anything else is a malformed row and must
 * fall through to the default rather than being read as a disable — a typo
 * must not silently delete a venue from every verdict.
 */
export function parseOpinion(raw: string | undefined): boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * Load the overrides into the module cache. The registry reads them
 * synchronously deep inside discovery, so the DB read happens once up front —
 * same contract as primeTrustedLockers() / primeCustodyThresholds().
 */
export async function primeDexEnablement(dexIds: readonly string[]): Promise<void> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return;
  // A config read must not be able to kill a scan (it runs inside the ingestion
  // Promise.all, where an unguarded rejection fails the whole verdict).
  const rows = await readSiteConfigKeys(dexIds.map(dexEnablementKey)).catch(
    (): Record<string, string> => ({}),
  );
  const out: DexEnablementOverrides = {};
  for (const id of dexIds) {
    const opinion = parseOpinion(rows[dexEnablementKey(id)]);
    if (opinion !== null) out[id] = opinion;
  }
  setDexEnablement(out);
}

/** The operator's setting for one DEX, or null when they have not set one. */
export function dexEnabledOverride(dexId: string): boolean | null {
  const value = cache?.value[dexId];
  return value === undefined ? null : value;
}

/** Venues an operator has switched OFF. Non-empty means the scan searched less. */
export function disabledDexIds(): string[] {
  return Object.entries(cache?.value ?? {})
    .filter(([, on]) => !on)
    .map(([id]) => id);
}
