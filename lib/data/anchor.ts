import { eq, desc, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { verdicts, anchors, compareStats } from "@/lib/db/schema";

export async function getUnanchoredHead(): Promise<{ id: number; entryHash: string } | null> {
  const conn = database();
  if (!conn) return null;

  const heads = await conn
    .select({ id: verdicts.id, entryHash: verdicts.entryHash })
    .from(verdicts)
    .orderBy(desc(verdicts.id))
    .limit(1);

  return heads[0] ?? null;
}

export async function isHeadAnchored(headHash: string): Promise<boolean> {
  const conn = database();
  if (!conn) return false;

  const existingRows = await conn
    .select({ id: anchors.id })
    .from(anchors)
    .where(eq(anchors.headHash, headHash))
    .limit(1);

  return existingRows.length > 0;
}

export async function recordAnchor(
  headHash: string,
  upToVerdictId: number,
  txHash: string,
  blockNumber: number
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn.insert(anchors).values({
    headHash,
    upToVerdictId,
    txHash,
    blockNumber,
  });

  // mark every not-yet-anchored verdict up to the head as covered
  await conn
    .update(verdicts)
    .set({ anchorTx: txHash, anchoredAt: new Date().toISOString() })
    .where(sql`${verdicts.id} <= ${upToVerdictId} AND ${verdicts.anchorTx} IS NULL`);

  const statRows = await conn
    .select({ value: compareStats.value })
    .from(compareStats)
    .where(eq(compareStats.key, "anchors_onchain"))
    .limit(1);

  if (statRows[0]) {
    await conn
      .update(compareStats)
      .set({ value: statRows[0].value + 1, updatedAt: new Date().toISOString() })
      .where(eq(compareStats.key, "anchors_onchain"));
  }
}
