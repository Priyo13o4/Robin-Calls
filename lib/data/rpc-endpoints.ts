import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { rpcEndpoints } from "@/lib/db/schema";

/**
 * The RPC provider pool's persistence boundary (migration 0061).
 *
 * THIS IS THE ONLY MODULE THAT MAY SELECT `url`. It holds an Alchemy key in a
 * path and a Goldsky `?secret=`; every other surface (readiness, /admin lists,
 * observability) takes `id`. `readRpcEndpointsRedacted` exists so that rule
 * costs nothing to follow.
 *
 * `readRpcEndpoints()` returning `[]` means one of two genuinely different
 * things — no DATABASE_URL, or a table nobody has seeded — and the caller in
 * lib/config/rpc-endpoints.ts must treat BOTH as "no operator opinion", never
 * as "the pool has no providers" (§4, and §8 #9: an emptiness test standing in
 * for a "did we look" test). It is deliberately NOT this function's job to
 * tell them apart: there is nothing a pool can do differently between them.
 */

export interface RpcEndpointRow {
  id: string;
  url: string;
  enabled: boolean;
  sortOrder: number;
  maxCuPerSecond: number | null;
  maxRequestsPerSecond: number | null;
  maxConcurrentRequests: number | null;
  preferMethods: string[];
  maxLogSpan: number | null;
  denyMethods: string[];
  allowMethods: string[];
  note: string | null;
  disabledAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** "swap" rows serve the swap planner only (migration 0106). */
  pool: "shared" | "swap";
}

/** Everything except the secret. Safe for any surface. */
export type RpcEndpointPublic = Omit<RpcEndpointRow, "url"> & {
  urlHost: string;
  urlFingerprint: string;
};

/**
 * Refuse a URL a paste has corrupted. `trim()` only cleans the ends, and the URL
 * parser turns an inner space into `%20`, so a key pasted as `api_key= KEY` saved
 * fine and every call answered 403 "invalid API key" (L148, 2026-09-15).
 */
export function assertRpcUrl(url: string): string {
  if (/\s/.test(url)) throw new Error("url contains whitespace. Re-paste it without spaces.");
  if (!/^https?:\/\//.test(url)) throw new Error("url must be http(s).");
  try {
    new URL(url);
  } catch {
    throw new Error("url is not a valid URL.");
  }
  return url;
}

/** Hostname only — enough to tell Alchemy from the public RPC in a UI. */
export function redactRpcUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

/**
 * A short, one-way fingerprint of the full URL.
 *
 * The hostname ALONE is not an identity: two Alchemy keys share
 * `robinhood-mainnet.g.alchemy.com`, so /admin/rpc rendered the exhausted key
 * and the healthy one identically and the operator could not tell which row to
 * switch off — a redaction that hides the very distinction the page exists to
 * make. Six hex characters separate them without revealing anything: the key
 * is not recoverable from the digest, and the same URL always prints the same
 * fingerprint, so it can be matched against a probe result or a log line.
 */
export function rpcUrlFingerprint(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 6);
}

function toRow(r: typeof rpcEndpoints.$inferSelect): RpcEndpointRow {
  return {
    id: r.id,
    url: r.url,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    maxCuPerSecond: r.maxCuPerSecond,
    maxRequestsPerSecond: r.maxRequestsPerSecond,
    maxConcurrentRequests: r.maxConcurrentRequests,
    preferMethods: r.preferMethods ?? [],
    maxLogSpan: r.maxLogSpan,
    denyMethods: r.denyMethods ?? [],
    allowMethods: r.allowMethods ?? [],
    note: r.note,
    disabledAt: r.disabledAt,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    pool: r.pool === "swap" ? "swap" : "shared",
  };
}

/** Every configured endpoint, enabled or not, in pool order. Carries secrets. */
export async function readRpcEndpoints(): Promise<RpcEndpointRow[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select()
    .from(rpcEndpoints)
    .orderBy(asc(rpcEndpoints.sortOrder), asc(rpcEndpoints.id));
  return rows.map(toRow);
}

/** Same list with the URL reduced to a hostname. For /admin and readiness. */
export async function readRpcEndpointsRedacted(): Promise<RpcEndpointPublic[]> {
  const rows = await readRpcEndpoints();
  return rows.map(({ url, ...rest }) => ({
    ...rest,
    urlHost: redactRpcUrl(url),
    urlFingerprint: rpcUrlFingerprint(url),
  }));
}

/**
 * Create or replace one endpoint. Takes the insert type, not a loose record —
 * Drizzle silently discards keys that do not match a column (§3), and a
 * dropped `enabled` here would be an endpoint that never turns off.
 */
export async function upsertRpcEndpoint(
  row: typeof rpcEndpoints.$inferInsert,
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  const nowIso = new Date().toISOString();
  const { id: _id, createdAt: _createdAt, ...updatable } = row;
  await conn
    .insert(rpcEndpoints)
    .values({ ...row, updatedAt: nowIso })
    .onConflictDoUpdate({
      target: rpcEndpoints.id,
      set: { ...updatable, updatedAt: nowIso },
    });
}

/**
 * The kill switch. `disabledAt` is stamped on the way OFF and cleared on the
 * way ON, so /admin can show how long a provider has been out — the L19 case
 * was a monthly quota, and "off since Aug 21" is the fact that tells an
 * operator when to turn it back on.
 */
export async function setRpcEndpointEnabled(
  id: string,
  enabled: boolean,
  by: string,
  note?: string | null,
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  const nowIso = new Date().toISOString();
  await conn
    .update(rpcEndpoints)
    .set({
      enabled,
      disabledAt: enabled ? null : nowIso,
      ...(note === undefined ? {} : { note }),
      updatedAt: nowIso,
      updatedBy: by,
    })
    .where(eq(rpcEndpoints.id, id));
}

export async function deleteRpcEndpoint(id: string): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");
  await conn.delete(rpcEndpoints).where(eq(rpcEndpoints.id, id));
}

/** How many rows exist at all — an empty table is "unseeded", not "no pool". */
export async function countRpcEndpoints(): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const rows = await conn.select({ id: rpcEndpoints.id }).from(rpcEndpoints);
  return rows.length;
}
