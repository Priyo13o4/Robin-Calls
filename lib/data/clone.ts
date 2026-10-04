import { eq, count, ne, and, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { bytecodeTemplates, tokens, deployers } from "@/lib/db/schema";

export interface BytecodeMatchData {
  classification: string;
  label: string | null;
  seenCount: number;
  priorClones: Array<{ address: string; confirmedRugs: number }>;
}

export async function assessCloneData(
  hash: string,
  tokenAddress: string
): Promise<BytecodeMatchData> {
  const normToken = tokenAddress.toLowerCase();

  const conn = database();
  if (!conn) {
    return { classification: "unknown", label: null, seenCount: 1, priorClones: [] };
  }

  const [tmplRows, cloneRows] = await Promise.all([
    conn
      .select({
        classification: bytecodeTemplates.classification,
        label: bytecodeTemplates.label,
        seenCount: bytecodeTemplates.seenCount,
      })
      .from(bytecodeTemplates)
      .where(eq(bytecodeTemplates.bytecodeHash, hash))
      .limit(1),
    conn
      .select({
        address: tokens.address,
        confirmedRugs: deployers.confirmedRugs,
      })
      .from(tokens)
      .leftJoin(deployers, eq(tokens.deployerId, deployers.id))
      .where(and(eq(tokens.bytecodeHash, hash), ne(tokens.address, normToken))),
  ]);

  const tmpl = tmplRows[0];
  const priorClones = cloneRows.map((r) => ({
    address: r.address,
    confirmedRugs: r.confirmedRugs ?? 0,
  }));

  return {
    classification: tmpl?.classification ?? "unknown",
    label: tmpl?.label ?? null,
    seenCount: Math.max(tmpl?.seenCount ?? 0, priorClones.length + 1),
    priorClones,
  };
}

export async function recordCloneData(
  args: {
    tokenAddress: string;
    deployerId: number | null;
    bytecodeHash: string;
    /**
     * L116 — the pad that launched this token, from protocol state (the curve
     * registry's own row, written by the tracker off factory events), never
     * from bytecode: 130 distinct hashes across 147 tokens, so template
     * matching matches nothing (§8 #19).
     *
     * Null means "this scan did not resolve one", which must never erase a pad
     * a previous scan did resolve, hence the coalesce below (§4).
     */
    launchpad?: string | null;
  }
): Promise<void> {
  const normToken = args.tokenAddress.toLowerCase();
  const nowIso = new Date().toISOString();

  const conn = database();
  if (!conn) return;

  try {
    await conn
      .insert(tokens)
      .values({
        address: normToken,
        deployerId: args.deployerId,
        bytecodeHash: args.bytecodeHash,
        launchpad: args.launchpad ?? null,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: tokens.address,
        set: {
          deployerId: args.deployerId,
          bytecodeHash: args.bytecodeHash,
          // Keep what we knew when this scan resolved nothing.
          launchpad: sql`coalesce(excluded.launchpad, ${tokens.launchpad})`,
          updatedAt: nowIso,
        },
      });

    const countRes = await conn
      .select({ count: count() })
      .from(tokens)
      .where(eq(tokens.bytecodeHash, args.bytecodeHash));

    const totalSeen = countRes[0]?.count ?? 1;

    const existingTmpl = await conn
      .select({ firstSeenToken: bytecodeTemplates.firstSeenToken })
      .from(bytecodeTemplates)
      .where(eq(bytecodeTemplates.bytecodeHash, args.bytecodeHash))
      .limit(1);

    const firstSeen = existingTmpl[0]?.firstSeenToken ?? normToken;

    await conn
      .insert(bytecodeTemplates)
      .values({
        bytecodeHash: args.bytecodeHash,
        firstSeenToken: firstSeen,
        seenCount: totalSeen,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: bytecodeTemplates.bytecodeHash,
        set: {
          firstSeenToken: firstSeen,
          seenCount: totalSeen,
          updatedAt: nowIso,
        },
      });
  } catch (error: any) {
    console.error("recordCloneData write failed:", error.message);
  }
}
