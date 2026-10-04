import { eq, gt, gte, inArray, isNull, and, desc, asc, count, sql} from "drizzle-orm";
import { database } from "@/lib/db/client";
import { deployers, tokens, rugs, walletStains, walletHubs, walletEdges, slowRugWatch, tokenMarks, verdicts, marketSnapshots, compareStats } from "@/lib/db/schema";
import type { DeployerRow, LineageEdge, OperatorRug, WalletStain } from "@/lib/types";
import { SHARED_FUNDER_MAX_FUNDEES } from "@/lib/config/lineage";
import { fromNumericString } from "@/lib/data/numeric";
import { findFunder } from "@/lib/lineage/trace";
import { reportError } from "@/lib/observability/reporter";
// Type only, so nothing from the swap feature is linked in: the shape IS the endpoint's wire
// contract, and one declaration is the point.
import type { TokenIndictmentFacts } from "@/lib/swap/types";

/**
 * What the deployer took from the pool, rather than pool TVL lost.
 * Prefers measured operatorTakeUsd (finite >= 0); falls back to takeCeilingUsd.
 */
export function operatorTakeUsd(
  evidence: unknown,
): { usd: number; measured: boolean } | null {
  if (!evidence || typeof evidence !== "object") return null;
  const rec = evidence as Record<string, unknown>;

  const measured = rec.operatorTakeUsd;
  if (typeof measured === "number" && Number.isFinite(measured) && measured >= 0) {
    return { usd: measured, measured: true };
  }

  const ceiling = rec.takeCeilingUsd;
  if (typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling >= 0) {
    return { usd: ceiling, measured: false };
  }

  return null;
}

export function aggregateOperatorTake(
  rugList: Array<{ evidence: unknown }>,
): { taken_usd: number | null; taken_is_ceiling: boolean } {
  let sum = 0;
  let hasUsable = false;
  let hasCeiling = false;

  for (const r of rugList) {
    const take = operatorTakeUsd(r.evidence);
    if (take !== null) {
      hasUsable = true;
      sum += take.usd;
      if (!take.measured) {
        hasCeiling = true;
      }
    }
  }

  if (!hasUsable) {
    return { taken_usd: null, taken_is_ceiling: false };
  }

  return { taken_usd: sum, taken_is_ceiling: hasCeiling };
}

/** Pure half of `readOperatorRugs`: which deployer pairs a shared upstream wallet may join. */
export function linkOperatorPairs(
  mine: readonly { dep: string; via: string }[],
  others: readonly { dep: string; via: string }[],
  hubs: ReadonlySet<string>,
  fanoutBy: ReadonlyMap<string, number>,
  maxFundees: number = SHARED_FUNDER_MAX_FUNDEES,
): { dep: string; other: string; via: string }[] {
  const pairs: { dep: string; other: string; via: string }[] = [];
  const seen = new Set<string>();
  for (const m of mine) {
    const via = m.via.toLowerCase();
    if (hubs.has(via) || (fanoutBy.get(via) ?? 0) > maxFundees) continue;
    for (const o of others) {
      const dep = m.dep.toLowerCase();
      const other = o.dep.toLowerCase();
      const key = `${dep}|${other}|${via}`;
      if (o.via.toLowerCase() !== via || other === dep || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ dep, other, via });
    }
  }
  return pairs;
}

/**
 * L177: indicted deployers that share an upstream funder with each of `deployerAddresses`.
 * HONOR and DOOS were one operator (0x238e61fa… funded both) and the board never joined them.
 * A shared wallet links only when it is not a registered hub and our stored edges show it
 * paid at most SHARED_FUNDER_MAX_FUNDEES wallets, or it would join everyone a CEX paid.
 */
export async function readOperatorRugs(deployerAddresses: readonly string[]): Promise<Map<string, OperatorRug[]>> {
  const out = new Map<string, OperatorRug[]>();
  const conn = database();
  const subjects = [...new Set(deployerAddresses.map((a) => a.toLowerCase()))];
  if (!conn || subjects.length === 0) return out;

  const mine = await conn
    .select({ dep: walletStains.originDeployer, via: walletStains.address })
    .from(walletStains)
    .where(and(inArray(walletStains.originDeployer, subjects), eq(walletStains.active, true), eq(walletStains.direction, "upstream")));
  const vias = [...new Set(mine.map((m) => m.via.toLowerCase()))];
  if (vias.length === 0) return out;

  const [others, hubs, fanout] = await Promise.all([
    conn
      .select({ dep: walletStains.originDeployer, via: walletStains.address })
      .from(walletStains)
      .innerJoin(deployers, eq(deployers.address, walletStains.originDeployer))
      .where(and(inArray(walletStains.address, vias), eq(walletStains.active, true), eq(walletStains.direction, "upstream"), gt(deployers.confirmedRugs, 0))),
    conn.select({ address: walletHubs.address }).from(walletHubs).where(inArray(walletHubs.address, vias)),
    conn
      .select({ funder: walletEdges.funder, n: sql<number>`count(distinct ${walletEdges.fundee})::int` })
      .from(walletEdges)
      .where(inArray(walletEdges.funder, vias))
      .groupBy(walletEdges.funder),
  ]);
  const pairs = linkOperatorPairs(
    mine,
    others,
    new Set(hubs.map((h) => h.address.toLowerCase())),
    new Map(fanout.map((f) => [f.funder.toLowerCase(), Number(f.n)])),
  );
  if (pairs.length === 0) return out;

  const otherDeps = [...new Set(pairs.map((p) => p.other))];
  const rugRows = await conn
    .select({ deployer: deployers.address, token: tokens.address, ruggedAt: rugs.ruggedAt, createdAt: rugs.createdAt })
    .from(rugs)
    .innerJoin(deployers, eq(deployers.id, rugs.deployerId))
    .leftJoin(tokens, eq(tokens.id, rugs.tokenId))
    .where(inArray(deployers.address, otherDeps));
  const tokenAddrs = rugRows.map((r) => r.token).filter((t): t is string => !!t);
  const symbols = new Map<string, string | null>();
  if (tokenAddrs.length > 0) {
    const labelRows = await conn
      .selectDistinctOn([verdicts.tokenAddress], { token: verdicts.tokenAddress, symbol: verdicts.tokenSymbol })
      .from(verdicts)
      .where(inArray(verdicts.tokenAddress, tokenAddrs))
      .orderBy(verdicts.tokenAddress, desc(verdicts.createdAt));
    for (const l of labelRows) symbols.set(l.token.toLowerCase(), l.symbol ?? null);
  }

  for (const p of pairs) {
    const list = out.get(p.dep) ?? [];
    for (const r of rugRows.filter((x) => x.deployer.toLowerCase() === p.other)) {
      if (list.some((x) => x.deployer === p.other && x.token_address === (r.token ?? null))) continue;
      list.push({
        deployer: p.other,
        token_address: r.token ?? null,
        token_symbol: r.token ? (symbols.get(r.token.toLowerCase()) ?? null) : null,
        rugged_at: r.ruggedAt ? new Date(r.ruggedAt).toISOString() : r.createdAt ? new Date(r.createdAt).toISOString() : null,
        via: p.via,
      });
    }
    list.sort((a, b) => (a.rugged_at ?? "").localeCompare(b.rugged_at ?? ""));
    out.set(p.dep, list);
  }
  return out;
}

export function mapDeployerRow(r: typeof deployers.$inferSelect): DeployerRow {
  return {
    id: Number(r.id),
    address: r.address,
    funder_address: r.funderAddress,
    launches_total: r.launchesTotal ?? 0,
    launches_dead: r.launchesDead ?? 0,
    confirmed_rugs: r.confirmedRugs ?? 0,
    taken_usd: null,
    taken_is_ceiling: false,
    operator_rugs: [],
    last_seen_block: r.lastSeenBlock != null ? Number(r.lastSeenBlock) : null,
    updated_at: r.updatedAt ? new Date(r.updatedAt).toISOString() : new Date().toISOString(),
  };
}

export async function readIndictedDeployers(
  limit = 100
): Promise<DeployerRow[]> {
  const conn = database();
  if (!conn) return [];

  const rows = await conn
    .select()
    .from(deployers)
    .where(gt(deployers.confirmedRugs, 0))
    .orderBy(desc(deployers.confirmedRugs))
    .limit(limit);

  // Launch tallies live-counted over the tokens we hold. The columns are
  // refreshed only inside processRugCandidate, so a deployer indicted later
  // than its last ingest (or never reprocessed) disagrees with the tokens
  // table — on prod 45 of 48 rows did, one of them 51 tokens against a 0.
  // The board renders the DEAD LAUNCHES column straight from this, so a stale
  // 0 is a published all-clear. The columns stay in the schema for the
  // /admin/ledger surface; no reader that publishes derives from them anymore.
  //
  // Operator take summed live over rugs evidence instead of reading stale
  // deployers.extracted_usd (which drifts on supersession and is TVL lost).
  const ids = rows.map((r) => Number(r.id));
  const counts = new Map<number, { total: number; dead: number }>();
  const takes = new Map<number, { taken_usd: number | null; taken_is_ceiling: boolean }>();
  if (ids.length) {
    const [countRows, rugRows] = await Promise.all([
      conn
        .select({
          deployerId: tokens.deployerId,
          total: count(),
          dead: sql<number>`count(*) filter (where ${tokens.isDead})`,
        })
        .from(tokens)
        .where(inArray(tokens.deployerId, ids))
        .groupBy(tokens.deployerId),
      conn
        .select({
          deployerId: rugs.deployerId,
          evidence: rugs.evidence,
        })
        .from(rugs)
        .where(inArray(rugs.deployerId, ids)),
    ]);
    for (const c of countRows) {
      if (c.deployerId != null) {
        counts.set(Number(c.deployerId), { total: Number(c.total), dead: Number(c.dead) });
      }
    }
    const rugsByDeployer = new Map<number, Array<{ evidence: unknown }>>();
    for (const rug of rugRows) {
      const depId = Number(rug.deployerId);
      const list = rugsByDeployer.get(depId) ?? [];
      list.push(rug);
      rugsByDeployer.set(depId, list);
    }
    for (const id of ids) {
      const depRugs = rugsByDeployer.get(id);
      if (depRugs && depRugs.length > 0) {
        takes.set(id, aggregateOperatorTake(depRugs));
      } else {
        takes.set(id, { taken_usd: null, taken_is_ceiling: false });
      }
    }
  }

  const operatorRugs = await readOperatorRugs(rows.map((r) => r.address)).catch(async (error) => {
    // Best-effort: a failed link read hides the field, it never invents or removes a rug.
    await reportError({ code: "RC_LINEAGE_TRACE_FAILED", message: "operator link read failed", operation: "wanted.readOperatorRugs", error });
    return new Map<string, OperatorRug[]>();
  });

  return rows.map((r) => {
    const mapped = mapDeployerRow(r);
    const live = counts.get(Number(r.id));
    const take = takes.get(Number(r.id)) ?? { taken_usd: null, taken_is_ceiling: false };
    const base = live ? { ...mapped, launches_total: live.total, launches_dead: live.dead } : { ...mapped, launches_total: 0, launches_dead: 0 };
    return { ...base, ...take, operator_rugs: operatorRugs.get(r.address.toLowerCase()) ?? [] };
  });
}

export async function readIndictedStats(): Promise<{
  deployers: DeployerRow[];
  indictedCount: number;
  webCounts: Map<string, number>;
}> {
  const conn = database();
  if (!conn) return { deployers: [], indictedCount: 0, webCounts: new Map() };

  const [dRows, statRows, stainRows] = await Promise.all([
    readIndictedDeployers(100),
    conn
      .select({ value: compareStats.value })
      .from(compareStats)
      .where(eq(compareStats.key, "wallets_indicted"))
      .limit(1),
    conn
      .select({ originDeployer: walletStains.originDeployer })
      .from(walletStains)
      .where(eq(walletStains.active, true)),
  ]);

  const webCounts = new Map<string, number>();
  for (const s of stainRows) {
    const k = s.originDeployer.toLowerCase();
    webCounts.set(k, (webCounts.get(k) ?? 0) + 1);
  }

  const indictedCount = statRows[0]?.value ? Number(statRows[0].value) : dRows.length;

  return { deployers: dRows, indictedCount, webCounts };
}

export interface FamilyTreeNode {
  id: number;
  address: string;
  symbol: string | null;
  name: string | null;
  is_dead: boolean;
  deploy_block: number | null;
  rugged: boolean;
  /** Latest stored verdict for this token, when one exists — lets the tree
   *  link a deploy to the scan that judged it instead of only offering a
   *  re-scan. Null means never scanned, which is NOT the same as clean. */
  tier: string | null;
  score: number | null;
  /** Live pool state, never evidence of who held liquidity when a rug occurred. */
  currentWalletShare?: { pct: number; asOfBlock: number; pool: string };
  /** Saved verdict pool used only to request a separate current custody read. */
  savedPrimaryPool?: string | null;
}

export async function readDeployerFamilyTree(
  deployerAddress: string,
): Promise<{
  takenUsd: number | null;
  takenIsCeiling: boolean;
  operatorRugs: OperatorRug[];
  confirmedRugs: number;
  funderAddress: string | null;
  nodes: FamilyTreeNode[];
  stains: WalletStain[];
} | null> {
  const conn = database();
  if (!conn) return null;

  const addr = deployerAddress.toLowerCase();

  const depRows = await conn
    .select()
    .from(deployers)
    .where(eq(deployers.address, addr))
    .limit(1);

  const dep = depRows[0];
  if (!dep) return null;

  const depId = Number(dep.id);

  const [tokenRows, rugRows, stainRows, funderRow] = await Promise.all([
    conn
      .select()
      .from(tokens)
      .where(eq(tokens.deployerId, depId))
      .orderBy(asc(tokens.deployBlock)),
    conn
      .select({ tokenId: rugs.tokenId, evidence: rugs.evidence })
      .from(rugs)
      .where(eq(rugs.deployerId, depId)),
    conn
      .select()
      .from(walletStains)
      .where(and(eq(walletStains.originDeployer, addr), eq(walletStains.active, true)))
      .orderBy(asc(walletStains.hops)),
    // Same coalesce the scanner's funder reads use (`readFunderHistory`):
    // `funder_address` is written only at rug ingestion, `wallet_edges` by
    // every lineage trace. Pointing the board at the raw column alone is why
    // 46 of 48 family trees rendered "WE COULD NOT FIND ONE" for funders we
    // know. One source of truth, not a second derivation that drifts (§8 #7).
    readFunderHistory(addr),
  ]);

  const take = aggregateOperatorTake(rugRows);
  const ruggedIds = new Set(rugRows.map((r) => Number(r.tokenId)));

  // `tokens.name`/`tokens.symbol` are written by nobody — both writers
  // (recordCloneData, processRugCandidate) insert address + deployer only, so
  // every family tree rendered "UNKNOWN" for every deploy. `verdicts` has
  // carried token_name/token_symbol all along (100% coverage on the current
  // ledger), so read the label from the scan that produced it rather than
  // adding a second metadata fetch. Latest verdict wins: a token can be
  // rescanned, and a rename should follow the most recent judgement.
  const addrs = tokenRows.map((t) => t.address);
  const labels = new Map<string, { name: string | null; symbol: string | null; tier: string | null; score: number | null; primaryPoolAddress: string | null }>();
  if (addrs.length) {
    const vRows = await conn
      .select({
        tokenAddress: verdicts.tokenAddress,
        tokenName: verdicts.tokenName,
        tokenSymbol: verdicts.tokenSymbol,
        tier: verdicts.tier,
        score: verdicts.score,
        primaryPoolAddress: verdicts.primaryPoolAddress,
        createdAt: verdicts.createdAt,
      })
      .from(verdicts)
      .where(inArray(verdicts.tokenAddress, addrs))
      .orderBy(asc(verdicts.createdAt));
    // Ascending, so the last write per address is the newest verdict.
    for (const v of vRows) {
      labels.set(v.tokenAddress, {
        name: v.tokenName ?? null,
        symbol: v.tokenSymbol ?? null,
        tier: v.tier ?? null,
        score: v.score != null ? Number(v.score) : null,
        primaryPoolAddress: v.primaryPoolAddress?.toLowerCase() ?? null,
      });
    }
  }

  const nodes: FamilyTreeNode[] = tokenRows.map((t) => {
    const label = labels.get(t.address);
    return {
      id: Number(t.id),
      address: t.address,
      // Prefer the column if it is ever populated; fall back to the verdict.
      symbol: t.symbol || label?.symbol || null,
      name: t.name || label?.name || null,
      is_dead: t.isDead,
      deploy_block: t.deployBlock ? Number(t.deployBlock) : null,
      rugged: ruggedIds.has(Number(t.id)),
      tier: label?.tier ?? null,
      score: label?.score ?? null,
      savedPrimaryPool: label?.primaryPoolAddress ?? null,
    };
  });

  const stains: WalletStain[] = stainRows.map((s) => ({
    address: s.address,
    originDeployer: s.originDeployer,
    hops: s.hops as 1 | 2,
    direction: s.direction as "upstream" | "downstream",
    path: (s.path as LineageEdge[]) ?? [],
    active: s.active,
    liftedReason: s.liftedReason ?? null,
  }));

  return {
    takenUsd: take.taken_usd,
    takenIsCeiling: take.taken_is_ceiling,
    operatorRugs: (await readOperatorRugs([addr]).catch(() => new Map<string, OperatorRug[]>())).get(addr) ?? [],
    confirmedRugs: dep.confirmedRugs ?? 0,
    // wallet_edges first, stored column as fallback — never the column alone.
    funderAddress: funderRow?.funder ?? dep.funderAddress ?? null,
    nodes,
    stains,
  };
}

export async function assembleRugCandidatesData(
  limit = 100
): Promise<{
  watchRows: Array<{
    tokenAddress: string;
    reason: string;
    peakLiquidityUsd: number | null;
    currentLiquidityUsd: number | null;
  }>;
  markRows: Array<{ tokenAddress: string }>;
  /** Tokens whose ledger already holds an attributed deployer pull (criterion A). */
  pullRows: Array<{ tokenAddress: string }>;
  /**
   * L194 — nominated suspects the limit cut before the judge ever saw them.
   * A count, not silence: the board's job is to list offenders, so one it
   * never looked at has to be visible somewhere.
   */
  nominationsTruncated: number;
  tokenRows: Array<{ address: string; deployerAddress: string | null }>;
  verdictRows: Array<{
    tokenAddress: string;
    checks: any;
    marketSnapshot: any;
    createdAt: string;
    id: number;
  }>;
  snapRows: Array<{
    tokenAddress: string;
    liquidityUsd: number | null;
    ts: string;
  }>;
}> {
  const drainReasons = ["liquidity-drain", "pump-dump"];

  const conn = database();
  if (!conn) {
    // No database is not "nothing was cut" — but it is also not a truncation,
    // and the empty rows above already say we could not look (§4).
    return {
      watchRows: [],
      markRows: [],
      pullRows: [],
      nominationsTruncated: 0,
      tokenRows: [],
      verdictRows: [],
      snapRows: [],
    };
  }

  const [wRows, mRows, pRows] = await Promise.all([
    conn
      .select({
        tokenAddress: slowRugWatch.tokenAddress,
        reason: slowRugWatch.reason,
        peakLiquidityUsd: slowRugWatch.peakLiquidityUsd,
        currentLiquidityUsd: slowRugWatch.currentLiquidityUsd,
      })
      .from(slowRugWatch)
      .where(and(inArray(slowRugWatch.reason, drainReasons), eq(slowRugWatch.cleared, false)))
      .orderBy(desc(slowRugWatch.updatedAt))
      .limit(limit),
    conn
      .select({ tokenAddress: tokenMarks.tokenAddress })
      .from(tokenMarks)
      .where(and(eq(tokenMarks.kind, "honeypot"), isNull(tokenMarks.liftedAt)))
      // Ordered so the same 100 marks come back each run. Without it, which
      // marks reach the board is whatever the planner returns first (L194).
      .orderBy(desc(tokenMarks.createdAt))
      .limit(limit),
    // Criterion A's own nomination source. The board assembled from The Watch
    // (criterion C's evidence) and honeypot marks (B's) only — so a token whose
    // ledger held a recorded pull and neither of those never reached the judge.
    // With C retired as an indictment source (RUG_CRITERIA_VERSION 0.3) and the
    // V3/V4 pull legs landed (L61), that gap is the whole of criterion A on this
    // chain: a deployer who pulled once, cleanly, was nominated by nothing.
    conn.execute<Record<string, unknown>>(sql`
      select distinct token_address
      from verdicts v, jsonb_array_elements(v.checks) c
      where c->>'id' = 'deployer_pulled_liquidity'
        and jsonb_array_length(coalesce(c->'evidence'->'attributedPulls', '[]'::jsonb)) > 0
      limit ${limit}
    `),
  ]);

  const watchRows = wRows.map((r) => ({
    tokenAddress: r.tokenAddress,
    reason: r.reason,
    // Zero is the terminal drain state, not missing data. A truthiness guard
    // here nulled it out, and the producer then skipped the token as
    // "no liquidity history" — dropping the most certain rugs off the board.
    peakLiquidityUsd: fromNumericString(r.peakLiquidityUsd),
    currentLiquidityUsd: fromNumericString(r.currentLiquidityUsd),
  }));

  const markRows = mRows.map((r) => ({ tokenAddress: r.tokenAddress }));

  const pList: Record<string, unknown>[] = Array.isArray(pRows)
    ? (pRows as Record<string, unknown>[])
    : ((pRows as { rows?: Record<string, unknown>[] }).rows ?? []);
  const pullRows = pList.map((r) => ({ tokenAddress: String(r.token_address) }));

  // L194 — each source above fetches up to `limit` on its own, so the union can
  // be three times the budget and this cut decides WHO the judge ever sees.
  // Ordered by the strength of the nomination, not by which query was
  // concatenated first: a recorded pull (criterion A) and a standing honeypot
  // mark (B) are direct evidence, while a drain-only Watch row (C) is retired
  // as an indictment source and can fill the whole budget on volume alone.
  // Identical output whenever the cap does not bite, since this is an order.
  const nominated = [
    ...new Set([
      ...pullRows.map((p) => p.tokenAddress),
      ...markRows.map((m) => m.tokenAddress),
      ...watchRows.map((w) => w.tokenAddress),
    ]),
  ];
  const candidateAddrs = nominated.slice(0, limit);
  const nominationsTruncated = nominated.length - candidateAddrs.length;

  if (candidateAddrs.length === 0) {
    return {
      watchRows,
      markRows,
      pullRows,
      nominationsTruncated,
      tokenRows: [],
      verdictRows: [],
      snapRows: [],
    };
  }

  const [tRows, vRows, sRows] = await Promise.all([
    conn
      .select({
        address: tokens.address,
        deployerAddress: deployers.address,
      })
      .from(tokens)
      .leftJoin(deployers, eq(tokens.deployerId, deployers.id))
      .where(inArray(tokens.address, candidateAddrs)),
    conn
      .select({
        tokenAddress: verdicts.tokenAddress,
        checks: verdicts.checks,
        marketSnapshot: verdicts.marketSnapshot,
        createdAt: verdicts.createdAt,
        id: verdicts.id,
      })
      .from(verdicts)
      .where(inArray(verdicts.tokenAddress, candidateAddrs))
      .orderBy(desc(verdicts.id)),
    conn
      .select({
        tokenAddress: marketSnapshots.tokenAddress,
        liquidityUsd: marketSnapshots.liquidityUsd,
        ts: marketSnapshots.ts,
      })
      .from(marketSnapshots)
      .where(inArray(marketSnapshots.tokenAddress, candidateAddrs))
      .orderBy(desc(marketSnapshots.ts))
      .limit(5000),
  ]);

  return {
    watchRows,
    markRows,
    pullRows,
    nominationsTruncated,
    tokenRows: tRows.map((r) => ({
      address: r.address,
      deployerAddress: r.deployerAddress ?? null,
    })),
    verdictRows: vRows.map((r) => ({
      tokenAddress: r.tokenAddress,
      checks: r.checks,
      marketSnapshot: r.marketSnapshot,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
      id: Number(r.id),
    })),
    snapRows: sRows.map((r) => ({
      tokenAddress: r.tokenAddress,
      liquidityUsd: fromNumericString(r.liquidityUsd),
      ts: r.ts ? new Date(r.ts).toISOString() : new Date().toISOString(),
    })),
  };
}

export async function upsertDeployerRecord(
  address: string
): Promise<number | null> {
  const normAddress = address.toLowerCase();
  const nowIso = new Date().toISOString();

  const conn = database();
  if (!conn) return null;

  try {
    const [inserted] = await conn
      .insert(deployers)
      .values({
        address: normAddress,
        updatedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: deployers.address,
        set: {
          updatedAt: nowIso,
        },
      })
      .returning({ id: deployers.id });

    return inserted?.id ? Number(inserted.id) : null;
  } catch (error: any) {
    console.error("upsertDeployerRecord failed:", error.message);
    return null;
  }
}

export async function readDeployerSummary(
  address: string
): Promise<{ launches_dead: number; confirmed_rugs: number; funder_address: string | null; launches_total: number } | null> {
  const norm = address.toLowerCase();

  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select({
      launches_dead: deployers.launchesDead,
      confirmed_rugs: deployers.confirmedRugs,
      funder_address: deployers.funderAddress,
      // A4 (KNOWN-PROBLEMS L58) — eventually-consistent with
      // refreshDeployerLaunchCounts, same tradeoff already accepted for
      // launches_dead/confirmed_rugs above: reused rather than live-counted.
      launches_total: deployers.launchesTotal,
    })
    .from(deployers)
    .where(eq(deployers.address, norm))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    launches_dead: r.launches_dead ?? 0,
    confirmed_rugs: r.confirmed_rugs ?? 0,
    funder_address: r.funder_address ?? null,
    launches_total: r.launches_total ?? 0,
  };
}

/**
 * The confirmed-rug row for THIS token.
 *
 * Deliberately separate from the deployer tallies: `deployers.confirmed_rugs`
 * counts every token that wallet made INCLUDING the one being scanned, so it
 * can never answer "is the token in front of us a rug". All three ruggers on
 * file have exactly one launch, so before this existed every rug citation in a
 * verdict was the token being offered as evidence against itself.
 */
export async function readTokenRugRecord(tokenAddress: string): Promise<{
  ruggedAt: string | null;
  extractedUsd: number | null;
  criteriaVersion: string | null;
} | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select({
      ruggedAt: rugs.ruggedAt,
      extractedUsd: rugs.extractedUsd,
      criteriaVersion: rugs.criteriaVersion,
    })
    .from(rugs)
    .innerJoin(tokens, eq(tokens.id, rugs.tokenId))
    .where(eq(tokens.address, tokenAddress.toLowerCase()))
    .orderBy(desc(rugs.id))
    .limit(1);

  const r = rows[0];
  if (!r) return null;
  return {
    ruggedAt: r.ruggedAt ? new Date(r.ruggedAt).toISOString() : null,
    extractedUsd: fromNumericString(r.extractedUsd),
    criteriaVersion: r.criteriaVersion ?? null,
  };
}

/**
 * A subject's launches and rugs EXCLUDING the token being scanned — the only
 * counts a sentence with the word "prior" in it may be built from.
 */
export async function readDeployerPriorHistory(
  deployerAddress: string,
  excludeTokenAddress: string,
): Promise<{ launchesTotal: number; launchesDead: number; confirmedRugs: number } | null> {
  const conn = database();
  if (!conn) return null;

  const dep = deployerAddress.toLowerCase();
  const excl = excludeTokenAddress.toLowerCase();
  const res = await conn.execute<Record<string, unknown>>(sql`
    select
      (select count(*) from tokens t join deployers d on d.id = t.deployer_id
         where d.address = ${dep} and t.address <> ${excl}) as launches_total,
      (select count(*) from tokens t join deployers d on d.id = t.deployer_id
         where d.address = ${dep} and t.address <> ${excl} and t.is_dead) as launches_dead,
      (select count(distinct r.token_id) from rugs r
         join deployers d on d.id = r.deployer_id
         left join tokens t on t.id = r.token_id
         where d.address = ${dep} and coalesce(t.address, '') <> ${excl}) as confirmed_rugs
  `);
  const list: Record<string, unknown>[] = Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
  const r = list[0];
  if (!r) return null;
  return {
    launchesTotal: Number(r.launches_total ?? 0),
    launchesDead: Number(r.launches_dead ?? 0),
    confirmedRugs: Number(r.confirmed_rugs ?? 0),
  };
}

/**
 * The wallet that funded this deployer, and what we know about IT.
 *
 * Reads `wallet_edges` first: `deployers.funder_address` is only ever written
 * by rug ingestion, so it is filled for confirmed ruggers and almost nobody
 * else, while the edge cache is written by every scan's lineage trace. On prod
 * that is the difference between 2 known funders and 19.
 *
 * `fanOut` is carried because a funder is a shared surface exactly as a deployer
 * can be (§8 #19, one layer out): the busiest funder on this chain has 27
 * fundees and is a withdrawal wallet, not a financier.
 */
export async function readFunderHistory(deployerAddress: string): Promise<{
  funder: string;
  fanOut: number;
  confirmedRugs: number;
  launchesDead: number;
} | null> {
  const conn = database();
  if (!conn) return null;

  const dep = deployerAddress.toLowerCase();
  const res = await conn.execute<Record<string, unknown>>(sql`
    with f as (
      select coalesce(
        (select e.funder from wallet_edges e where e.fundee = ${dep} order by e.id asc limit 1),
        (select d.funder_address from deployers d where d.address = ${dep})
      ) as funder
    )
    select
      f.funder,
      (select count(distinct e2.fundee) from wallet_edges e2 where e2.funder = f.funder) as fan_out,
      coalesce((select d2.confirmed_rugs from deployers d2 where d2.address = f.funder), 0) as confirmed_rugs,
      -- Live-counted, not the deployers column: that is refreshed only inside
      -- processRugCandidate, so it reads 0 for any funder never processed as a
      -- rugger. Same staleness the one-shot classification moved off (L58).
      (select count(*) from tokens t3 where t3.deployer_id = d2.id and t3.is_dead) as launches_dead
    from f
    left join deployers d2 on d2.address = f.funder
    where f.funder is not null
  `);
  const list: Record<string, unknown>[] = Array.isArray(res)
    ? (res as Record<string, unknown>[])
    : ((res as { rows?: Record<string, unknown>[] }).rows ?? []);
  const r = list[0];
  if (!r?.funder) return null;
  return {
    funder: String(r.funder),
    fanOut: Number(r.fan_out ?? 0),
    confirmedRugs: Number(r.confirmed_rugs ?? 0),
    launchesDead: Number(r.launches_dead ?? 0),
  };
}

export async function readDeployerByAddress(
  address: string
): Promise<DeployerRow | null> {
  const norm = address.toLowerCase();

  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(deployers)
    .where(eq(deployers.address, norm))
    .limit(1);

  if (!rows[0]) return null;
  const mapped = mapDeployerRow(rows[0]);
  const rugRows = await conn
    .select({ evidence: rugs.evidence })
    .from(rugs)
    .where(eq(rugs.deployerId, Number(rows[0].id)));
  const take = aggregateOperatorTake(rugRows);
  return { ...mapped, ...take };
}

/**
 * `tokens.is_dead` is read by the family tree ("DEAD POOL") and summed into the
 * board's DEAD LAUNCHES column, but no writer in this codebase ever set it —
 * so a wallet whose only deploy is a confirmed rug still reported 0 dead
 * launches. A rug bundle already measured the pool's collapse; use that
 * measurement rather than leaving the column permanently zero.
 *
 * Deliberately one-way: a pool that died can be refilled, but the launch it
 * belonged to still died, and un-setting this on a later reading would erase
 * exactly the history the board exists to remember.
 */
async function markRuggedTokenDead(
  conn: NonNullable<ReturnType<typeof database>>,
  tokenId: number | undefined,
  match: { evidence: Record<string, unknown> }
): Promise<void> {
  if (tokenId == null) return;
  const current = match.evidence?.currentLiquidityUsd;
  // Only assert death on a real measured collapse — never on a missing reading.
  if (typeof current !== "number" || current >= 1_000) return;
  await conn.update(tokens).set({ isDead: true }).where(eq(tokens.id, tokenId));
}

/** Recount a deployer's launches from the token rows we hold. Convergent. */
async function refreshDeployerLaunchCounts(
  conn: NonNullable<ReturnType<typeof database>>,
  deployerId: number
): Promise<void> {
  const [totalRow] = await conn
    .select({ n: count() })
    .from(tokens)
    .where(eq(tokens.deployerId, deployerId));
  const [deadRow] = await conn
    .select({ n: count() })
    .from(tokens)
    .where(and(eq(tokens.deployerId, deployerId), eq(tokens.isDead, true)));
  await conn
    .update(deployers)
    .set({ launchesTotal: Number(totalRow?.n ?? 0), launchesDead: Number(deadRow?.n ?? 0) })
    .where(eq(deployers.id, deployerId));
}

/** Replaces dollar figures with $N so figure-only movements do not retract claims. */
export function claimKey(reason: string): string {
  return reason.replace(/\$\d[\d,]*(?:\.\d+)?/g, "$N");
}

/** Pure retraction test: true when an old claim is absent from new reasons. */
export function reasonsRetracted(oldReasons: unknown, newReasons: string[]): boolean {
  if (!Array.isArray(oldReasons)) return false;
  const newKeys = new Set(newReasons.map(claimKey));
  return oldReasons.some((r) => typeof r === "string" && !newKeys.has(claimKey(r)));
}

export async function processRugCandidate(
  raw: { tokenAddress: string; deployer: string },
  match: { isRug: boolean; criteriaVersion: string; extractedUsd: number; reasons: string[]; evidence: Record<string, unknown> }
): Promise<boolean> {
  if (!match.isRug) return false;
  const deployerAddr = raw.deployer.toLowerCase();
  const tokenAddr = raw.tokenAddress.toLowerCase();

  const conn = database();
  if (!conn) return false;

  const nowIso = new Date().toISOString();

  // 1. upsert deployer
  await conn.insert(deployers).values({ address: deployerAddr }).onConflictDoNothing({ target: deployers.address });

  const depRows = await conn.select({ id: deployers.id, confirmedRugs: deployers.confirmedRugs, extractedUsd: deployers.extractedUsd, lastSeenBlock: deployers.lastSeenBlock, funderAddress: deployers.funderAddress }).from(deployers).where(eq(deployers.address, deployerAddr)).limit(1);
  const dep = depRows[0];
  if (!dep) return false;

  // KNOWN-PROBLEMS L70 — the Wanted board's "FUNDED BY" reads this column, and
  // nothing ever wrote it: `findFunder` runs on every scan for the
  // `funding_lineage` check, but its result fed only that check's PASS/FAIL and
  // was discarded. Best-effort, and ONLY on a non-null find: `findFunder`
  // returns null for two different reasons (genuinely unfunded, or the read was
  // ambiguous/incomplete — see its own doc comment), and a later ambiguous scan
  // must never overwrite an earlier, real answer with silence (§4).
  if (dep.funderAddress == null) {
    try {
      const info = await findFunder(deployerAddr);
      if (info) {
        await conn.update(deployers).set({ funderAddress: info.funder }).where(eq(deployers.id, dep.id));
      }
    } catch (err) {
      await reportError({
        code: "RC_LINEAGE_TRACE_FAILED",
        message: "best-effort funder resolution at indictment time failed; the rug row still stands",
        operation: "wanted.processRugCandidate.findFunder",
        error: err,
        details: { deployer: deployerAddr },
      });
    }
  }

  // 2. upsert token
  await conn.insert(tokens).values({ address: tokenAddr, deployerId: dep.id }).onConflictDoUpdate({ target: tokens.address, set: { deployerId: dep.id } });
  const tokRows = await conn.select({ id: tokens.id }).from(tokens).where(eq(tokens.address, tokenAddr)).limit(1);
  const tok = tokRows[0];

  // When the rug happened, taken from the earliest attributed pull. The columns
  // have existed since the table was created and nothing ever wrote them, so
  // every board row showed "LAST SEEN —" even when the evidence named the exact
  // block. Only a `found` probe can date the event; a drain has no single
  // moment, so those rows stay null and say so rather than guessing.
  const pulls = (match.evidence?.liquidityPulls ?? []) as { block?: number }[];
  const firstPullBlock = Array.isArray(pulls)
    ? pulls.map((p) => p?.block).filter((b): b is number => typeof b === "number").sort((a, b) => a - b)[0]
    : undefined;

  // 3. Re-evaluate rather than skip.
  //
  // This used to be `if (existingRows.length) return false` — write-once. A row
  // assembled from an early verdict could never be corrected by a later, better
  // one, which is exactly how PDT's bundle kept saying "no single pull, a
  // gradual drain" for ten days after a CRITICAL verdict recorded the pull tx.
  // Supersede when the new bundle is strictly better evidenced: the criteria
  // version moved, or the pull probe upgraded out of `unavailable`.
  const existingRows = await conn
    .select({ id: rugs.id, criteriaVersion: rugs.criteriaVersion, evidence: rugs.evidence })
    .from(rugs)
    .where(and(eq(rugs.deployerId, dep.id), eq(rugs.tokenId, tok?.id ?? -1)))
    .limit(1);

  const existing = existingRows[0];
  if (existing) {
    // These two are CONVERGENT — they set a value derived from evidence we
    // already hold, to the same value every time — so they run on every pass,
    // before the supersede test. Putting them behind that test made them
    // unreachable for any row already superseded once, which is precisely the
    // state a self-healing backfill needs to be able to repair.
    if (firstPullBlock != null && Number(dep.lastSeenBlock ?? 0) !== firstPullBlock) {
      await conn
        .update(deployers)
        .set({ lastSeenBlock: firstPullBlock, updatedAt: nowIso })
        .where(eq(deployers.id, dep.id));
    }
    await markRuggedTokenDead(conn, tok?.id, match);
    await refreshDeployerLaunchCounts(conn, dep.id);

    const oldProbe = (existing.evidence as { pullProbe?: string } | null)?.pullProbe ?? "unavailable";
    const newProbe = (match.evidence?.pullProbe as string | undefined) ?? "unavailable";
    const probeImproved = oldProbe === "unavailable" && newProbe !== "unavailable";
    const criteriaMoved = existing.criteriaVersion !== match.criteriaVersion;

    // A RETRACTION needs no version bump. Both tests above ask "is the new
    // bundle better evidenced", so both are blind to the case where the criteria
    // stopped being willing to say something they used to say — and
    // `RUG_CRITERIA_VERSION` is pinned in the production container, so the dial
    // meant to force re-evaluation cannot move at all from a deploy.
    //
    // That combination left $BLKFUEL's board row publishing "buyers could not
    // sell while liquidity was present" after criterion B was scoped to stop
    // saying it (KNOWN-PROBLEMS L16): correct code, unreachable row.
    //
    // Direction is what makes this safe. On the Wanted board the worst outcome
    // is a false ACCUSATION, not a missed one — the skill's step 2 says naming
    // the wrong wallet is the worst thing available — so dropping a sentence we
    // can no longer support is always the right way to be wrong. It is also
    // convergent: once rewritten the two agree and this stops firing.
    const oldReasons = (existing.evidence as { reasons?: unknown } | null)?.reasons;
    // L177: figure-only changes are not retractions.
    const claimRetracted = reasonsRetracted(oldReasons, match.reasons);

    if (!probeImproved && !criteriaMoved && !claimRetracted) return false;

    await conn
      .update(rugs)
      .set({
        criteriaVersion: match.criteriaVersion,
        extractedUsd: match.extractedUsd.toString(),
        evidence: { reasons: match.reasons, ...match.evidence },
        ...(firstPullBlock != null ? { ruggedBlock: firstPullBlock } : {}),
      })
      .where(eq(rugs.id, existing.id));

    // The deployer's aggregate counters are unchanged — this is the same rug,
    // re-described. Bumping confirmed_rugs here would double-count it.
    return false;
  }

  // 4. insert rug
  await conn.insert(rugs).values({
    deployerId: dep.id,
    tokenId: tok?.id ?? null,
    criteriaVersion: match.criteriaVersion,
    extractedUsd: match.extractedUsd.toString(),
    evidence: { reasons: match.reasons, ...match.evidence },
    ...(firstPullBlock != null ? { ruggedBlock: firstPullBlock } : {}),
  });

  await markRuggedTokenDead(conn, tok?.id, match);

  // 5. update deployer stats
  //
  // launches_total / launches_dead were never written by anything, so the board's
  // "DEAD LAUNCHES" column read 0 for a wallet whose only deploy is a confirmed
  // rug. Derive both from the rows we actually hold rather than leaving a column
  // that renders a number nobody computes.
  const newRugs = (dep.confirmedRugs ?? 0) + 1;
  const newExtracted = (Number(dep.extractedUsd ?? 0) + match.extractedUsd).toString();

  await conn.update(deployers).set({
    confirmedRugs: newRugs,
    extractedUsd: newExtracted,
    lastSeenBlock: firstPullBlock != null ? firstPullBlock : dep.lastSeenBlock,
    updatedAt: nowIso,
  }).where(eq(deployers.id, dep.id));
  await refreshDeployerLaunchCounts(conn, dep.id);

  return true;
}

export async function updateIndictedStatCount(): Promise<number> {
  const conn = database();
  if (!conn) return 0;

  const countRows = await conn.select({ count: count() }).from(deployers).where(gt(deployers.confirmedRugs, 0));
  const total = countRows[0]?.count ?? 0;

  await conn.insert(compareStats).values({
    key: "wallets_indicted",
    value: total,
    updatedAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: compareStats.key,
    set: { value: total, updatedAt: new Date().toISOString() },
  });

  return total;
}






/**
 * The Wanted-board cross-check for one token, for the sign-time disclosure.
 *
 * Returns null ONLY when there is no database to ask. Callers must not read that as
 * "nothing stands against this token": an empty read is not a fact (§8 #9, which is that
 * exact sentence published off a missing env var). `lib/swap/indictment.ts` is the caller
 * that turns null into "we could not look".
 */
export async function readTokenIndictment(
  tokenAddress: string,
): Promise<TokenIndictmentFacts | null> {
  const conn = database();
  if (!conn) return null;

  const addr = tokenAddress.toLowerCase();

  const [counts, markRows] = await Promise.all([
    conn.execute<Record<string, unknown>>(sql`
      select
        (select count(*) from tokens t where t.address = ${addr}) as token_known,
        (select count(*) from rugs r
           join tokens t on t.id = r.token_id
          where t.address = ${addr}) as token_rugs,
        (select d.address from tokens t
           join deployers d on d.id = t.deployer_id
          where t.address = ${addr} limit 1) as deployer,
        (select count(distinct t2.id) from tokens t2
           join rugs r on r.token_id = t2.id
          where t2.deployer_id = (select t.deployer_id from tokens t where t.address = ${addr} limit 1)
            and t2.address <> ${addr}) as deployer_other_rugs
    `),
    conn
      .selectDistinct({ kind: tokenMarks.kind })
      .from(tokenMarks)
      .where(and(eq(tokenMarks.tokenAddress, addr), isNull(tokenMarks.liftedAt))),
  ]);

  const list: Record<string, unknown>[] = Array.isArray(counts)
    ? (counts as Record<string, unknown>[])
    : ((counts as { rows?: Record<string, unknown>[] }).rows ?? []);
  const row = list[0] ?? {};

  return {
    tokenKnown: Number(row.token_known ?? 0) > 0,
    tokenRugs: Number(row.token_rugs ?? 0),
    activeMarkKinds: markRows.map((m) => m.kind).sort(),
    deployer: typeof row.deployer === "string" ? row.deployer.toLowerCase() : null,
    deployerOtherRugs: Number(row.deployer_other_rugs ?? 0),
  };
}
