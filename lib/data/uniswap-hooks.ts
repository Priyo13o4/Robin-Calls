import { and, eq, inArray, max, notInArray, sql } from "drizzle-orm";
import { database } from "../db/client";
import { uniswapHooks } from "../db/schema";
import type { UniswapHookInfo, UniswapHookProperties } from "../hooks/types";

type HookRow = typeof uniswapHooks.$inferInsert;

function toInfo(r: typeof uniswapHooks.$inferSelect): UniswapHookInfo {
  return {
    chainId: r.chainId, address: r.address, name: r.name, description: r.description, deployer: r.deployer,
    verifiedSource: r.verifiedSource, auditUrl: r.auditUrl,
    flags: (r.flags ?? {}) as Record<string, boolean>,
    properties: (r.properties ?? {}) as UniswapHookProperties,
    fetchedAt: r.fetchedAt,
  };
}

/**
 * Hook list entries for these addresses. `looked: false` means the table could not be read, so an
 * address missing from `hooks` is only "not listed" when `looked` is true (§4).
 */
export async function readUniswapHooks(chainId: number, addresses: readonly string[]): Promise<{ looked: boolean; hooks: Map<string, UniswapHookInfo>; fetchedAt: string | null }> {
  const hooks = new Map<string, UniswapHookInfo>();
  const conn = database();
  if (!conn) return { looked: false, hooks, fetchedAt: null };
  const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))];
  try {
    const [rows, meta] = await Promise.all([
      wanted.length ? conn.select().from(uniswapHooks).where(and(eq(uniswapHooks.chainId, chainId), inArray(uniswapHooks.address, wanted))) : [],
      conn.select({ at: max(uniswapHooks.fetchedAt) }).from(uniswapHooks).where(eq(uniswapHooks.chainId, chainId)),
    ]);
    for (const r of rows) hooks.set(r.address, toInfo(r));
    const fetchedAt = meta[0]?.at ?? null;
    // An empty table has never been synced: nothing can be called "not listed" yet.
    return { looked: fetchedAt !== null, hooks, fetchedAt };
  } catch {
    // Unreadable is unknown, never "not listed"; the caller says the list could not be checked.
    return { looked: false, hooks, fetchedAt: null };
  }
}

/** Replace the chain's entries with a fresh list. Throws: the sync job reports the failure. */
export async function replaceUniswapHooks(chainId: number, rows: readonly HookRow[]): Promise<{ upserted: number; removed: number }> {
  const conn = database();
  if (!conn) throw new Error("database not configured");
  return conn.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(uniswapHooks).values(rows.slice(i, i + 500) as HookRow[]).onConflictDoUpdate({
        target: [uniswapHooks.chainId, uniswapHooks.address],
        set: {
          name: sql`excluded.name`, description: sql`excluded.description`, deployer: sql`excluded.deployer`,
          verifiedSource: sql`excluded.verified_source`, auditUrl: sql`excluded.audit_url`,
          flags: sql`excluded.flags`, properties: sql`excluded.properties`, fetchedAt: sql`excluded.fetched_at`,
        },
      });
    }
    const keep = rows.map((r) => r.address);
    const removed = keep.length
      ? await tx.delete(uniswapHooks).where(and(eq(uniswapHooks.chainId, chainId), notInArray(uniswapHooks.address, keep))).returning({ a: uniswapHooks.address })
      : [];
    return { upserted: rows.length, removed: removed.length };
  });
}

export async function countUniswapHooks(chainId: number): Promise<number | null> {
  const conn = database();
  if (!conn) return null;
  const [r] = await conn.select({ n: sql<number>`count(*)::int` }).from(uniswapHooks).where(eq(uniswapHooks.chainId, chainId));
  return r?.n ?? 0;
}
