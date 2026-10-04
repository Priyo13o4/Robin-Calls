import { eq, desc } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { verdicts, marketSnapshots } from "@/lib/db/schema";

export async function writeVerdictRecord(
  row: typeof verdicts.$inferInsert
): Promise<{ id: number }> {
  const conn = database();
  if (!conn) throw new Error("Database unconfigured");

  const [inserted] = await conn.insert(verdicts).values(row).returning({ id: verdicts.id });
  return { id: Number(inserted.id) };
}

export async function writeMarketSnapshotRecord(
  row: typeof marketSnapshots.$inferInsert
): Promise<void> {
  const conn = database();
  if (!conn) return;

  try {
    await conn.insert(marketSnapshots).values(row);
  } catch (error: any) {
    console.error("market_snapshot write failed:", error.message);
  }
}

export async function readVerdictsForToken(
  tokenAddress: string,
  limit = 24
): Promise<Array<typeof verdicts.$inferSelect>> {
  const conn = database();
  if (!conn) return [];

  return conn
    .select()
    .from(verdicts)
    .where(eq(verdicts.tokenAddress, tokenAddress.toLowerCase()))
    .orderBy(desc(verdicts.createdAt), desc(verdicts.id))
    .limit(limit);
}

export async function readLatestVerdictForToken(
  tokenAddress: string
): Promise<typeof verdicts.$inferSelect | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(verdicts)
    .where(eq(verdicts.tokenAddress, tokenAddress.toLowerCase()))
    .orderBy(desc(verdicts.createdAt), desc(verdicts.id))
    .limit(1);

  return rows[0] ?? null;
}

