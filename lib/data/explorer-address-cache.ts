import { eq, lt } from "drizzle-orm";
import { database } from "../db/client";
import { explorerAddressInfoCache } from "../db/schema";
import { reportError } from "../observability/reporter";

/**
 * Persistence for the explorer `/addresses/:id` read-through cache
 * (migration 0047). Repository conventions, CLAUDE.md §1: a missing
 * DATABASE_URL is a supported local state, reads degrade to empty, and the
 * best-effort write logs rather than throwing — a cache that cannot be written
 * must never fail the scan that was only trying to warm it.
 */

export interface CachedAddressInfo<T> {
  payload: T;
  fetchedAt: Date;
}

/** Addresses are lowercased at the boundary, always (CLAUDE.md §9). */
function key(address: string): string {
  return address.toLowerCase();
}

export async function readAddressInfoCache<T>(address: string): Promise<CachedAddressInfo<T> | null> {
  const conn = database();
  if (!conn) return null;
  try {
    const rows = await conn
      .select()
      .from(explorerAddressInfoCache)
      .where(eq(explorerAddressInfoCache.address, key(address)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const fetchedAt = new Date(row.fetchedAt);
    // A row whose timestamp will not parse is unusable, not "not cached": say
    // so rather than letting it read as a cold miss forever (CLAUDE.md §4).
    if (Number.isNaN(fetchedAt.getTime())) {
      await reportError({
        code: "RC_EXPLORER_UNAVAILABLE",
        message: `explorer_address_info_cache row for ${key(address)} has an unparseable fetched_at`,
        operation: "explorerAddressCache.read",
        requestOutcome: "degraded",
      }).catch(() => {});
      return null;
    }
    return { payload: row.payload as T, fetchedAt };
  } catch (error) {
    await reportError({
      code: "RC_EXPLORER_UNAVAILABLE",
      message: "explorer_address_info_cache read failed",
      operation: "explorerAddressCache.read",
      error,
      requestOutcome: "degraded",
    }).catch(() => {});
    return null;
  }
}

/**
 * Store a SUCCESSFUL read. Callers must never pass a fault or a null — the
 * whole point is that an unreachable explorer stays unreachable rather than
 * becoming a cached fact.
 */
export async function writeAddressInfoCache(address: string, payload: unknown): Promise<void> {
  const conn = database();
  if (!conn) return;
  const row: typeof explorerAddressInfoCache.$inferInsert = {
    address: key(address),
    payload,
    fetchedAt: new Date().toISOString(),
  };
  try {
    await conn
      .insert(explorerAddressInfoCache)
      .values(row)
      .onConflictDoUpdate({
        target: explorerAddressInfoCache.address,
        set: { payload: row.payload, fetchedAt: row.fetchedAt },
      });
  } catch (error) {
    // Best-effort by design: the caller already has the live answer.
    await reportError({
      code: "RC_EXPLORER_UNAVAILABLE",
      message: "explorer_address_info_cache write failed",
      operation: "explorerAddressCache.write",
      error,
      requestOutcome: "degraded",
    }).catch(() => {});
  }
}

/** Drop entries older than `olderThan`. Returns nothing; purely housekeeping. */
export async function purgeAddressInfoCache(olderThan: Date): Promise<void> {
  const conn = database();
  if (!conn) return;
  try {
    await conn
      .delete(explorerAddressInfoCache)
      .where(lt(explorerAddressInfoCache.fetchedAt, olderThan.toISOString()));
  } catch {
    // Housekeeping only — a failed purge costs disk, never correctness.
  }
}
