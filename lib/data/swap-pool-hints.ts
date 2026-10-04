import { inArray } from "drizzle-orm";
import { database } from "../db/client";
import { v4Pools } from "../db/schema";

/** Exact durable V4 identity lookup for client-supplied pool IDs. */
export async function readSwapV4PoolsByIds(ids: readonly string[]) {
  const conn = database();
  if (!conn || ids.length === 0) return null;
  const bounded = [...new Set(ids.filter((id) => /^0x[0-9a-fA-F]{64}$/.test(id)).map((id) => id.toLowerCase()))].slice(0, 24);
  if (bounded.length === 0) return [];
  return conn.select().from(v4Pools).where(inArray(v4Pools.poolId, bounded)).limit(24);
}
