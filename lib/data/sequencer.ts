import { and, asc, inArray, eq, gte, lte, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { database } from "@/lib/db/client";
import { launchEvents, launchTradeHourly, launches, sequencerBudgets, sequencerCheckpoints, sequencerExplorerSpend, sequencerMetrics, sequencerWork, v4Pools } from "@/lib/db/schema";
import { jsonSafe, textSafe, upsertStateReadingsWith, type HourlyTradeBucket } from "./launches";
import type { LaunchDraft, LifecycleDraft, V4PoolDraft, StateReading } from "@/lib/launches/types";

export type SequencerWork = { id: string; kind: "tx" | "gap" | "pons"; payload: Record<string, unknown>; attempts: number; availableAt: string };
export type SequencerMetric = { provider: string; event: string; reason?: string; count?: number; credits?: number; latencyMs?: number };
const MAX_LABEL = 120;
export function canReserveSequencerCredits(accountSpent: number, totalSpent: number, credits: number, limits: { accountDaily: number; totalDaily: number }): boolean { return Number.isSafeInteger(credits) && credits > 0 && credits <= limits.accountDaily && credits <= limits.totalDaily && accountSpent + credits <= limits.accountDaily && totalSpent + credits <= limits.totalDaily; }
const accountKey = (v: string) => createHash("sha256").update(v).digest("hex");
const clampLabel = (v: string) => v.replace(/[^\w.:-]/g, "_").slice(0, MAX_LABEL) || "unknown";

export function sanitizeSequencerError(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "unknown error");
  return raw.replace(/(?:https?|wss?):\/\/\S+/gi, "[url]").replace(/(api[-_ ]?key|token|authorization|secret|password)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[redacted]").replace(/0x[a-fA-F0-9]{32,}/g, "[hex]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]").replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

export async function enqueueSequencerWork(input: { id: string; kind: "tx" | "gap" | "pons"; payload: Record<string, unknown>; availableAt?: string }): Promise<void> {
  const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured");
  await conn.insert(sequencerWork).values({ id: input.id, kind: input.kind, payload: input.payload, availableAt: input.availableAt }).onConflictDoNothing();
}
export async function readSequencerWork(limit = 25, nowIso = new Date().toISOString(), kind?: SequencerWork["kind"]): Promise<SequencerWork[]> {
  const conn = database(); if (!conn) return [];
  const rows = await conn.select().from(sequencerWork).where(and(lte(sequencerWork.availableAt, nowIso), kind ? eq(sequencerWork.kind, kind) : undefined)).orderBy(asc(sequencerWork.availableAt), asc(sequencerWork.createdAt)).limit(Math.max(0, Math.min(250, Math.trunc(limit))));
  return rows.map((r) => ({ id: r.id, kind: r.kind as SequencerWork["kind"], payload: r.payload as Record<string, unknown>, attempts: r.attempts, availableAt: r.availableAt }));
}
export async function completeSequencerWork(id: string): Promise<void> { const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured"); await conn.delete(sequencerWork).where(eq(sequencerWork.id, id)); }
export async function retrySequencerWork(id: string, retry: { availableAt: string; error: unknown; attempts: number; payload?: Record<string, unknown> }): Promise<void> {
  const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured");
  await conn.update(sequencerWork).set({ availableAt: retry.availableAt, lastError: sanitizeSequencerError(retry.error), attempts: Math.max(0, Math.trunc(retry.attempts)), ...(retry.payload ? { payload: retry.payload } : {}) }).where(eq(sequencerWork.id, id));
}
export async function readSequencerCheckpoint(stream: string): Promise<Record<string, unknown> | null> { const conn = database(); if (!conn) return null; const r = await conn.select({ value: sequencerCheckpoints.value }).from(sequencerCheckpoints).where(eq(sequencerCheckpoints.stream, stream)).limit(1); return (r[0]?.value as Record<string, unknown> | undefined) ?? null; }
export async function writeSequencerCheckpoint(stream: string, value: Record<string, unknown>): Promise<void> { const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured"); await conn.insert(sequencerCheckpoints).values({ stream, value, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: sequencerCheckpoints.stream, set: { value, updatedAt: new Date().toISOString() } }); }

const CHUNK_SIZE = 1000;
function chunks<T>(xs: readonly T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function commitCurveTradeWindow(
  expectedFrom: number,
  nextValue: Record<string, unknown>,
  hourly: readonly HourlyTradeBucket[],
): Promise<boolean> {
  const conn = database();
  if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured");
  return conn.transaction(async (tx) => {
    // The hourly insert is additive, so a window committed twice double-counts forever. Seed the row first:
    // FOR UPDATE on a missing row locks nothing, and two first runs would both pass the check below.
    await tx.insert(sequencerCheckpoints)
      .values({ stream: "curve-trades", value: { nextBlock: expectedFrom }, updatedAt: new Date().toISOString() })
      .onConflictDoNothing({ target: sequencerCheckpoints.stream });
    const rows = await tx
      .select({ value: sequencerCheckpoints.value })
      .from(sequencerCheckpoints)
      .where(eq(sequencerCheckpoints.stream, "curve-trades"))
      .for("update");
    const current = rows[0]?.value as Record<string, unknown> | undefined;
    if (Number(current?.nextBlock) !== expectedFrom) return false;
    if (hourly.length > 0) {
      for (const part of chunks(hourly)) {
        await tx
          .insert(launchTradeHourly)
          .values(
            part.map((h): typeof launchTradeHourly.$inferInsert => ({
              tokenAddress: h.tokenAddress.toLowerCase(),
              hour: h.hourIso,
              buys: h.buys,
              sells: h.sells,
              quoteIn: h.quoteIn.toString(),
              quoteOut: h.quoteOut.toString(),
              creatorQuoteIn: h.creatorQuoteIn.toString(),
              lastTradeBlock: h.lastTradeBlock,
            })),
          )
          .onConflictDoUpdate({
            target: [launchTradeHourly.tokenAddress, launchTradeHourly.hour],
            set: {
              buys: sql`${launchTradeHourly.buys} + excluded.buys`,
              sells: sql`${launchTradeHourly.sells} + excluded.sells`,
              quoteIn: sql`${launchTradeHourly.quoteIn} + excluded.quote_in`,
              quoteOut: sql`${launchTradeHourly.quoteOut} + excluded.quote_out`,
              creatorQuoteIn: sql`${launchTradeHourly.creatorQuoteIn} + excluded.creator_quote_in`,
              lastTradeBlock: sql`greatest(${launchTradeHourly.lastTradeBlock}, excluded.last_trade_block)`,
            },
          });
      }
    }
    await tx
      .insert(sequencerCheckpoints)
      .values({ stream: "curve-trades", value: nextValue, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: sequencerCheckpoints.stream,
        set: { value: nextValue, updatedAt: new Date().toISOString() },
      });
    return true;
  });
}

export async function recordSequencerMetric(m: SequencerMetric): Promise<void> {
  const conn = database(); if (!conn) return;
  try {
    const hour = new Date(); hour.setUTCMinutes(0, 0, 0);
    await conn.insert(sequencerMetrics).values({ hour: hour.toISOString(), provider: clampLabel(m.provider), event: clampLabel(m.event), reason: clampLabel(m.reason ?? ""), count: Math.max(0, Math.trunc(m.count ?? 1)), credits: Math.max(0, Math.trunc(m.credits ?? 0)), latencyMs: Math.max(0, Math.trunc(m.latencyMs ?? 0)) }).onConflictDoUpdate({ target: [sequencerMetrics.hour, sequencerMetrics.provider, sequencerMetrics.event, sequencerMetrics.reason], set: { count: sql`${sequencerMetrics.count} + excluded.count`, credits: sql`${sequencerMetrics.credits} + excluded.credits`, latencyMs: sql`${sequencerMetrics.latencyMs} + excluded.latency_ms` } });
  } catch (error) { console.error("sequencer metric write failed", sanitizeSequencerError(error)); }
}
export async function readSequencerMetrics(sinceIso: string) { const conn = database(); if (!conn) return []; return conn.select().from(sequencerMetrics).where(gte(sequencerMetrics.hour, sinceIso)).orderBy(asc(sequencerMetrics.hour)); }

export type SequencerBudgetRow = { day: string; accountId: string; credits: number };
export async function reserveSequencerCredits(accountId: string, credits: number, limits: { accountDaily: number; totalDaily: number } = { accountDaily: 10_000, totalDaily: 20_000 }, now = new Date()): Promise<boolean> {
  const conn = database(); if (!conn) return false;
  const amount = Math.trunc(credits); if (!accountId || !Number.isSafeInteger(amount) || amount <= 0 || amount > limits.accountDaily || amount > limits.totalDaily) return false;
  const day = now.toISOString().slice(0, 10);
  const account = accountKey(accountId);
  return conn.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`sequencer-budget:${day}`}, 0))`);
    const rows = await tx.select().from(sequencerBudgets).where(eq(sequencerBudgets.day, day));
    const observed = await tx.select().from(sequencerExplorerSpend).where(eq(sequencerExplorerSpend.day, day));
    const accountSpent = rows.find((r) => r.accountId === account)?.credits ?? 0;
    const accountObserved = observed.find((r) => r.accountId === account)?.credits ?? 0;
    if (Math.max(accountSpent, accountObserved) + amount > 50_000 || !canReserveSequencerCredits(accountSpent, rows.reduce((sum, r) => sum + r.credits, 0), amount, limits)) return false;
    await tx.insert(sequencerBudgets).values({ day, accountId: account, credits: amount }).onConflictDoUpdate({ target: [sequencerBudgets.day, sequencerBudgets.accountId], set: { credits: sql`${sequencerBudgets.credits} + excluded.credits` } });
    return true;
  });
}
export async function recordSequencerExplorerSpend(accountId: string, credits: number, now = new Date()): Promise<void> {
  const conn = database(); if (!conn) return;
  const amount = Math.max(0, Math.trunc(credits)); if (!accountId || !amount) return;
  const day = now.toISOString().slice(0, 10);
  const account = accountKey(accountId);
  try { await conn.insert(sequencerExplorerSpend).values({ day, accountId: account, credits: amount }).onConflictDoUpdate({ target: [sequencerExplorerSpend.day, sequencerExplorerSpend.accountId], set: { credits: sql`${sequencerExplorerSpend.credits} + excluded.credits` } }); }
  catch (error) { console.error("sequencer explorer spend write failed", sanitizeSequencerError(error)); }
}
export async function readSequencerBudget(now = new Date()): Promise<(SequencerBudgetRow & { reserved: number; observed: number })[]> {
  const conn = database(); if (!conn) return []; const day = now.toISOString().slice(0, 10);
  const [reserved, observed] = await Promise.all([conn.select().from(sequencerBudgets).where(eq(sequencerBudgets.day, day)), conn.select().from(sequencerExplorerSpend).where(eq(sequencerExplorerSpend.day, day))]);
  const ids = new Set([...reserved.map((r) => r.accountId), ...observed.map((r) => r.accountId)]);
  return [...ids].map((accountId) => { const a = reserved.find((r) => r.accountId === accountId)?.credits ?? 0; const b = observed.find((r) => r.accountId === accountId)?.credits ?? 0; return { day, accountId, credits: Math.max(a, b), reserved: a, observed: b }; });
}
export async function pruneSequencerTelemetry(now = new Date()): Promise<void> { const conn = database(); if (!conn) return; const cutoff = new Date(now.getTime() - 30 * 86400_000).toISOString(); await conn.delete(sequencerMetrics).where(lt(sequencerMetrics.hour, cutoff)); await conn.delete(sequencerBudgets).where(lt(sequencerBudgets.day, cutoff.slice(0, 10))); await conn.delete(sequencerExplorerSpend).where(lt(sequencerExplorerSpend.day, cutoff.slice(0, 10))); const seenCutoff = new Date(now.getTime() - 7 * 86400_000).toISOString(); await conn.delete(sequencerCheckpoints).where(and(sql`(${sequencerCheckpoints.stream} like 'tx:%' or ${sequencerCheckpoints.stream} like 'meta:%' or ${sequencerCheckpoints.stream} like 'pending:%')`, lt(sequencerCheckpoints.updatedAt, seenCutoff))); await conn.delete(sequencerCheckpoints).where(and(sql`${sequencerCheckpoints.stream} like 'abandoned:%'`, lt(sequencerCheckpoints.updatedAt, cutoff))); }

export async function commitSequencerEvidence(input: { launches: LaunchDraft[]; events: LifecycleDraft[]; v4Pools: V4PoolDraft[]; readings?: { tokenAddress: string; reading: StateReading }[]; timestamp: string | null; source: "pumpdev" | "robinscan" | "blockscout" | "recovery"; workId?: string; transactionHash?: string }): Promise<void> {
  const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured");
  await conn.transaction(async (tx) => {
    for (const d of input.launches) {
      const row: typeof launches.$inferInsert = { tokenAddress: d.tokenAddress.toLowerCase(), launchpadId: d.launchpadId, family: d.family, creatorAddress: d.creatorAddress?.toLowerCase() ?? null, createdBlock: d.createdBlock, createdAt: input.timestamp, launchTxHash: d.launchTxHash?.toLowerCase() ?? null, venueKind: d.venueKind, curveAddress: d.curveAddress?.toLowerCase() ?? null, poolRef: textSafe(d.poolRef?.toLowerCase()), quoteToken: d.quoteToken?.toLowerCase() ?? null, quoteSymbol: textSafe(d.quoteSymbol), quoteDecimals: d.quoteDecimals, targetQuote: d.targetQuote?.toString() ?? null, name: textSafe(d.name), symbol: textSafe(d.symbol), metadataUri: textSafe(d.metadataUri), devBuyQuote: d.devBuyQuote?.toString() ?? null, detail: jsonSafe({ ...(d.detail ?? {}), sequencerSource: input.source }), source: "ingest" };
      await tx.insert(launches).values(row).onConflictDoNothing();
    }
    for (const e of input.events) {
      const token = e.tokenAddress.toLowerCase(), txHash = e.txHash.toLowerCase();
      // Pons graduation notices can arrive before its chain log. Match the synthetic row on token/kind/tx so the real event does not duplicate it.
      const existing = await tx.select({ id: launchEvents.id, logIndex: launchEvents.logIndex }).from(launchEvents).where(and(
        eq(launchEvents.tokenAddress, token), eq(launchEvents.kind, e.kind), eq(launchEvents.txHash, txHash), eq(launchEvents.logIndex, e.logIndex),
      )).limit(1);
      if (existing.length) continue;
      if (e.kind === "GRADUATED") {
        const prior = await tx.select({ id: launchEvents.id, logIndex: launchEvents.logIndex }).from(launchEvents).where(and(eq(launchEvents.tokenAddress, token), eq(launchEvents.kind, e.kind), eq(launchEvents.txHash, txHash))).limit(1);
        if (prior.length) {
          if (prior[0].logIndex === -1 && e.logIndex >= 0) await tx.update(launchEvents).set({ blockNumber: e.blockNumber, logIndex: e.logIndex, occurredAt: input.timestamp, poolRef: e.poolRef?.toLowerCase() ?? null, amount: e.amount?.toString() ?? null, detail: jsonSafe({ ...(e.detail ?? {}), sequencerSource: input.source }), source: "ingest" }).where(eq(launchEvents.id, prior[0].id));
          continue;
        }
      }
      const row: typeof launchEvents.$inferInsert = { tokenAddress: token, kind: e.kind, blockNumber: e.blockNumber, logIndex: e.logIndex, txHash, occurredAt: input.timestamp, poolRef: e.poolRef?.toLowerCase() ?? null, amount: e.amount?.toString() ?? null, detail: jsonSafe({ ...(e.detail ?? {}), sequencerSource: input.source }), source: "ingest" };
      await tx.insert(launchEvents).values(row).onConflictDoNothing();
    }
    for (const p of input.v4Pools) { const row: typeof v4Pools.$inferInsert = { poolId: p.poolId.toLowerCase(), currency0: p.currency0.toLowerCase(), currency1: p.currency1.toLowerCase(), fee: p.fee, tickSpacing: p.tickSpacing, hooks: p.hooks.toLowerCase(), initBlock: p.blockNumber, initTx: p.txHash.toLowerCase() }; await tx.insert(v4Pools).values(row).onConflictDoNothing(); }
    if (input.readings?.length) await upsertStateReadingsWith(tx, input.readings.map(r => ({ ...r, readAtIso: input.timestamp ?? new Date().toISOString() })));
    const txHashes = new Set([input.transactionHash, ...input.launches.map((d) => d.launchTxHash), ...input.events.map((e) => e.txHash), ...input.v4Pools.map((p) => p.txHash)].filter((h): h is string => Boolean(h)).map((h) => h.toLowerCase()));
    for (const txHash of txHashes) {
      const graduationPosition = input.events.some(e => e.txHash.toLowerCase() === txHash && e.kind === "GRADUATED" && typeof e.detail?.positionId === "string" && /^\d+$/.test(e.detail.positionId));
      await tx.insert(sequencerCheckpoints).values({ stream: `tx:${txHash}`, value: { accepted: true, scope: input.source === "pumpdev" ? "pons" : "execution", graduationPosition }, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: sequencerCheckpoints.stream, set: {
        // Filtered recovery may establish execution without the graduation position. Preserve each fact independently.
        value: sql`excluded.value || jsonb_build_object('scope', case when ${sequencerCheckpoints.value}->>'scope' = 'execution' then 'execution' else excluded.value->>'scope' end, 'graduationPosition', coalesce((${sequencerCheckpoints.value}->>'graduationPosition')::boolean, false) or (excluded.value->>'graduationPosition')::boolean)`,
        updatedAt: new Date().toISOString(),
      } });
    }
    if (input.workId) await tx.delete(sequencerWork).where(eq(sequencerWork.id, input.workId));
  });
}

export async function patchSequencerTokenMeta(input: { token: string; name: string | null; symbol: string | null; decimals?: number | null }): Promise<void> {
  const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured");
  const values: Partial<typeof launches.$inferInsert> = {};
  if (input.name) values.name = input.name.slice(0, 160);
  if (input.symbol) values.symbol = input.symbol.slice(0, 48);
  if (Object.keys(values).length) await conn.update(launches).set({
    name: sql`coalesce(${launches.name}, ${values.name ?? null})`,
    symbol: sql`coalesce(${launches.symbol}, ${values.symbol ?? null})`,
  }).where(eq(launches.tokenAddress, input.token.toLowerCase()));
}

/** Websocket launches committed ahead of their creator and dev-buy reads (`detail.enrichPending`), oldest first. */
export async function readPendingLaunchEnrichment(limit: number, settledBeforeIso: string): Promise<LaunchDraft[]> {
  const conn = database(); if (!conn) return [];
  const rows = await conn.select().from(launches).where(and(
    eq(launches.family, "pons-v2"),
    // recorded_at bounds the scan to launches_recorded_idx; older pending rows are left to the attempt cap.
    sql`${launches.recordedAt} > now() - interval '2 days'`,
    sql`${launches.detail}->>'enrichPending' = 'true'`,
    lt(launches.createdAt, settledBeforeIso),
  )).orderBy(asc(launches.createdBlock)).limit(limit);
  return rows.map((r) => ({
    tokenAddress: r.tokenAddress, launchpadId: r.launchpadId, family: r.family as LaunchDraft["family"], creatorAddress: r.creatorAddress,
    createdBlock: Number(r.createdBlock), launchTxHash: r.launchTxHash, venueKind: r.venueKind as LaunchDraft["venueKind"],
    curveAddress: r.curveAddress, poolRef: r.poolRef, quoteToken: r.quoteToken, quoteSymbol: r.quoteSymbol, quoteDecimals: r.quoteDecimals,
    targetQuote: r.targetQuote === null ? null : BigInt(r.targetQuote), name: r.name, symbol: r.symbol, metadataUri: r.metadataUri,
    devBuyQuote: r.devBuyQuote === null ? null : BigInt(r.devBuyQuote), detail: (r.detail ?? {}) as Record<string, unknown>,
  }));
}

export const MAX_ENRICH_ATTEMPTS = 10;

/**
 * Resolved drafts overwrite creator and dev buy and bump recorded_at so the prod->local sync re-pulls
 * them. Unresolved ones count an attempt and stop at MAX_ENRICH_ATTEMPTS (`enrichFailed`, never a guess).
 */
export async function applyLaunchEnrichment(resolved: readonly LaunchDraft[], unresolved: readonly string[]): Promise<void> {
  const conn = database(); if (!conn) throw new Error("sequencer persistence unavailable: DATABASE_URL not configured");
  await conn.transaction(async (tx) => {
    for (const d of resolved) {
      const { enrichPending: _p, enrichAttempts: _a, ...detail } = d.detail ?? {};
      await tx.update(launches).set({
        creatorAddress: d.creatorAddress?.toLowerCase() ?? null,
        devBuyQuote: d.devBuyQuote?.toString() ?? null,
        name: sql`coalesce(${launches.name}, ${d.name})`,
        symbol: sql`coalesce(${launches.symbol}, ${d.symbol})`,
        metadataUri: sql`coalesce(${launches.metadataUri}, ${d.metadataUri})`,
        targetQuote: sql`coalesce(${launches.targetQuote}, ${d.targetQuote?.toString() ?? null})`,
        detail: jsonSafe(detail),
        recordedAt: sql`now()`,
      }).where(and(eq(launches.tokenAddress, d.tokenAddress.toLowerCase()), sql`${launches.detail}->>'enrichPending' = 'true'`));
    }
    if (unresolved.length) {
      const attempts = sql`coalesce((${launches.detail}->>'enrichAttempts')::int, 0) + 1`;
      await tx.update(launches).set({
        detail: sql`case when ${attempts} >= ${MAX_ENRICH_ATTEMPTS}
          then (${launches.detail} - 'enrichPending' - 'enrichAttempts') || '{"enrichFailed": true}'::jsonb
          else jsonb_set(${launches.detail}, '{enrichAttempts}', to_jsonb(${attempts})) end`,
      }).where(and(inArray(launches.tokenAddress, unresolved.map((t) => t.toLowerCase())), sql`${launches.detail}->>'enrichPending' = 'true'`));
    }
  });
}

const STATUS_CHECKPOINTS =["runtime", "feed", "pons", "socket", "provider:robinscan", "provider:blockscout_public", "provider:blockscout", "coverage:all", "coverage:nonpons"] as const;
type SequencerStatusCheckpoint = { stream: string; updatedAt: string; status?: string; at?: string; sequence?: number; block?: number; nextBlock?: number; until?: number; lastStatus?: number; reason?: string; scope?: string };

function statusCheckpointValue(stream: string, updatedAt: string, raw: Record<string, unknown>): SequencerStatusCheckpoint {
  const out: SequencerStatusCheckpoint = { stream, updatedAt };
  if (typeof raw.status === "string") out.status = raw.status.slice(0, 32);
  if (typeof raw.at === "string" && Number.isFinite(Date.parse(raw.at))) out.at = new Date(raw.at).toISOString();
  for (const key of ["sequence", "block", "nextBlock", "until", "lastStatus"] as const) {
    const n = raw[key];
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) out[key] = n;
  }
  if (typeof raw.reason === "string") out.reason = sanitizeSequencerError(raw.reason).slice(0, 100);
  if (typeof raw.scope === "string") out.scope = raw.scope.slice(0, 48);
  return out;
}

/** Read-only, bounded operator summary. Never returns transaction or metadata checkpoint payloads. */
export async function readSequencerHealth(now = new Date()): Promise<{
  available: boolean;
  unavailableReason?: "database_unconfigured" | "read_failed";
  queue: { pending: number; ready: number; oldestCreatedAt: string | null; maxAttempts: number; lastError: string | null };
  checkpoints: SequencerStatusCheckpoint[];
}> {
  const unavailable = (reason: "database_unconfigured" | "read_failed") => ({
    available: false,
    unavailableReason: reason,
    queue: { pending: 0, ready: 0, oldestCreatedAt: null, maxAttempts: 0, lastError: null },
    checkpoints: [],
  });
  const conn = database();
  if (!conn) return unavailable("database_unconfigured");
  try {
    const nowIso = now.toISOString();
    const [queueRows, oldestError, checkpointRows] = await Promise.all([
      conn.select({
        pending: sql<number>`count(*)::int`,
        ready: sql<number>`count(*) filter (where ${sequencerWork.availableAt} <= ${nowIso})::int`,
        oldestCreatedAt: sql<string | null>`min(${sequencerWork.createdAt})`,
        maxAttempts: sql<number>`coalesce(max(${sequencerWork.attempts}), 0)::int`,
      }).from(sequencerWork),
      conn.select({ lastError: sequencerWork.lastError }).from(sequencerWork)
        .where(sql`${sequencerWork.lastError} is not null`).orderBy(asc(sequencerWork.createdAt)).limit(1),
      conn.select({ stream: sequencerCheckpoints.stream, value: sequencerCheckpoints.value, updatedAt: sequencerCheckpoints.updatedAt })
        .from(sequencerCheckpoints).where(inArray(sequencerCheckpoints.stream, [...STATUS_CHECKPOINTS])),
    ]);
    const q = queueRows[0];
    return {
      available: true,
      queue: {
        pending: Number(q?.pending ?? 0),
        ready: Number(q?.ready ?? 0),
        oldestCreatedAt: q?.oldestCreatedAt ? new Date(q.oldestCreatedAt).toISOString() : null,
        maxAttempts: Number(q?.maxAttempts ?? 0),
        lastError: oldestError[0]?.lastError ? sanitizeSequencerError(oldestError[0].lastError) : null,
      },
      checkpoints: checkpointRows.map((row) => statusCheckpointValue(
        row.stream,
        new Date(row.updatedAt).toISOString(),
        row.value as Record<string, unknown>,
      )),
    };
  } catch {
    return unavailable("read_failed");
  }
}
