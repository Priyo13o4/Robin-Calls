import { eq, lt, and, or, ilike, desc, inArray, sql } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { verdicts, compareStats, rugs, tokens, v4Pools } from "@/lib/db/schema";
import { assessedPoolRefs, type LedgerPools, type LedgerPoolTarget } from "@/lib/trade/ledger-pools";
import type { VerdictRow } from "../types";

/**
 * Ledger read repository (PRD §17.1) — the hot-path data boundary. Routes and
 * the pipeline ask questions in domain terms; only this layer knows the
 * DB query shapes, which keeps a future database migration to one directory.
 */

export type CanonicalVerdictRow = VerdictRow & {
  result_fingerprint?: string | null;
  completeness?: string | null;
  receipt_policy_version?: string | null;
  dex_protocols?: string[] | null;
  primary_pool_address?: string | null;
};

function mapVerdictRow(r: typeof verdicts.$inferSelect): CanonicalVerdictRow {
  return {
    id: Number(r.id),
    token_address: r.tokenAddress,
    token_name: r.tokenName,
    token_symbol: r.tokenSymbol,
    score: r.score,
    tier: r.tier as VerdictRow["tier"],
    critical_override: r.criticalOverride,
    score_version: r.scoreVersion,
    checks: r.checks as VerdictRow["checks"],
    market_snapshot: r.marketSnapshot as VerdictRow["market_snapshot"],
    entry_hash: r.entryHash,
    prev_hash: r.prevHash,
    anchor_tx: r.anchorTx,
    anchored_at: r.anchoredAt ? new Date(r.anchoredAt).toISOString() : null,
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    result_fingerprint: r.resultFingerprint,
    completeness: r.completeness,
    receipt_policy_version: r.receiptPolicyVersion,
    dex_protocols: r.dexProtocols,
    primary_pool_address: r.primaryPoolAddress,
  };
}

/** Latest canonical verdict for a token, or null when none exists. */
export async function latestVerdictRowForToken(
  tokenAddress: string
): Promise<CanonicalVerdictRow | null> {
  if (!tokenAddress) return null;

  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(verdicts)
    .where(eq(verdicts.tokenAddress, tokenAddress.toLowerCase()))
    .orderBy(desc(verdicts.id))
    .limit(1);

  return rows[0] ? mapVerdictRow(rows[0]) : null;
}


/** One token's newest receipt, reduced to what a sitemap entry needs. */
export interface SitemapVerdictToken {
  token_address: string;
  token_symbol: string | null;
  created_at: string;
}

/**
 * The `limit` most recently scanned tokens, one row per token (its newest
 * receipt). For /sitemap.xml.
 *
 * Capped on purpose. The sitemap is force-dynamic, so this runs per crawl, and
 * an uncapped DISTINCT ON over the whole ledger would grow without bound —
 * a sitemap a crawler times out on advertises nothing at all.
 *
 * Degrades to `[]` with no database (§1). The sitemap treats that as "no token
 * pages to advertise", which is the safe direction: a missing URL is re-found
 * from the site's own links, whereas an advertised URL that 404s is a penalty.
 */
export async function recentlyVerdictedTokens(
  limit = 500,
): Promise<SitemapVerdictToken[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn.execute<Record<string, unknown>>(sql`
    select token_address, token_symbol, created_at
    from (
      select distinct on (token_address)
             token_address, token_symbol, created_at
      from verdicts
      order by token_address, created_at desc
    ) latest
    order by created_at desc
    limit ${limit}
  `);

  // drizzle's `execute` returns the driver's result object; postgres-js hands
  // back an array-like, node-postgres a { rows }. Normalise both.
  const list: Record<string, unknown>[] = Array.isArray(rows)
    ? (rows as Record<string, unknown>[])
    : ((rows as { rows?: Record<string, unknown>[] }).rows ?? []);
  return list.map((r) => ({
    token_address: String(r.token_address),
    token_symbol: r.token_symbol == null ? null : String(r.token_symbol),
    created_at: String(r.created_at),
  }));
}

/** The card stamp: the newest verdict for one token, nothing else. */
export interface TokenVerdictStamp {
  verdict_id: number;
  score: number;
  tier: string;
  created_at: string;
}

/**
 * Newest verdict per token for a BOUNDED set of addresses — the Night Market's
 * card stamp. One DISTINCT ON query for the whole page rather than one read per
 * card, which at 60 cards a poll would be 60 round trips every 30 seconds.
 *
 * Absent from the returned map means NO VERDICT EXISTS, and callers must render
 * that as "not yet scanned" rather than as any kind of clearance — an unscanned
 * token and a clean one are not the same claim (§4). A missing database returns
 * an empty map, which lands in the same honest place.
 */
export async function latestVerdictStampsForTokens(
  tokenAddresses: readonly string[]
): Promise<Map<string, TokenVerdictStamp>> {
  const out = new Map<string, TokenVerdictStamp>();
  const wanted = [...new Set(tokenAddresses.map((a) => a.toLowerCase()))].filter((a) =>
    /^0x[0-9a-f]{40}$/.test(a)
  );
  if (wanted.length === 0) return out;

  const conn = database();
  if (!conn) return out;

  const rows = await conn
    .selectDistinctOn([verdicts.tokenAddress], {
      tokenAddress: verdicts.tokenAddress,
      id: verdicts.id,
      score: verdicts.score,
      tier: verdicts.tier,
      createdAt: verdicts.createdAt,
    })
    .from(verdicts)
    .where(inArray(verdicts.tokenAddress, wanted))
    .orderBy(verdicts.tokenAddress, desc(verdicts.id));

  for (const r of rows) {
    out.set(r.tokenAddress.toLowerCase(), {
      verdict_id: Number(r.id),
      score: Number(r.score),
      tier: r.tier,
      created_at: new Date(r.createdAt).toISOString(),
    });
  }
  return out;
}

/** What a trade link needs from a token's newest verdict and the rug board. */
export interface TokenTradeGate {
  tier: string;
  honeypotStatus: string | null;
  confirmedRugStatus: string | null;
  ruggedOnBoard: boolean;
}

/**
 * Newest-verdict trade gate for a bounded set of tokens, in two queries. Absent
 * from the map means we could not read one, and callers must not offer a trade.
 */
export async function latestTradeGatesForTokens(
  tokenAddresses: readonly string[]
): Promise<Map<string, TokenTradeGate>> {
  const out = new Map<string, TokenTradeGate>();
  const wanted = [...new Set(tokenAddresses.map((a) => a.toLowerCase()))].filter((a) =>
    /^0x[0-9a-f]{40}$/.test(a)
  );
  if (wanted.length === 0) return out;

  const conn = database();
  if (!conn) return out;

  const checkStatus = (id: string) =>
    sql<string | null>`(select c->>'status' from jsonb_array_elements(${verdicts.checks}) c where c->>'id' = ${id} limit 1)`;
  const [rows, rugged] = await Promise.all([
    conn
      .selectDistinctOn([verdicts.tokenAddress], {
        tokenAddress: verdicts.tokenAddress,
        tier: verdicts.tier,
        honeypotStatus: checkStatus("honeypot"),
        confirmedRugStatus: checkStatus("token_confirmed_rug"),
      })
      .from(verdicts)
      .where(inArray(verdicts.tokenAddress, wanted))
      .orderBy(verdicts.tokenAddress, desc(verdicts.id)),
    conn
      .selectDistinct({ address: tokens.address })
      .from(rugs)
      .innerJoin(tokens, eq(tokens.id, rugs.tokenId))
      .where(inArray(tokens.address, wanted)),
  ]);

  const ruggedSet = new Set(rugged.map((r) => r.address.toLowerCase()));
  for (const r of rows) {
    const addr = r.tokenAddress.toLowerCase();
    out.set(addr, {
      tier: r.tier,
      honeypotStatus: r.honeypotStatus ?? null,
      confirmedRugStatus: r.confirmedRugStatus ?? null,
      ruggedOnBoard: ruggedSet.has(addr),
    });
  }
  return out;
}

/**
 * The pool each ledger token's newest row on the page assessed first, made
 * readable in the browser. V4 needs its key, which only `v4_pools` holds; a V4
 * pool with no stored key is skipped for the next assessed pool, never guessed.
 */
export async function ledgerPoolsForEntries(
  entries: readonly Pick<VerdictRow, "token_address" | "checks">[]
): Promise<Record<string, LedgerPools>> {
  const refsByToken = new Map<string, ReturnType<typeof assessedPoolRefs>>();
  for (const e of entries) {
    const token = e.token_address.toLowerCase();
    if (!refsByToken.has(token)) refsByToken.set(token, assessedPoolRefs(e.checks));
  }
  const ids = [...refsByToken.values()].flat().flatMap((r) => (r.kind === "v4" ? [r.poolId] : []));
  const keys = new Map<string, typeof v4Pools.$inferSelect>();
  const conn = database();
  if (conn && ids.length > 0) {
    const rows = await conn.select().from(v4Pools).where(inArray(v4Pools.poolId, [...new Set(ids)]));
    for (const r of rows) keys.set(r.poolId.toLowerCase(), r);
  }

  const out: Record<string, LedgerPools> = {};
  for (const [token, refs] of refsByToken) {
    let target: LedgerPoolTarget | null = null;
    for (const ref of refs) {
      if (ref.kind !== "v4") { target = ref; break; }
      const k = keys.get(ref.poolId);
      if (k) {
        target = { kind: "v4", poolId: ref.poolId, currency0: k.currency0.toLowerCase(), currency1: k.currency1.toLowerCase(), hooks: k.hooks.toLowerCase() };
        break;
      }
    }
    out[token] = { target, otherPools: Math.max(0, refs.length - 1) };
  }
  return out;
}

/**
 * One archived verdict, scoped to its own token (§ ledger deep-link on
 * /scan/[address]?v=<id>). The token_address match is load-bearing: it stops
 * an id belonging to a different token from being rendered under this
 * address's URL, rather than trusting the id alone.
 */
export async function verdictRowById(
  id: number,
  tokenAddress?: string | null
): Promise<CanonicalVerdictRow | null> {

  if (id == null || isNaN(id)) return null;

  const conn = database();
  if (!conn) return null;

  const conditions = [eq(verdicts.id, id)];
  if (tokenAddress) {
    conditions.push(eq(verdicts.tokenAddress, tokenAddress.toLowerCase()));
  }

  const rows = await conn
    .select()
    .from(verdicts)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ? mapVerdictRow(rows[0]) : null;
}

/**
 * Paginated query for the public ledger feed.
 */
export async function queryLedgerFeed(options: {
  cursor?: number | null;
  token?: string | null;
  search?: string | null;
  limit?: number;
}): Promise<{ entries: CanonicalVerdictRow[]; nextCursor: number | null }> {
  const conn = database();
  if (!conn) return { entries: [], nextCursor: null };

  const limit = options.limit ?? 20;
  const conditions = [];

  if (options.token) {
    conditions.push(eq(verdicts.tokenAddress, options.token.toLowerCase()));
  }

  if (options.cursor != null) {
    conditions.push(lt(verdicts.id, options.cursor));
  }

  if (options.search) {
    const q = options.search.trim().slice(0, 64);
    const qEscaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
    if (/^0x[0-9a-f]*$/i.test(q)) {
      conditions.push(ilike(verdicts.tokenAddress, `%${qEscaped}%`));
    } else {
      conditions.push(
        or(
          ilike(verdicts.tokenSymbol, `%${qEscaped}%`),
          ilike(verdicts.tokenName, `%${qEscaped}%`)
        )!
      );
    }
  }

  const rows = await conn
    .select()
    .from(verdicts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(verdicts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const entries = resultRows.map(mapVerdictRow);
  const nextCursor = hasMore ? entries[entries.length - 1].id : null;

  return { entries, nextCursor };
}

export async function getLatestGlobalVerdictHash(): Promise<string | null> {
  const conn = database();
  if (!conn) return null;

  const heads = await conn
    .select({ entryHash: verdicts.entryHash })
    .from(verdicts)
    .orderBy(desc(verdicts.id))
    .limit(1);

  return heads[0]?.entryHash ?? null;
}

export async function insertVerdict(values: typeof verdicts.$inferInsert): Promise<CanonicalVerdictRow | null> {
  const conn = database();
  if (!conn) return null;

  const inserted = await conn
    .insert(verdicts)
    .values(values)
    .returning();

  const r = inserted[0];
  return r ? mapVerdictRow(r) : null;
}

export async function incrementVerdictsIssued(updatedAtIso: string): Promise<void> {
  const conn = database();
  if (!conn) return;

  const stats = await conn
    .select({ value: compareStats.value })
    .from(compareStats)
    .where(eq(compareStats.key, "verdicts_issued"))
    .limit(1);

  if (stats[0]) {
    await conn
      .update(compareStats)
      .set({ value: stats[0].value + 1, updatedAt: updatedAtIso })
      .where(eq(compareStats.key, "verdicts_issued"));
  }
}

export async function queryAdminLedgerVerdicts(
  tokenFilter?: string,
  /** Cursor: verdicts with id strictly below this. */
  beforeId?: number | null,
): Promise<Array<{
  id: number;
  token_symbol: string | null;
  token_address: string;
  score: number;
  tier: string;
  score_version: string;
  entry_hash: string;
  anchor_tx: string | null;
  created_at: string;
}>> {
  const conn = database();
  if (!conn) return [];

  const conditions = [];
  if (tokenFilter?.trim()) {
    conditions.push(ilike(verdicts.tokenAddress, `%${tokenFilter.trim()}%`));
  }
  if (beforeId && Number.isSafeInteger(beforeId) && beforeId > 0) conditions.push(lt(verdicts.id, beforeId));

  const rows = await conn
    .select({
      id: verdicts.id,
      tokenSymbol: verdicts.tokenSymbol,
      tokenAddress: verdicts.tokenAddress,
      score: verdicts.score,
      tier: verdicts.tier,
      scoreVersion: verdicts.scoreVersion,
      entryHash: verdicts.entryHash,
      anchorTx: verdicts.anchorTx,
      createdAt: verdicts.createdAt,
    })
    .from(verdicts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(verdicts.id))
    .limit(100);

  return rows.map((r) => ({
    id: Number(r.id),
    token_symbol: r.tokenSymbol ?? null,
    token_address: r.tokenAddress,
    score: r.score,
    tier: r.tier,
    score_version: r.scoreVersion,
    entry_hash: r.entryHash,
    anchor_tx: r.anchorTx ?? null,
    created_at: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));
}
