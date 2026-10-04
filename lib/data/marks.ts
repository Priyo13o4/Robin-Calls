import { eq, and, isNull, desc, count, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { tokenMarks, verdicts, slowRugWatch } from "@/lib/db/schema";
import type { CheckResult, RecordStamp, TokenMark, TokenRecord } from "@/lib/types";
import { fromNumericString } from "@/lib/data/numeric";
import { reportError } from "@/lib/observability/reporter";

const MARK_KIND = "honeypot";

/**
 * Evidence -> jsonb text. `JSON.stringify` THROWS on a bigint, and check
 * evidence is assembled straight out of viem reads (wei amounts, gas prices),
 * so a plain stringify here is a live throw on exactly the tokens that earn a
 * mark. Stored verdicts look clean because their bigints are stringified
 * upstream — that is not a guarantee about this object.
 */
function markJson(evidence: Record<string, unknown>): string {
  return JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
}
const PRIOR_HONEYPOT_CAP = 30;
const PRIOR_MARK_CAP = 30;

function rowToMark(r: typeof tokenMarks.$inferSelect): TokenMark {
  return {
    kind: r.kind as "honeypot" | "pump_dump",
    sourceVerdictId: r.sourceVerdictId != null ? Number(r.sourceVerdictId) : null,
    // A mark taken at $0 liquidity is the strongest evidence there is — never
    // let a truthiness guard turn it back into "unknown".
    liquidityUsdAtMark: fromNumericString(r.liquidityUsdAtMark),
    firedCount: r.firedCount ?? 1,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    liftedAt: r.liftedAt ? new Date(r.liftedAt).toISOString() : null,
    liftedReason: r.liftedReason ?? null,
  };
}

export async function readTokenMarks(
  tokenAddress: string
): Promise<TokenMark[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(tokenMarks)
    .where(eq(tokenMarks.tokenAddress, tokenAddress.toLowerCase()));

  return rows.map(rowToMark);
}

export async function readTokenMark(
  tokenAddress: string,
  kind = MARK_KIND
): Promise<TokenMark | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(tokenMarks)
    .where(
      and(
        eq(tokenMarks.tokenAddress, tokenAddress.toLowerCase()),
        eq(tokenMarks.kind, kind)
      )
    )
    .limit(1);

  return rows[0] ? rowToMark(rows[0]) : null;
}

export async function readTokenRecord(
  tokenAddress: string,
  limit = 24
): Promise<TokenRecord> {
  const conn = database();
  const addr = tokenAddress.toLowerCase();

  if (!conn) {
    return { stamps: [], totalCount: 0, firstScore: null, mark: null, marks: [], watch: false };
  }

  const [vRows, totalCountRes, firstRowRes, marks, watchRowRes] = await Promise.all([
    conn
      .select({
        id: verdicts.id,
        score: verdicts.score,
        tier: verdicts.tier,
        criticalOverride: verdicts.criticalOverride,
        scoreVersion: verdicts.scoreVersion,
        entryHash: verdicts.entryHash,
        createdAt: verdicts.createdAt,
      })
      .from(verdicts)
      .where(eq(verdicts.tokenAddress, addr))
      .orderBy(desc(verdicts.createdAt), desc(verdicts.id))
      .limit(limit),
    conn
      .select({ count: count() })
      .from(verdicts)
      .where(eq(verdicts.tokenAddress, addr)),
    conn
      .select({ score: verdicts.score })
      .from(verdicts)
      .where(eq(verdicts.tokenAddress, addr))
      .orderBy(verdicts.createdAt, verdicts.id)
      .limit(1),
    readTokenMarks(tokenAddress),
    conn
      .select({ id: slowRugWatch.id })
      .from(slowRugWatch)
      .where(and(eq(slowRugWatch.tokenAddress, addr), eq(slowRugWatch.cleared, false)))
      .limit(1),
  ]);

  const stamps: RecordStamp[] = vRows.map((r) => ({
    id: Number(r.id),
    score: r.score,
    tier: r.tier as any,
    criticalOverride: r.criticalOverride ?? null,
    scoreVersion: r.scoreVersion,
    entryHash: r.entryHash,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));

  const totalCount = totalCountRes[0]?.count ?? stamps.length;
  const firstScore = firstRowRes[0]?.score ?? stamps.at(-1)?.score ?? null;

  return {
    stamps,
    totalCount,
    firstScore,
    mark: marks.find((m) => m.kind === "honeypot") ?? null,
    marks,
    watch: Boolean(watchRowRes[0]),
  };
}

export async function recordPumpDumpMark(
  args: {
    tokenAddress: string;
    evidence: Record<string, unknown>;
    liquidityUsd: number | null;
  }
): Promise<"created" | "re-fired" | "re-armed" | null> {
  const conn = database();
  if (!conn) return null;

  try {
    const res: any = await conn.execute(
      sql`SELECT record_token_mark('pump_dump', ${args.tokenAddress.toLowerCase()}, NULL, ${markJson(args.evidence)}::jsonb, ${args.liquidityUsd}) AS result`
    );
    const row = res?.[0] as { result?: string } | undefined;
    return (row?.result as "created" | "re-fired" | "re-armed") ?? null;
  } catch (error) {
    // Its caller (the slow-rug job) reads the return value, so this one keeps
    // its null — but the fault is REPORTED, not printed. L88.
    await reportError({
      code: "RC_LEDGER_MARK_PERSIST_FAILED",
      message: "pump_dump mark write failed — the Watch's brand did not persist",
      operation: "marks.recordPumpDumpMark",
      error,
      tokenAddress: args.tokenAddress,
    });
    return null;
  }
}


export async function recordHoneypotMark(
  args: {
    tokenAddress: string;
    verdictId: number | null;
    evidence: Record<string, unknown>;
    liquidityUsd: number | null;
  }
): Promise<void> {
  const conn = database();
  if (!conn) return;

  // L88 — this does NOT catch. It used to swallow into `console.error`, which
  // made `receipt.ts`'s own `RC_LEDGER_MARK_PERSIST_FAILED` handler unreachable
  // and the failure invisible in `app_error_events`: five honeypot CRITICALs
  // published, zero marks, zero `mark_events`, zero reported errors, and no way
  // to tell a dead writer from a token that never qualified. A mark is a
  // permanent brand the user is waiting on, so §1's rule applies — it throws
  // (CLAUDE.md §2: never a bare `console.error` on a real fault).
  //
  // The DB layer is not the suspect: replaying this exact call on prod with
  // verdict #201's real evidence returns 'created'.
  await conn.execute(
    sql`SELECT record_honeypot_mark(${args.tokenAddress.toLowerCase()}, ${args.verdictId}, ${markJson(args.evidence)}::jsonb, ${args.liquidityUsd})`
  );
}

export async function liftMark(
  token: string,
  reason: string,
  actor: string
): Promise<void> {
  const conn = database();
  if (!conn) return;

  await conn.execute(
    sql`SELECT lift_honeypot_mark(${token.toLowerCase()}, ${reason}, ${actor})`
  );
}

export interface AdminMarkRow {
  token_address: string;
  kind: string;
  fired_count: number;
  source_verdict_id: number | null;
  liquidity_usd_at_mark: number | null;
  created_at: string;
  lifted_at: string | null;
  lifted_reason: string | null;
  lifted_by: string | null;
}

export async function readAllTokenMarks(): Promise<AdminMarkRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(tokenMarks)
    .orderBy(desc(tokenMarks.createdAt));

  return rows.map((r) => ({
    token_address: r.tokenAddress,
    kind: r.kind,
    fired_count: r.firedCount ?? 1,
    source_verdict_id: r.sourceVerdictId != null ? Number(r.sourceVerdictId) : null,
    liquidity_usd_at_mark: fromNumericString(r.liquidityUsdAtMark),
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    lifted_at: r.liftedAt ? new Date(r.liftedAt).toISOString() : null,
    lifted_reason: r.liftedReason ?? null,
    lifted_by: r.liftedBy ?? null,
  }));
}
