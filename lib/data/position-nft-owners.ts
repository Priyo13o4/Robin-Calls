import { and, eq, inArray, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { positionNftCursors, positionNftOwners } from "@/lib/db/schema";

export type NftCursorRead =
  | { status: "ok"; indexedToBlock: number; indexedToHash: string }
  | { status: "missing" }
  | { status: "faulted" };

/** One ERC-721 Transfer on a position manager, in chain order. `to` is the zero address on burn. */
export interface NftTransfer {
  manager: string;
  tokenId: bigint;
  from: string;
  to: string;
  block: number;
  logIndex: number;
}

export class NftOwnerCursorMovedError extends Error {
  constructor(readonly manager: string) {
    super(`position NFT owner cursor moved for ${manager}`);
    this.name = "NftOwnerCursorMovedError";
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";
const lockKey = (manager: string) => `nft-owner:${manager.toLowerCase()}`;

export async function readNftOwnerCursor(manager: string): Promise<NftCursorRead> {
  const conn = database();
  if (!conn) return { status: "faulted" };
  try {
    const [row] = await conn.select().from(positionNftCursors).where(eq(positionNftCursors.manager, manager.toLowerCase())).limit(1);
    return row ? { status: "ok", indexedToBlock: row.indexedToBlock, indexedToHash: row.indexedToHash } : { status: "missing" };
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] position NFT cursor read failed:", (error as Error).message);
    return { status: "faulted" };
  }
}

/** Stored owners for these NFTs; an id absent from the map has never been seeded (or was burned). */
export async function readNftOwners(manager: string, tokenIds: readonly bigint[]): Promise<Map<string, string> | null> {
  const conn = database();
  if (!conn) return null;
  if (!tokenIds.length) return new Map();
  try {
    const rows = await conn.select({ tokenId: positionNftOwners.tokenId, owner: positionNftOwners.owner }).from(positionNftOwners)
      .where(and(eq(positionNftOwners.manager, manager.toLowerCase()), inArray(positionNftOwners.tokenId, tokenIds.map(String))));
    return new Map(rows.map((r) => [r.tokenId, r.owner]));
  } catch (error) {
    console.error("[RC_DB_READ_FAILED] position NFT owner read failed:", (error as Error).message);
    return null;
  }
}

/** Start (or restart, dropping every row) a manager's stream at a block: an empty table is trivially in step. */
export async function resetNftOwners(manager: string, block: number, hash: string): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for position NFT owner writes");
  const m = manager.toLowerCase();
  await conn.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(m)}))`);
    await tx.delete(positionNftOwners).where(eq(positionNftOwners.manager, m));
    await tx.insert(positionNftCursors).values({ manager: m, indexedToBlock: block, indexedToHash: hash.toLowerCase(), updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: positionNftCursors.manager, set: { indexedToBlock: block, indexedToHash: hash.toLowerCase(), updatedAt: new Date().toISOString() } });
  });
}

/** Seed owners read at exactly the cursor block; refuses if the stream has moved since the read was pinned. */
export async function seedNftOwners(manager: string, atBlock: number, owners: ReadonlyMap<bigint, string>): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for position NFT owner writes");
  if (!owners.size) return;
  const m = manager.toLowerCase();
  await conn.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(m)}))`);
    const [cursor] = await tx.select({ to: positionNftCursors.indexedToBlock }).from(positionNftCursors).where(eq(positionNftCursors.manager, m));
    if (!cursor || cursor.to !== atBlock) throw new NftOwnerCursorMovedError(m);
    const values: (typeof positionNftOwners.$inferInsert)[] = [...owners].map(([tokenId, owner]) => ({
      manager: m, tokenId: tokenId.toString(), owner: owner.toLowerCase(), blockNumber: atBlock,
    }));
    for (let i = 0; i < values.length; i += 1_000) {
      await tx.insert(positionNftOwners).values(values.slice(i, i + 1_000)).onConflictDoNothing();
    }
  });
}

/**
 * Apply one window of Transfers to every manager whose cursor sits inside [from - 1, to), then move those
 * cursors to `to`. A mint (from the zero address) seeds its NFT here; any other transfer only moves an NFT
 * already stored, since an NFT minted before the stream started is read pinned once, when first needed.
 */
export async function appendNftOwnerStep(input: {
  from: number;
  to: number;
  toHash: string;
  managers: readonly string[];
  transfers: readonly NftTransfer[];
}): Promise<{ advanced: number; updated: number }> {
  const conn = database();
  if (!conn) throw new Error("database is not configured for position NFT owner writes");
  if (input.to < input.from) throw new Error("position NFT owner step window is not valid");
  const managers = [...new Set(input.managers.map((m) => m.toLowerCase()))].sort();
  if (!managers.length) return { advanced: 0, updated: 0 };
  return conn.transaction(async (tx) => {
    // Advisory locks first, the order seed/reset use; then read the cursors under them.
    for (const m of managers) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey(m)}))`);
    const cursors = await tx.select({ manager: positionNftCursors.manager, to: positionNftCursors.indexedToBlock }).from(positionNftCursors)
      .where(inArray(positionNftCursors.manager, managers));
    let advanced = 0;
    let updated = 0;
    for (const cursor of cursors) {
      if (cursor.to < input.from - 1 || cursor.to >= input.to) continue;
      const finalOwner = new Map<string, string>();
      const minted = new Set<string>();
      const ordered = input.transfers
        .filter((t) => t.manager.toLowerCase() === cursor.manager && t.block > cursor.to && t.block <= input.to)
        .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
      for (const t of ordered) {
        finalOwner.set(t.tokenId.toString(), t.to.toLowerCase());
        if (t.from.toLowerCase() === ZERO) minted.add(t.tokenId.toString());
      }
      const burned = [...finalOwner].filter(([, owner]) => owner === ZERO).map(([id]) => id);
      const fresh = [...finalOwner].filter(([id, owner]) => owner !== ZERO && minted.has(id));
      const moved = [...finalOwner].filter(([id, owner]) => owner !== ZERO && !minted.has(id));
      for (let i = 0; i < fresh.length; i += 1_000) {
        const values: (typeof positionNftOwners.$inferInsert)[] = fresh.slice(i, i + 1_000).map(([id, owner]) => ({
          manager: cursor.manager, tokenId: id, owner, blockNumber: input.to,
        }));
        await tx.insert(positionNftOwners).values(values).onConflictDoUpdate({
          target: [positionNftOwners.manager, positionNftOwners.tokenId],
          set: { owner: sql`excluded.owner`, blockNumber: sql`excluded.block_number` },
        });
        updated += values.length;
      }
      if (burned.length) {
        for (let i = 0; i < burned.length; i += 1_000) {
          const r = await tx.delete(positionNftOwners).where(and(eq(positionNftOwners.manager, cursor.manager), inArray(positionNftOwners.tokenId, burned.slice(i, i + 1_000))))
            .returning({ id: positionNftOwners.tokenId });
          updated += r.length;
        }
      }
      for (let i = 0; i < moved.length; i += 1_000) {
        const batch = moved.slice(i, i + 1_000).map(([id, owner]) => sql`(${id}::numeric, ${owner}::text)`);
        await tx.execute(sql`
          update position_nft_owners as o set owner = incoming.owner, block_number = ${input.to}
          from (values ${sql.join(batch, sql`, `)}) as incoming(token_id, owner)
          where o.manager = ${cursor.manager} and o.token_id = incoming.token_id`);
        updated += batch.length;
      }
      await tx.update(positionNftCursors).set({ indexedToBlock: input.to, indexedToHash: input.toHash.toLowerCase(), updatedAt: new Date().toISOString() })
        .where(and(eq(positionNftCursors.manager, cursor.manager), eq(positionNftCursors.indexedToBlock, cursor.to)));
      advanced++;
    }
    return { advanced, updated };
  });
}
