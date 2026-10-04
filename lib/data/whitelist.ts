import { desc, eq } from "drizzle-orm";

import { database } from "@/lib/db/client";
import { whitelistEvents, whitelistMembers } from "@/lib/db/schema";
import { rowToSnakeCase, snakeToCamel } from "./case";

function db() {
  const connection = database();
  if (!connection) throw new Error("Database not configured");
  return connection;
}

/**
 * Admin listing: every whitelist row, newest first, with the social columns
 * needed to render connected/not-connected — a read, so it degrades to []
 * rather than throwing when `DATABASE_URL` is unset (§1).
 */
export async function whitelistMembersForAdmin(): Promise<any[]> {
  const connection = database();
  if (!connection) return [];
  const rows = await connection.query.whitelistMembers.findMany({
    orderBy: [desc(whitelistMembers.createdAt)],
  });
  return rows.map(rowToSnakeCase);
}

export async function whitelistMemberByWallet(walletAddress: string): Promise<any> {
  const row = await db().query.whitelistMembers.findFirst({
    where: eq(whitelistMembers.walletAddress, walletAddress.toLowerCase()),
  });
  return row ? rowToSnakeCase(row) : undefined;
}

export async function whitelistWalletBySocialIdentity(
  column: "twitterUserId" | "telegramUserId",
  userId: string,
): Promise<any> {
  const row = await db().query.whitelistMembers.findFirst({
    columns: { walletAddress: true },
    where: eq(whitelistMembers[column], userId),
  });
  return row ? { wallet_address: row.walletAddress } : undefined;
}

export async function ensureWhitelistMember(walletAddress: string) {
  await db()
    .insert(whitelistMembers)
    .values({ walletAddress: walletAddress.toLowerCase() })
    .onConflictDoNothing({ target: whitelistMembers.walletAddress });
}

/**
 * Callers pass snake_case column names (the shape this API had before the
 * Drizzle migration), so they are converted here.
 *
 * The key check is not defensive noise: Drizzle silently ignores keys that
 * do not match a column, so a typo or a renamed column would drop the write
 * with no error and no type failure — the exact mode that left `scan_runs`
 * empty for every scan. Whitelist writes decide eligibility, so a silently
 * dropped field must be loud.
 */
export async function updateWhitelistMember(
  walletAddress: string,
  values: Record<string, unknown>,
) {
  const columns = Object.keys(whitelistMembers) as Array<keyof typeof whitelistMembers>;
  const known = new Set<string>(columns.map(String));

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const camel = snakeToCamel(key);
    if (!known.has(camel)) {
      throw new Error(
        `updateWhitelistMember: "${key}" (${camel}) is not a whitelist_members column — refusing to silently drop it.`,
      );
    }
    normalized[camel] = value;
  }

  if (Object.keys(normalized).length === 0) return;

  await db()
    .update(whitelistMembers)
    .set(normalized as Partial<typeof whitelistMembers.$inferInsert>)
    .where(eq(whitelistMembers.walletAddress, walletAddress.toLowerCase()));
}

export async function moveWhitelistMember(oldWallet: string, newWallet: string) {
  await db()
    .update(whitelistMembers)
    .set({ walletAddress: newWallet.toLowerCase() })
    .where(eq(whitelistMembers.walletAddress, oldWallet.toLowerCase()));
}

export async function addWhitelistEvent(
  walletAddress: string,
  eventType: string,
  payloadJson: Record<string, unknown>,
) {
  await db().insert(whitelistEvents).values({
    walletAddress: walletAddress.toLowerCase(),
    eventType,
    payloadJson,
  });
}
