import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { database, isDatabaseConfigured } from "@/lib/db/client";
import {
  blockTimes,
  ingestCursors,
  ingestWindows,
  launchEvents,
  launchState,
  launchTradeHourly,
  launches,
  launchpads,
  trustedAddress,
  v4Pools,
} from "@/lib/db/schema";
import { reportError } from "@/lib/observability/reporter";
import { LAUNCH_LIFECYCLE } from "@/lib/config/launches";
import { flags } from "@/lib/config/flags";
import {
  DIRECT_DEX_KEY,
  LIQUIDITY_BUCKETS,
  PROGRESS_BUCKETS,
  TIME_BUCKETS,
  VOLUME_BUCKETS,
  hasAnyFilter,
  rangesFor,
  type LaunchFilters,
} from "@/lib/config/launch-filters";
import { fromNumericString, toNumericString } from "@/lib/data/numeric";
import { latestVerdictStampsForTokens } from "@/lib/data/ledger";
import { liquidityPulled } from "@/lib/launches/liquidity-pulled";
import { readSequencerCheckpoint } from "./sequencer";
import type {
  KnownLaunch,
  LaunchDraft,
  LauncherFamily,
  LifecycleDraft,
  StateReading,
  V4PoolDraft,
  VenueKind,
} from "@/lib/launches/types";
import type { LaunchFeedRow } from "@/lib/launches/feed-types";
import { BONDING_SURFACE_BPS, LABEL_WINDOW_MS, TRACTION, provenanceStatus, venueModelOf } from "@/lib/launches/labels";
import { PONS_POOL_PROOF_VERSION, resolvePonsGraduatedPool } from "@/lib/launches/modules/pons-v2";
import { rpc } from "@/lib/rpc/client";

/** Launch registry repository (migration 0093, ARCHITECTURE.md §6). */

const CHUNK = 500;

function chunks<T>(xs: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const lower = (xs: readonly string[]) => [...new Set(xs.map((x) => x.toLowerCase()))];
const big = (v: bigint | null | undefined) => (v == null ? null : v.toString());

async function ponsPoolFromGraduation(token: string, txHash: string | null, detail: Record<string, unknown> | null): Promise<string | null> {
  const positionId = detail?.positionId;
  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash) || typeof positionId !== "string" || !/^\d+$/.test(positionId)) return null;
  try {
    const proof = await resolvePonsGraduatedPool(rpc(), token as `0x${string}`, txHash as `0x${string}`, BigInt(positionId));
    if (!proof) return null;
    // Positive proofs are immutable transaction evidence. Persist them so the
    // next bounded feed request can spend its RPC budget on different old rows.
    const conn = database();
    if (conn) {
      try {
        await conn.update(launchEvents).set({
          poolRef: proof.poolRef.toLowerCase(),
          detail: { ...detail, poolIdentityProof: PONS_POOL_PROOF_VERSION },
        }).where(and(
          eq(launchEvents.tokenAddress, token.toLowerCase()),
          eq(launchEvents.txHash, txHash.toLowerCase()),
          eq(launchEvents.kind, "GRADUATED"),
        ));
      } catch {
        // The proof still serves this read; a failed derived write can retry later.
      }
    }
    return proof.poolRef.toLowerCase();
  } catch {
    return null;
  }
}

function provenPonsRef(ref: string | null, detail: Record<string, unknown> | null): string | null {
  return detail?.poolIdentityProof === PONS_POOL_PROOF_VERSION ? poolShapedRef(ref) : null;
}


/** Postgres text/varchar cannot contain NUL (0x00) bytes. */
export function textSafe(s: string | null | undefined): string | null {
  if (s == null) return null;
  const cleaned = s.replace(/\0/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** jsonb cannot carry a bigint (JSON.stringify throws) and Postgres rejects NUL (0x00) in text. */
export function jsonSafe(detail: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (detail == null) return null;
  return JSON.parse(
    JSON.stringify(detail, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (typeof v === "string") return v.replace(/\0/g, "");
      return v;
    }),
  );
}

// ── Ingest ──────────────────────────────────────────────────────────────────

function toKnown(r: typeof launches.$inferSelect): KnownLaunch {
  return {
    tokenAddress: r.tokenAddress,
    family: r.family as LauncherFamily,
    launchpadId: r.launchpadId == null ? null : Number(r.launchpadId),
    creatorAddress: r.creatorAddress,
    createdBlock: r.createdBlock == null ? null : Number(r.createdBlock),
    venueKind: r.venueKind as VenueKind,
    curveAddress: r.curveAddress,
    poolRef: r.poolRef,
    quoteToken: r.quoteToken,
    quoteDecimals: r.quoteDecimals,
    targetQuote: r.targetQuote == null ? null : BigInt(r.targetQuote),
    detail: (r.detail as Record<string, unknown> | null) ?? null,
    createdAtIso: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  };
}

/**
 * Registry rows matching any of these tokens, curve contracts or pool refs.
 * Throws on a DB fault: an ingest that cannot resolve emitters must not commit
 * a window as if those logs belonged to nobody.
 */
/** Stored launch icon pointers by token, for surfaces whose rows are not launches (the ledger). Empty on no DB. */
export async function launchIconsForTokens(tokens: readonly string[]): Promise<Record<string, string>> {
  const conn = database();
  const list = [...new Set(tokens.map((t) => t.toLowerCase()))];
  if (!conn || list.length === 0) return {};
  const rows = await conn
    .select({ token: launches.tokenAddress, uri: launches.metadataUri })
    .from(launches)
    .where(and(inArray(launches.tokenAddress, list), sql`${launches.metadataUri} is not null`));
  return Object.fromEntries(rows.map((r) => [r.token.toLowerCase(), r.uri as string]));
}

export async function readKnownLaunches(keys: {
  tokens?: readonly string[];
  curveAddresses?: readonly string[];
  poolRefs?: readonly string[];
}): Promise<KnownLaunch[]> {
  const conn = database();
  if (!conn) throw new Error("launch registry unavailable: DATABASE_URL not configured");
  const out = new Map<string, KnownLaunch>();
  const run = async (col: typeof launches.tokenAddress | typeof launches.curveAddress | typeof launches.poolRef, values?: readonly string[]) => {
    for (const part of chunks(lower(values ?? []))) {
      const rows = await conn.select().from(launches).where(inArray(col, part));
      for (const r of rows) out.set(r.tokenAddress, toKnown(r));
    }
  };
  await run(launches.tokenAddress, keys.tokens);
  await run(launches.curveAddress, keys.curveAddresses);
  await run(launches.poolRef, keys.poolRefs);
  return [...out.values()];
}

export interface HourlyTradeBucket {
  tokenAddress: string;
  hourIso: string;
  buys: number;
  sells: number;
  quoteIn: bigint;
  quoteOut: bigint;
  creatorQuoteIn: bigint;
  lastTradeBlock: number;
}

export interface IngestWindowCommit {
  stream: string;
  fromBlock: number;
  toBlock: number;
  logCount: number;
  rpcCalls: number;
  launches: { draft: LaunchDraft; createdAtIso: string | null }[];
  events: { draft: LifecycleDraft; occurredAtIso: string | null }[];
  v4Pools: V4PoolDraft[];
  hourly: HourlyTradeBucket[];
  readings: { tokenAddress: string; reading: StateReading; readAtIso: string }[];
}

export class IngestCursorMovedError extends Error {
  constructor(stream: string, expected: number) {
    super(`ingest cursor for ${stream} is no longer at ${expected}; another run committed this window`);
  }
}

/**
 * Everything one window produced, plus the cursor advance, in ONE transaction.
 * The cursor only moves if it still points at `fromBlock`, so two overlapping
 * runs can never both count the same trades (the hourly upsert is additive).
 */
export async function commitIngestWindow(c: IngestWindowCommit): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("launch registry unavailable: DATABASE_URL not configured");
  await conn.transaction(async (tx) => {
    const moved = await tx
      .update(ingestCursors)
      .set({ nextBlock: c.toBlock + 1, updatedAt: new Date().toISOString() })
      .where(and(eq(ingestCursors.stream, c.stream), eq(ingestCursors.nextBlock, c.fromBlock)))
      .returning({ stream: ingestCursors.stream });
    if (moved.length !== 1) {
      const existing = await tx
        .select({ nextBlock: ingestCursors.nextBlock })
        .from(ingestCursors)
        .where(eq(ingestCursors.stream, c.stream))
        .limit(1);
      if (!existing[0]) {
        // L206: Cursor stream row was not yet seeded (e.g. v4_pools_backfill first run);
        // insert initial cursor with nextBlock set to toBlock + 1.
        const inserted = await tx
          .insert(ingestCursors)
          .values({
            stream: c.stream,
            nextBlock: c.toBlock + 1,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .returning({ stream: ingestCursors.stream });
        if (inserted.length !== 1) {
          throw new IngestCursorMovedError(c.stream, c.fromBlock);
        }
      } else {
        throw new IngestCursorMovedError(c.stream, c.fromBlock);
      }
    }

    for (const part of chunks(c.launches, 400)) {
      await tx
        .insert(launches)
        .values(
          part.map(({ draft: d, createdAtIso }): typeof launches.$inferInsert => ({
            tokenAddress: d.tokenAddress.toLowerCase(),
            launchpadId: d.launchpadId,
            family: d.family,
            creatorAddress: d.creatorAddress?.toLowerCase() ?? null,
            createdBlock: d.createdBlock,
            createdAt: createdAtIso,
            launchTxHash: d.launchTxHash,
            venueKind: d.venueKind,
            curveAddress: d.curveAddress?.toLowerCase() ?? null,
            poolRef: textSafe(d.poolRef?.toLowerCase()),
            quoteToken: d.quoteToken?.toLowerCase() ?? null,
            quoteSymbol: textSafe(d.quoteSymbol),
            quoteDecimals: d.quoteDecimals,
            targetQuote: big(d.targetQuote),
            name: textSafe(d.name),
            symbol: textSafe(d.symbol),
            metadataUri: textSafe(d.metadataUri),
            devBuyQuote: big(d.devBuyQuote),
            detail: jsonSafe(d.detail),
            source: "ingest",
          })),
        )
        .onConflictDoNothing();
    }
    for (const part of chunks(c.events, 1000)) {
      await tx
        .insert(launchEvents)
        .values(
          part.map(({ draft: e, occurredAtIso }): typeof launchEvents.$inferInsert => ({
            tokenAddress: e.tokenAddress.toLowerCase(),
            kind: e.kind,
            blockNumber: e.blockNumber,
            logIndex: e.logIndex,
            txHash: e.txHash,
            occurredAt: occurredAtIso,
            poolRef: e.poolRef?.toLowerCase() ?? null,
            amount: big(e.amount),
            detail: jsonSafe(e.detail),
            source: "ingest",
          })),
        )
        .onConflictDoNothing();
    }
    for (const part of chunks(c.v4Pools, 1000)) {
      await tx
        .insert(v4Pools)
        .values(
          part.map((p): typeof v4Pools.$inferInsert => ({
            poolId: p.poolId.toLowerCase(),
            currency0: p.currency0.toLowerCase(),
            currency1: p.currency1.toLowerCase(),
            fee: p.fee,
            tickSpacing: p.tickSpacing,
            hooks: p.hooks.toLowerCase(),
            initBlock: p.blockNumber,
            initTx: p.txHash,
          })),
        )
        .onConflictDoNothing();
    }
    for (const part of chunks(c.hourly, 1000)) {
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
    if (c.readings.length) await upsertStateReadingsWith(tx, c.readings);
    await tx.insert(ingestWindows).values({
      stream: c.stream,
      fromBlock: c.fromBlock,
      toBlock: c.toBlock,
      logCount: c.logCount,
      rpcCalls: c.rpcCalls,
    });
  });
}

/**
 * Inserts or aggregates hourly trade buckets into launch_trade_hourly.
 * Additive on conflict: increments buys, sells, quoteIn, quoteOut, creatorQuoteIn,
 * and tracks the highest lastTradeBlock.
 */
export async function commitHourlyTrades(hourly: readonly HourlyTradeBucket[]): Promise<void> {
  const conn = database();
  if (!conn || hourly.length === 0) return;
  for (const part of chunks(hourly, 1000)) {
    await conn
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

type Tx = Parameters<Parameters<NonNullable<ReturnType<typeof database>>["transaction"]>[0]>[0];
type Writer = NonNullable<ReturnType<typeof database>> | Tx;

export async function upsertStateReadingsWith(
  w: Writer,
  rows: readonly { tokenAddress: string; reading: StateReading; readAtIso: string }[],
): Promise<void> {
  // Last reading per token wins; a batch with a token twice would fail the upsert.
  const byToken = new Map(rows.map((r) => [r.tokenAddress.toLowerCase(), r]));
  for (const part of chunks([...byToken.values()], 1000)) {
    await w
      .insert(launchState)
      .values(
        part.map((r): typeof launchState.$inferInsert => ({
          tokenAddress: r.tokenAddress.toLowerCase(),
          fillBps: r.reading.fillBps,
          quoteBalance: big(r.reading.quoteBalance),
          stateBlock: r.reading.atBlock,
          stateReadAt: r.readAtIso,
        })),
      )
      .onConflictDoUpdate({
        target: launchState.tokenAddress,
        set: {
          fillBps: sql`excluded.fill_bps`,
          quoteBalance: sql`excluded.quote_balance`,
          stateBlock: sql`excluded.state_block`,
          stateReadAt: sql`excluded.state_read_at`,
        },
        setWhere: sql`${launchState.stateBlock} is null or excluded.state_block >= ${launchState.stateBlock}`,
      });
  }
}

/** Successful state reads only; the caller never passes an unread one (§4). */
export async function upsertStateReadings(
  rows: readonly { tokenAddress: string; reading: StateReading; readAtIso: string }[],
): Promise<void> {
  const conn = database();
  if (!conn || !rows.length) return;
  await upsertStateReadingsWith(conn, rows);
}

export interface MarketReading {
  tokenAddress: string;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  buys24h: number | null;
  sells24h: number | null;
  poolAddress: string | null;
  priceChangeH1: number | null;
  readAtIso: string;
}

export interface UpsertedMarketReading {
  tokenAddress: string;
  peakLiquidityUsd: number | null;
  zeroLiquidityReadings: number;
  liquidityUsd: number | null;
  marketPoolAddress: string | null;
}

export async function upsertMarketReadings(rows: readonly MarketReading[]): Promise<UpsertedMarketReading[]> {
  const conn = database();
  if (!conn || !rows.length) return [];
  const byToken = new Map(rows.map((r) => [r.tokenAddress.toLowerCase(), r]));
  const returned = await conn
    .insert(launchState)
    .values(
      [...byToken.values()].map((r): typeof launchState.$inferInsert => ({
        tokenAddress: r.tokenAddress.toLowerCase(),
        liquidityUsd: toNumericString(r.liquidityUsd),
        volume24HUsd: toNumericString(r.volume24hUsd),
        buys24H: r.buys24h,
        sells24H: r.sells24h,
        marketPoolAddress: r.poolAddress?.toLowerCase() ?? null,
        priceChangeH1: toNumericString(r.priceChangeH1), // price_change_h1
        marketReadAt: r.readAtIso,
        peakLiquidityUsd: toNumericString(r.liquidityUsd),
        zeroLiquidityReadings: r.liquidityUsd === 0 ? 1 : 0,
      })),
    )
    .onConflictDoUpdate({
      target: launchState.tokenAddress,
      set: {
        liquidityUsd: sql`excluded.liquidity_usd`,
        volume24HUsd: sql`excluded.volume_24h_usd`,
        buys24H: sql`excluded.buys_24h`,
        sells24H: sql`excluded.sells_24h`,
        marketPoolAddress: sql`excluded.market_pool_address`,
        priceChangeH1: sql`excluded.price_change_h1`,
        marketReadAt: sql`excluded.market_read_at`,
        peakLiquidityUsd: sql`case when excluded.liquidity_usd is null then launch_state.peak_liquidity_usd else greatest(coalesce(launch_state.peak_liquidity_usd, excluded.liquidity_usd), excluded.liquidity_usd) end`,
        zeroLiquidityReadings: sql`case when excluded.liquidity_usd is null then launch_state.zero_liquidity_readings when excluded.liquidity_usd = 0 then launch_state.zero_liquidity_readings + 1 else 0 end`,
      },
    })
    .returning({
      tokenAddress: launchState.tokenAddress,
      peakLiquidityUsd: launchState.peakLiquidityUsd,
      zeroLiquidityReadings: launchState.zeroLiquidityReadings,
      liquidityUsd: launchState.liquidityUsd,
      marketPoolAddress: launchState.marketPoolAddress,
    });

  return returned.map((r): UpsertedMarketReading => ({
    tokenAddress: r.tokenAddress,
    peakLiquidityUsd: fromNumericString(r.peakLiquidityUsd),
    zeroLiquidityReadings: r.zeroLiquidityReadings,
    liquidityUsd: fromNumericString(r.liquidityUsd),
    marketPoolAddress: r.marketPoolAddress,
  }));
}

/** Marks tokens whose market read found no pair, so the rotation moves past them. */
export async function touchMarketReadAt(tokens: readonly string[], readAtIso: string): Promise<void> {
  const conn = database();
  if (!conn || !tokens.length) return;
  await conn
    .insert(launchState)
    .values(lower(tokens).map((t) => ({ tokenAddress: t, marketReadAt: readAtIso })))
    .onConflictDoUpdate({ target: launchState.tokenAddress, set: { marketReadAt: sql`excluded.market_read_at` } });
}

/**
 * Tokens bound to an immutable V4 hook whose liquidity removal always reverts (L157).
 * Reads SQL directly so ingest needs no prime step. Throws on DB errors.
 */
export async function readRemovalLockedTokens(tokens: readonly string[]): Promise<Set<string>> {
  const conn = database();
  if (!conn) return new Set<string>();
  const target = lower(tokens);
  if (!target.length) return new Set<string>();

  const out = new Set<string>();
  for (const part of chunks(target, 500)) {
    const rows = await conn
      .select({
        currency0: v4Pools.currency0,
        currency1: v4Pools.currency1,
      })
      .from(v4Pools)
      .innerJoin(
        trustedAddress,
        and(
          eq(trustedAddress.address, v4Pools.hooks),
          eq(trustedAddress.subtype, "v4-hook"),
          sql`${trustedAddress.metadata}->>'removeLiquidity' = 'always-reverts'`,
          sql`${trustedAddress.metadata}->>'upgradeable' = 'false'`,
        ),
      )
      .where(or(inArray(v4Pools.currency0, part), inArray(v4Pools.currency1, part)));

    const partSet = new Set(part);
    for (const r of rows) {
      const c0 = r.currency0.toLowerCase();
      const c1 = r.currency1.toLowerCase();
      if (partSet.has(c0)) out.add(c0);
      if (partSet.has(c1)) out.add(c1);
    }
  }
  return out;
}

// L179: Missing DexScreener pair after a real reading must nullify market fields so drained tokens leave the DEX tab.
export async function clearMissingMarketReadings(tokens: readonly string[], readAtIso: string): Promise<void> {
  const conn = database();
  if (!conn || !tokens.length) return;
  const target = lower(tokens);
  await touchMarketReadAt(target, readAtIso);
  for (const part of chunks(target, 500)) {
    await conn
      .update(launchState)
      .set({
        liquidityUsd: null,
        volume24HUsd: null,
        buys24H: null,
        sells24H: null,
        priceChangeH1: null,
        marketReadAt: readAtIso,
      })
      .where(
        and(
          inArray(launchState.tokenAddress, part),
          isNotNull(launchState.liquidityUsd),
        ),
      );
  }
}

export async function readIngestCursor(stream: string): Promise<number | null> {
  const conn = database();
  if (!conn) throw new Error("launch registry unavailable: DATABASE_URL not configured");
  const rows = await conn.select({ next: ingestCursors.nextBlock }).from(ingestCursors).where(eq(ingestCursors.stream, stream)).limit(1);
  return rows[0] ? Number(rows[0].next) : null;
}

/** First run only: start at head, no backfill. A cursor that exists is never moved here. */
export async function initIngestCursor(stream: string, nextBlock: number): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("launch registry unavailable: DATABASE_URL not configured");
  await conn.insert(ingestCursors).values({ stream, nextBlock }).onConflictDoNothing();
}

export async function writeBlockAnchor(blockNumber: number, blockTimeIso: string): Promise<void> {
  const conn = database();
  if (!conn) return;
  await conn.insert(blockTimes).values({ blockNumber, blockTime: blockTimeIso }).onConflictDoNothing();
}

/** Anchors within `margin` blocks of the range, ascending. */
export async function readBlockAnchors(fromBlock: number, toBlock: number, margin = 50_000): Promise<{ block: number; ms: number }[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select()
    .from(blockTimes)
    .where(and(gte(blockTimes.blockNumber, fromBlock - margin), lte(blockTimes.blockNumber, toBlock + margin)))
    .orderBy(asc(blockTimes.blockNumber));
  return rows.map((r) => ({ block: Number(r.blockNumber), ms: Date.parse(r.blockTime) }));
}

const graduatedExists = sql<boolean>`exists (select 1 from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED')`;

/**
 * Curve launches inside the label window that have not graduated, least recently
 * read first. The healing pass: a token that stopped trading still gets re-read.
 */
/** Only families with a state reader: an unreadable family never gets a read time and would hold the front forever. */
export async function readStateRefreshSet(limit: number, families: readonly LauncherFamily[], nowMs = Date.now()): Promise<KnownLaunch[]> {
  const conn = database();
  if (!conn || !families.length) return [];
  const rows = await conn
    .select({ l: launches })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .where(
      and(
        gt(launches.createdAt, new Date(nowMs - LABEL_WINDOW_MS).toISOString()),
        inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"]),
        inArray(launches.family, [...families]),
        sql`not ${graduatedExists}`,
      ),
    )
    .orderBy(sql`${launchState.stateReadAt} asc nulls first`)
    .limit(limit);
  return rows.map((r) => toKnown(r.l));
}

/** DEX-tab candidates inside the window, least recently market-read first. */
export async function readMarketRefreshSet(limit: number, nowMs = Date.now()): Promise<string[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select({ token: launches.tokenAddress })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .where(
      and(
        gt(launches.createdAt, new Date(nowMs - LABEL_WINDOW_MS).toISOString()),
        or(eq(launches.venueKind, "POOL"), graduatedExists),
      ),
    )
    .orderBy(sql`${launchState.marketReadAt} asc nulls first`, desc(launches.createdAt))
    .limit(limit);
  return rows.map((r) => r.token);
}

// ── Maintenance ─────────────────────────────────────────────────────────────

export async function pruneLaunchTelemetry(nowMs = Date.now()): Promise<{ hourly: number; anchors: number; windows: number }> {
  const conn = database();
  if (!conn) return { hourly: 0, anchors: 0, windows: 0 };
  const day = 24 * 60 * 60 * 1000;
  const hourly = await conn
    .delete(launchTradeHourly)
    .where(lt(launchTradeHourly.hour, new Date(nowMs - LABEL_WINDOW_MS - day).toISOString()))
    .returning({ t: launchTradeHourly.tokenAddress });
  const anchors = await conn
    .delete(blockTimes)
    .where(lt(blockTimes.blockTime, new Date(nowMs - 30 * day).toISOString()))
    .returning({ b: blockTimes.blockNumber });
  const windows = await conn
    .delete(ingestWindows)
    .where(lt(ingestWindows.recordedAt, new Date(nowMs - 90 * day).toISOString()))
    .returning({ id: ingestWindows.id });
  return { hourly: hourly.length, anchors: anchors.length, windows: windows.length };
}

/** Random committed windows from the last `sinceMs`, for the independent recount (§6.3). */
export async function readRecentIngestWindows(stream: string, sinceMs: number, n: number): Promise<{ fromBlock: number; toBlock: number }[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select({ fromBlock: ingestWindows.fromBlock, toBlock: ingestWindows.toBlock })
    .from(ingestWindows)
    .where(and(eq(ingestWindows.stream, stream), gt(ingestWindows.recordedAt, new Date(Date.now() - sinceMs).toISOString())))
    .orderBy(sql`random()`)
    .limit(n);
  return rows.map((r) => ({ fromBlock: Number(r.fromBlock), toBlock: Number(r.toBlock) }));
}

/** Launch tokens this registry holds among `tokens`. */
export async function readRegisteredTokens(tokens: readonly string[]): Promise<Set<string>> {
  const known = await readKnownLaunches({ tokens });
  return new Set(known.map((k) => k.tokenAddress));
}

// ── Night Market feed (GET /api/launches) ──────────────────────────────────

export interface LaunchFeedCursor {
  createdAt: string;
  tokenAddress: string;
}

export function encodeLaunchFeedCursor(cursor: LaunchFeedCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeLaunchFeedCursor(opaque: string | null): LaunchFeedCursor | null {
  if (!opaque) return null;
  try {
    const parsed = JSON.parse(Buffer.from(opaque, "base64url").toString("utf8"));
    if (typeof parsed?.createdAt === "string" && typeof parsed?.tokenAddress === "string") return parsed;
    return null;
  } catch {
    // A malformed cursor is a first-page request, not an error worth a 400.
    return null;
  }
}

/**
 * Launcher families with trade event indexing subscriptions.
 * Unmeasured families have no rows in launch_trade_hourly, so absence of rows means
 * not measured (null), never zero trades.
 */
export const TRADE_MEASURED_FAMILIES = new Set<string>([
  "pons-v2",
  "doppler-multicurve",
  "flap-v1",
  "curve-events-v1",
]);

/** `numeric` arrives as a string; the hourly quote sums are whole base units. */
function quoteUnits(value: string | null): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value.split(".")[0]);
  } catch {
    // Unparseable cell contributes nothing; the figure is a lower bound, not a fabrication.
    return 0n;
  }
}

export function buildTokenTradeActivity(
  family: string,
  rows: readonly { hour: string; buys?: number | null; sells?: number | null; trades?: number | null }[],
  nowMs = Date.now(),
  covered = true,
): { trades_1h: number | null; trades_hourly: number[] | null } {
  if (!covered) return { trades_1h: null, trades_hourly: null };
  if (!TRADE_MEASURED_FAMILIES.has(family)) {
    return { trades_1h: null, trades_hourly: null };
  }
  const HOUR_MS = 3_600_000;
  const currentHourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const startHourMs = currentHourMs - 23 * HOUR_MS;
  const hourly = new Array<number>(24).fill(0);

  for (const r of rows) {
    const timeMs = Date.parse(r.hour);
    if (Number.isNaN(timeMs)) continue;
    const hourMs = Math.floor(timeMs / HOUR_MS) * HOUR_MS;
    if (hourMs < startHourMs || hourMs > currentHourMs) continue;
    const bucketIdx = Math.floor((hourMs - startHourMs) / HOUR_MS);
    if (bucketIdx >= 0 && bucketIdx < 24) {
      const count = r.trades ?? ((r.buys ?? 0) + (r.sells ?? 0));
      hourly[bucketIdx] += count;
    }
  }

  return {
    trades_1h: hourly[23],
    trades_hourly: hourly,
  };
}

export function curveTradeCoverage(
  checkpoint: Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
  launchIngest = flags.launchIngest,
): boolean {
  if (launchIngest) return true;
  if (!checkpoint) return false;
  const sinceAtMs = typeof checkpoint.sinceAt === "string" ? Date.parse(checkpoint.sinceAt) : NaN;
  if (Number.isNaN(sinceAtMs) || nowMs - sinceAtMs < 24 * 60 * 60 * 1000) return false;
  // throughAt is the newest block recorded, never the save time: a save mid-backfill is fresh over partial data.
  const throughMs = typeof checkpoint.throughAt === "string" ? Date.parse(checkpoint.throughAt) : NaN;
  if (Number.isNaN(throughMs) || nowMs - throughMs > 15 * 60 * 1000 || throughMs > nowMs + 60_000) return false;
  return true;
}

/** A NULL column matches nothing once a filter is active: "< $5K" must not sweep in unmeasured tokens (§8 #3). */
function bucketPredicate(
  column: SQL | typeof launchState.liquidityUsd | typeof launchState.volume24HUsd | typeof launchState.fillBps,
  keys: readonly string[],
  buckets: readonly { key: string; min: number; max: number }[],
): SQL | undefined {
  const ranges = rangesFor(keys, buckets);
  if (ranges.length === 0) return undefined;
  const clauses = ranges.map((r) =>
    Number.isFinite(r.max) ? sql`(${column} >= ${r.min} and ${column} < ${r.max})` : sql`${column} >= ${r.min}`,
  );
  return clauses.length === 1 ? clauses[0] : or(...clauses);
}

// A PairCreated/PoolCreated log can precede funding. Market readings already arrive through
// the scheduled DexScreener HTTP refresh; require meaningful observed depth before
// surfacing a direct DEX row, including the high-volume path. The $10k floor
// bounds the volume-only branch at 4x daily turnover of pool TVL ($40k/$10k).
// Bonding curves use their separate 33% fill gate.
const MIN_DIRECT_DEX_DEPTH_USD = 10_000;
const tractionClears = sql`(coalesce(${launchState.buys24H}, 0) + coalesce(${launchState.sells24H}, 0) >= ${TRACTION.minTxCount24h}
  and ${launchState.liquidityUsd} >= ${MIN_DIRECT_DEX_DEPTH_USD}
  and (${launchState.liquidityUsd} >= ${TRACTION.minLiquidityUsd} or ${launchState.volume24HUsd} >= ${TRACTION.minVolume24hUsd}))`;

// L179: 821 listed DEX tokens linger up to 115m without a dedicated refresh over the 6,893 token pool.
export async function readListedRefreshSet(limit: number, nowMs = Date.now()): Promise<string[]> {
  const conn = database();
  if (!conn) return [];
  const rows = await conn
    .select({ token: launches.tokenAddress })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .where(
      and(
        gt(launches.createdAt, new Date(nowMs - LABEL_WINDOW_MS).toISOString()),
        or(eq(launches.venueKind, "POOL"), graduatedExists),
        tractionClears,
      ),
    )
    .orderBy(sql`${launchState.marketReadAt} asc nulls first`)
    .limit(limit);
  return rows.map((r) => r.token);
}

/**
 * What a tab is, as one expression.
 *
 * Extracted so `readLaunchFeed` and `countLaunchFeedRows` cannot drift: a count
 * built from its own predicate is a headline figure about a different
 * population than the rows underneath it, and nothing would say so.
 *
 * Bonding: a curve, not graduated, with a live fill at or above the floor NOW
 * (never a past high-water mark, L49).
 */
function feedTabFilter(tab: "bonding" | "dex" | "all"): SQL | undefined {
  if (tab === "bonding") {
    return and(inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"]), sql`not ${graduatedExists}`, gte(launchState.fillBps, BONDING_SURFACE_BPS));
  }
  if (tab === "dex") {
    return or(
      and(eq(launches.family, "direct-dex"), tractionClears),
      and(isNotNull(launches.launchpadId), eq(launches.venueKind, "POOL")),
      graduatedExists,
    );
  }
  return or(
    and(inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"]), sql`not ${graduatedExists}`, gte(launchState.fillBps, BONDING_SURFACE_BPS)),
    and(eq(launches.family, "direct-dex"), tractionClears),
    and(isNotNull(launches.launchpadId), eq(launches.venueKind, "POOL")),
    graduatedExists,
  );
}

/**
 * How many rows a tab holds right now, over the SAME window and predicate the
 * feed paginates. Zero is a real answer here and must render as one: the
 * caller cannot tell it apart from a failed read, so a null DB returns 0 only
 * because every read in this module documents an empty value (§1).
 */
export async function countLaunchFeedRows(tab: "bonding" | "dex" | "all"): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const rows = await conn
    .select({ v: count() })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .leftJoin(launchpads, eq(launchpads.id, launches.launchpadId))
    .where(
      and(
        feedTabFilter(tab),
        gt(launches.createdAt, new Date(Date.now() - LABEL_WINDOW_MS).toISOString()),
      ),
    );
  return Number(rows[0]?.v ?? 0);
}

/** Computes liquidity_pulled. If removal-locked read faulted (lockedTokens is null), tags false (§4). */
export function computeLiquidityPulled(
  peakLiquidityUsd: string | null | undefined,
  liquidityUsd: string | null | undefined,
  zeroLiquidityReadings: number | null | undefined,
  tokenAddress: string,
  lockedTokens: Set<string> | null,
): boolean {
  if (lockedTokens === null) return false;
  return liquidityPulled({
    peakUsd: fromNumericString(peakLiquidityUsd),
    liquidityUsd: fromNumericString(liquidityUsd),
    zeroReadings: zeroLiquidityReadings ?? 0,
    removalLocked: lockedTokens.has(tokenAddress.toLowerCase()),
  });
}

export async function readLaunchFeed(
  tab: "bonding" | "dex" | "all",
  limit: number,
  cursor: LaunchFeedCursor | null,
  /** The by-address poll (L35); every other filter still applies, so a row that left the tab drops out. */
  addresses?: string[],
  filters?: LaunchFilters,
): Promise<{ rows: LaunchFeedRow[]; nextCursor: string | null }> {
  const conn = database();
  if (!conn) return { rows: [], nextCursor: null };
  const nowMs = Date.now();
  const tradeCheckpoint = await readSequencerCheckpoint("curve-trades").catch(() => {
    // Checkpoint read fault treats trade activity as unmeasured rather than assuming zero
    return null;
  });
  const covered = curveTradeCoverage(tradeCheckpoint, nowMs);

  const tabFilter = feedTabFilter(tab);

  const conditions: (SQL | undefined)[] = [tabFilter, gt(launches.createdAt, new Date(nowMs - LABEL_WINDOW_MS).toISOString())];
  if (addresses?.length) conditions.push(inArray(launches.tokenAddress, lower(addresses)));
  if (filters && hasAnyFilter(filters)) {
    conditions.push(bucketPredicate(launchState.liquidityUsd, filters.liquidity, LIQUIDITY_BUCKETS));
    conditions.push(bucketPredicate(launchState.volume24HUsd, filters.volume, VOLUME_BUCKETS));
    if (tab === "bonding" && filters.progress.length) {
      conditions.push(
        bucketPredicate(
          launchState.fillBps,
          filters.progress,
          PROGRESS_BUCKETS.map((b) => ({ key: b.key, min: b.min * 100, max: Number.isFinite(b.max) ? b.max * 100 : b.max })),
        ),
      );
    }
    const ageRanges = rangesFor(filters.time, TIME_BUCKETS);
    if (ageRanges.length) {
      const ageClauses = ageRanges.map((r) => {
        const newest = new Date(nowMs - r.min * 60_000).toISOString();
        const oldest = Number.isFinite(r.max) ? new Date(nowMs - r.max * 60_000).toISOString() : null;
        return oldest ? and(lte(launches.createdAt, newest), gt(launches.createdAt, oldest)) : lte(launches.createdAt, newest);
      });
      conditions.push(ageClauses.length === 1 ? ageClauses[0] : or(...ageClauses));
    }
    if (filters.launchpads.length) {
      const slugs = filters.launchpads.filter((k) => k !== DIRECT_DEX_KEY);
      const padClauses: SQL[] = [];
      if (slugs.length) padClauses.push(inArray(launchpads.slug, slugs));
      if (filters.launchpads.includes(DIRECT_DEX_KEY)) padClauses.push(eq(launches.family, "direct-dex"));
      if (padClauses.length) conditions.push(padClauses.length === 1 ? padClauses[0] : or(...padClauses));
    }
  }
  if (cursor) {
    conditions.push(
      or(
        lt(launches.createdAt, cursor.createdAt),
        and(eq(launches.createdAt, cursor.createdAt), lt(launches.tokenAddress, cursor.tokenAddress)),
      ),
    );
  }

  const rawRows = await conn
    .select({
      l: launches,
      padName: launchpads.name,
      padSlug: launchpads.slug,
      fillBps: launchState.fillBps,
      quoteBalance: launchState.quoteBalance,
      liquidityUsd: launchState.liquidityUsd,
      volume24hUsd: launchState.volume24HUsd,
      buys24h: launchState.buys24H,
      sells24h: launchState.sells24H,
      marketPool: launchState.marketPoolAddress,
      priceChangeH1: launchState.priceChangeH1,
      peakLiquidityUsd: launchState.peakLiquidityUsd,
      zeroLiquidityReadings: launchState.zeroLiquidityReadings,
      graduated: graduatedExists,
      gradPool: sql<string | null>`(select e.pool_ref from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      gradTx: sql<string | null>`(select e.tx_hash from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      gradDetail: sql<Record<string, unknown> | null>`(select e.detail from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      gradAt: sql<string | null>`(select e.occurred_at from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      hourBuys: covered
        ? sql<number | null>`(select sum(h.buys)::int from launch_trade_hourly h where h.token_address = ${launches.tokenAddress} and h.hour > now() - interval '24 hours')`
        : sql<number | null>`null`,
      hourSells: covered
        ? sql<number | null>`(select sum(h.sells)::int from launch_trade_hourly h where h.token_address = ${launches.tokenAddress} and h.hour > now() - interval '24 hours')`
        : sql<number | null>`null`,
    })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .leftJoin(launchpads, eq(launchpads.id, launches.launchpadId))
    .where(and(...conditions.filter((c): c is SQL => c !== undefined)))
    .orderBy(desc(launches.createdAt), desc(launches.tokenAddress))
    .limit(limit + 1);

  const hasMore = rawRows.length > limit;
  const rows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const missingPons = rows.filter((r) => r.l.family === "pons-v2" && r.graduated && !provenPonsRef(r.gradPool, r.gradDetail)).slice(0, 8);
  const ponsProofs = new Map<string, string>();
  for (const r of missingPons) {
    const pool = await ponsPoolFromGraduation(r.l.tokenAddress, r.gradTx, r.gradDetail);
    if (pool) ponsProofs.set(r.l.tokenAddress.toLowerCase(), pool);
  }

  const stamps = await latestVerdictStampsForTokens(rows.map((r) => r.l.tokenAddress));
  const tokenAddrs = rows.map((r) => r.l.tokenAddress.toLowerCase());
  const tradesByToken = new Map<string, { hour: string; buys: number; sells: number }[]>();
  const quoteVolumeByToken = new Map<string, bigint>();
  if (covered && tokenAddrs.length > 0) {
    const since24hIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    const tradeRows = await conn
      .select({
        tokenAddress: launchTradeHourly.tokenAddress,
        hour: launchTradeHourly.hour,
        buys: launchTradeHourly.buys,
        sells: launchTradeHourly.sells,
        quoteIn: launchTradeHourly.quoteIn,
        quoteOut: launchTradeHourly.quoteOut,
      })
      .from(launchTradeHourly)
      .where(
        and(
          inArray(launchTradeHourly.tokenAddress, tokenAddrs),
          gte(launchTradeHourly.hour, since24hIso),
        ),
      );
    for (const tr of tradeRows) {
      const key = tr.tokenAddress.toLowerCase();
      const existing = tradesByToken.get(key) ?? [];
      existing.push({
        hour: tr.hour,
        buys: tr.buys ?? 0,
        sells: tr.sells ?? 0,
      });
      tradesByToken.set(key, existing);
      quoteVolumeByToken.set(key, (quoteVolumeByToken.get(key) ?? 0n) + quoteUnits(tr.quoteIn) + quoteUnits(tr.quoteOut));
    }
  }

  let lockedTokens: Set<string> | null = null;
  if (tokenAddrs.length > 0) {
    try {
      lockedTokens = await readRemovalLockedTokens(tokenAddrs);
    } catch (error) {
      lockedTokens = null;
      await reportError({
        code: "RC_CURVE_SYNC_FAILED",
        message: "failed to read removal locked tokens in launch feed",
        operation: "launches.feed.removalLocked",
        error,
      });
    }
  } else {
    lockedTokens = new Set<string>();
  }

  const mapped: LaunchFeedRow[] = rows.map((r) => {
    const l = r.l;
    const venueKind = l.venueKind as VenueKind;
    const isPadPool = venueKind === "POOL" && l.launchpadId != null;
    const tokenTrades = tradesByToken.get(l.tokenAddress.toLowerCase()) ?? [];
    const activity = buildTokenTradeActivity(l.family, tokenTrades, nowMs, covered);
    return {
      token_address: l.tokenAddress,
      source_kind: l.family === "direct-dex" ? "DIRECT_DEX" : "LAUNCHPAD",
      launchpad_id: l.launchpadId == null ? null : Number(l.launchpadId),
      launchpad_name: r.padName ?? null,
      launchpad_slug: r.padSlug ?? null,
      venue_model: venueModelOf(l.family, venueKind),
      lifecycle_state: r.graduated || isPadPool ? "GRADUATED" : "SURFACED",
      pool_address:
        (l.family === "pons-v2" ? provenPonsRef(r.gradPool, r.gradDetail) : poolShapedRef(r.gradPool)) ??
        ponsProofs.get(l.tokenAddress.toLowerCase()) ??
        (venueKind === "POOL" ? poolShapedRef(l.poolRef) : null) ??
        (l.family !== "pons-v2" && (venueKind === "POOL" || r.graduated) ? poolShapedRef(r.marketPool) : null),
      token_name: l.name,
      token_symbol: l.symbol,
      liquidity_usd: fromNumericString(r.liquidityUsd),
      volume_24h_usd: fromNumericString(r.volume24hUsd),
      buys_24h: r.buys24h ?? r.hourBuys ?? null,
      sells_24h: r.sells24h ?? r.hourSells ?? null,
      progress_bps: r.fillBps ?? null,
      created_at: new Date(l.createdAt!).toISOString(),
      surfaced_at: null,
      graduated_at: r.gradAt ? new Date(r.gradAt).toISOString() : null,
      metadata_uri: l.metadataUri,
      raised_wei: r.quoteBalance ?? l.legacyRaisedQuote ?? null,
      quote_symbol: l.quoteSymbol,
      quote_token: l.quoteToken,
      quote_decimals: l.quoteDecimals,
      trades_1h: activity.trades_1h,
      trades_hourly: activity.trades_hourly,
      // Null for unmeasured families: no rows there means "not indexed", never zero volume.
      volume_24h_quote:
        activity.trades_hourly === null ? null : (quoteVolumeByToken.get(l.tokenAddress.toLowerCase()) ?? 0n).toString(),
      price_change_h1: fromNumericString(r.priceChangeH1),
      verdict: stamps.get(l.tokenAddress.toLowerCase()) ?? null,
      liquidity_pulled: computeLiquidityPulled(
        r.peakLiquidityUsd,
        r.liquidityUsd,
        r.zeroLiquidityReadings,
        l.tokenAddress,
        lockedTokens,
      ),
    };
  });

  const last = rows[rows.length - 1];
  const nextCursor =
    hasMore && last?.l.createdAt
      ? encodeLaunchFeedCursor({ createdAt: last.l.createdAt, tokenAddress: last.l.tokenAddress })
      : null;
  return { rows: mapped, nextCursor };
}

export async function readLaunchFeedByAddresses(
  tab: "bonding" | "dex" | "all",
  addresses: string[],
  filters?: LaunchFilters,
): Promise<LaunchFeedRow[]> {
  if (!addresses.length) return [];
  const { rows } = await readLaunchFeed(tab, addresses.length, null, addresses, filters);
  return rows;
}

/**
 * Resolves a token's canonical address given either its Token CA, a Pool Address, or a Curve Address.
 * Crucial for resolving /trade/[token] when user passes a pool/pair address.
 */
export async function findTokenAddressByPoolOrToken(ref: string): Promise<string | null> {
  const conn = database();
  if (!conn || !ref) return null;
  const norm = ref.toLowerCase().trim();

  // 1. Direct token in launches
  const direct = await conn
    .select({ tokenAddress: launches.tokenAddress })
    .from(launches)
    .where(eq(launches.tokenAddress, norm))
    .limit(1);
  if (direct.length > 0 && direct[0]) return direct[0].tokenAddress;

  // 2. Matches poolRef in launches
  const byPool = await conn
    .select({ tokenAddress: launches.tokenAddress })
    .from(launches)
    .where(eq(launches.poolRef, norm))
    .limit(1);
  if (byPool.length > 0 && byPool[0]) return byPool[0].tokenAddress;

  // 3. Matches marketPoolAddress in launchState
  const byMarketPool = await conn
    .select({ tokenAddress: launchState.tokenAddress })
    .from(launchState)
    .where(eq(launchState.marketPoolAddress, norm))
    .limit(1);
  if (byMarketPool.length > 0 && byMarketPool[0]) return byMarketPool[0].tokenAddress;

  // 4. Matches poolRef in launchEvents
  const byEvent = await conn
    .select({ tokenAddress: launchEvents.tokenAddress })
    .from(launchEvents)
    .where(eq(launchEvents.poolRef, norm))
    .limit(1);
  if (byEvent.length > 0 && byEvent[0]) return byEvent[0].tokenAddress;

  return null;
}

type FeedPage = { rows: LaunchFeedRow[]; nextCursor: string | null };

/** Page 1 only, 15s TTL, single-flight: every open Night Market tab polls it (§5). */
const FEED_CACHE_TTL_MS = 15_000;
const feedCache = new Map<string, { at: number; value: FeedPage }>();
const feedInFlight = new Map<string, Promise<FeedPage>>();

export async function readLaunchFeedCached(tab: "bonding" | "dex" | "all", limit: number): Promise<FeedPage> {
  const key = `${tab}:${limit}`;
  const cached = feedCache.get(key);
  if (cached && Date.now() - cached.at < FEED_CACHE_TTL_MS) return cached.value;
  const existing = feedInFlight.get(key);
  if (existing) return existing;
  const load = readLaunchFeed(tab, limit, null)
    .then((value) => {
      if (isDatabaseConfigured() && database() && value) {
        feedCache.set(key, { at: Date.now(), value });
      }
      return value;
    })
    .finally(() => feedInFlight.delete(key));
  feedInFlight.set(key, load);
  return load;
}

// ── Scanner reads ───────────────────────────────────────────────────────────

/** One token's launch provenance for the scanner (launchpad_provenance, venue gate, holder exclusion). */
export interface LaunchProvenance {
  launchpad: { name: string; slug: string } | null;
  /** The contract custodying the raise (per-token curve, shared curve, or hook): escrow, not a whale. */
  curveAddress: string | null;
  padAddress: string | null;
  padAdapter: string | null;
  status: string | null;
  progressBps: number | null;
  raisedWei: string;
  /**
   * null = the creator's buying was not measured (dev buy unread). Never "0":
   * Number(null) is 0, which would publish "the creator bought 0%" (§4).
   */
  creatorBuyWei: string | null;
  /** Trades counted; null = not carried. `0` beside a positive raise means the counter never looked (L135). */
  buys?: number | null;
  creatorAddress: string | null;
  dexPoolAddress: string | null;
  /** BONDING_CURVE, DEX_RESTRICTED, or null for an unknown or non-pad launch. Null is not a curve (L72). */
  venueModel: string | null;
  /** Decimals of the raise asset; null = unknown, never assume 18 (L67). */
  quoteDecimals: number | null;
  createdAt: string | null;
}

/**
 * A pool address (V2/V3) or V4 pool id, else null. Pons V2 stored `PoolGraduated.positionId`
 * (a PositionManager NFT id like 2736135) as the graduation pool ref on 341 rows, and
 * DexScreener links built from it 404'd (2026-09-15).
 */
export function poolShapedRef(ref: string | null | undefined): string | null {
  return ref && /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref) ? ref : null;
}

export async function readLaunchProvenance(tokenAddress: string, nowMs = Date.now()): Promise<LaunchProvenance | null> {
  if (!tokenAddress) return null;
  const conn = database();
  if (!conn) return null;
  const token = tokenAddress.toLowerCase();
  const rows = await conn
    .select({
      l: launches,
      padName: launchpads.name,
      padSlug: launchpads.slug,
      padAddress: launchpads.curveAddress,
      padAdapter: launchpads.adapter,
      fillBps: launchState.fillBps,
      quoteBalance: launchState.quoteBalance,
      graduated: graduatedExists,
      gradPool: sql<string | null>`(select e.pool_ref from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      gradTx: sql<string | null>`(select e.tx_hash from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      gradDetail: sql<Record<string, unknown> | null>`(select e.detail from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'GRADUATED' order by e.occurred_at desc nulls last limit 1)`,
      marketPool: launchState.marketPoolAddress,
      creatorBuys: sql<string | null>`(select sum(e.amount)::text from launch_events e where e.token_address = ${launches.tokenAddress} and e.kind = 'CREATOR_BUY')`,
      hourlyBuys: sql<number | null>`(select sum(h.buys)::int from launch_trade_hourly h where h.token_address = ${launches.tokenAddress})`,
    })
    .from(launches)
    .leftJoin(launchpads, eq(launchpads.id, launches.launchpadId))
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .where(eq(launches.tokenAddress, token))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  const l = r.l;
  const venueKind = l.venueKind as VenueKind;
  const ponsPool = l.family === "pons-v2" && r.graduated && !provenPonsRef(r.gradPool, r.gradDetail)
    ? await ponsPoolFromGraduation(l.tokenAddress, r.gradTx, r.gradDetail)
    : null;

  let creatorBuyWei: string | null;
  if (l.source === "migrated") creatorBuyWei = l.legacyCreatorBuyQuote ?? null;
  else if (l.devBuyQuote == null) creatorBuyWei = null;
  else creatorBuyWei = (BigInt(l.devBuyQuote) + BigInt(r.creatorBuys ?? "0")).toString();

  return {
    launchpad: r.padName && r.padSlug ? { name: r.padName, slug: r.padSlug } : null,
    // A shared-curve pad (flap, robinfun) holds every token's supply at the pad address; Pons V2's pad is a factory.
    curveAddress: l.curveAddress ?? (venueKind === "CURVE" && r.padAdapter !== "pons-v2" ? (r.padAddress ?? null) : null),
    padAddress: r.padAddress ?? null,
    padAdapter: r.padAdapter ?? null,
    status: provenanceStatus({
      venueKind,
      graduated: Boolean(r.graduated),
      createdAtMs: l.createdAt ? Date.parse(l.createdAt) : null,
      nowMs,
    }),
    progressBps: r.fillBps ?? null,
    raisedWei: l.source === "migrated" ? (l.legacyRaisedQuote ?? r.quoteBalance ?? "0") : (r.quoteBalance ?? "0"),
    creatorBuyWei,
    buys: l.source === "migrated" ? l.legacyBuys : r.hourlyBuys,
    creatorAddress: l.creatorAddress,
    dexPoolAddress:
      (l.family === "pons-v2" ? provenPonsRef(r.gradPool, r.gradDetail) : poolShapedRef(r.gradPool)) ??
      ponsPool ??
      (venueKind === "POOL" ? poolShapedRef(l.poolRef) : null) ??
      (l.family !== "pons-v2" && (venueKind === "POOL" || r.graduated) ? poolShapedRef(r.marketPool) : null),
    venueModel: venueModelOf(l.family, venueKind),
    quoteDecimals: l.quoteDecimals,
    createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : null,
  };
}

/**
 * Launches on record for a creator: the launcher-vs-relayer discriminator (L106).
 * null = could not count, which the caller must treat as unknown, never as one launch.
 */
export async function countLaunchesByCreator(creatorAddress: string): Promise<number | null> {
  if (!creatorAddress) return null;
  const conn = database();
  if (!conn) return null;
  const addr = creatorAddress.toLowerCase();
  try {
    const rows = await conn.select({ n: count() }).from(launches).where(eq(launches.creatorAddress, addr));
    return rows[0]?.n ?? 0;
  } catch (error) {
    await reportError({
      code: "RC_CURVE_LAUNCH_COUNT_FAILED",
      message: "could not count launches for a pad-record launcher; attribution stands down (L106)",
      operation: "launches.countLaunchesByCreator",
      error,
      details: { address: addr },
    });
    return null;
  }
}

// ── Counters ────────────────────────────────────────────────────────────────

/** Predicate matching launches visible on either Night Market tab right now. */
export function visibleLaunchesPredicate(): SQL {
  return or(
    and(inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"]), gte(launchState.fillBps, BONDING_SURFACE_BPS)),
    and(eq(launches.family, "direct-dex"), tractionClears),
    and(isNotNull(launches.launchpadId), eq(launches.venueKind, "POOL")),
    graduatedExists,
  )!;
}

/** Launches visible on either Night Market tab right now. */
export async function countVisibleLaunches(nowMs = Date.now()): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const rows = await conn
    .select({ n: count() })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .where(
      and(
        gt(launches.createdAt, new Date(nowMs - LABEL_WINDOW_MS).toISOString()),
        visibleLaunchesPredicate(),
      ),
    );
  return rows[0]?.n ?? 0;
}

export interface HourlyLaunchBucket {
  hour: string;
  launches: number;
}

/**
 * Pure 24-bucket hourly aggregator for launches.
 * Returns exactly 24 buckets, oldest first, zero-filled for empty hours.
 * Out-of-window rows (older than 23 hours ago or in the future) are ignored.
 */
export function bucketHourly(
  rows: readonly { hour?: string; createdAt?: string; launches?: number; count?: number }[],
  nowMs = Date.now(),
): HourlyLaunchBucket[] {
  const HOUR_MS = 3_600_000;
  const currentHourMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const startHourMs = currentHourMs - 23 * HOUR_MS;

  const buckets = new Map<number, HourlyLaunchBucket>();
  for (let i = 23; i >= 0; i--) {
    const bucketMs = currentHourMs - i * HOUR_MS;
    buckets.set(bucketMs, {
      hour: new Date(bucketMs).toISOString(),
      launches: 0,
    });
  }

  for (const r of rows) {
    const rawTime = r.hour ?? r.createdAt;
    if (!rawTime) continue;
    const timeMs = typeof rawTime === "number" ? rawTime : Date.parse(rawTime);
    if (Number.isNaN(timeMs)) continue;
    const hourMs = Math.floor(timeMs / HOUR_MS) * HOUR_MS;
    if (hourMs < startHourMs || hourMs > currentHourMs) continue;
    const bucket = buckets.get(hourMs);
    if (bucket) {
      bucket.launches += r.launches ?? r.count ?? 1;
    }
  }

  return Array.from(buckets.values());
}

/**
 * Hourly count of launches created in each of the last 24 hours, over the visible
 * population only. Returns exactly 24 buckets, oldest first, zero-filled for empty hours.
 */
export async function readVisibleLaunchesByHour(nowMs = Date.now()): Promise<HourlyLaunchBucket[]> {
  const conn = database();
  if (!conn) return [];
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const rows = await conn
    .select({
      // ISO with an explicit Z: a bare `at time zone 'UTC'` timestamp parses as server-LOCAL time in JS,
      // which shifted every bar 5.5h (and off the hour grid) on an IST machine.
      hour: sql<string>`to_char(date_trunc('hour', ${launches.createdAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`,
      launches: count(),
    })
    .from(launches)
    .leftJoin(launchState, eq(launchState.tokenAddress, launches.tokenAddress))
    .where(and(visibleLaunchesPredicate(), gte(launches.createdAt, sinceIso)))
    .groupBy(sql`1`);

  return bucketHourly(
    rows.map((r) => ({
      hour: r.hour ?? "",
      launches: Number(r.launches),
    })),
    nowMs,
  );
}

/** Graduations out of a curve. A pool launch is born in a pool and is not a graduation. */
export async function countCurveGraduations(): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const rows = await conn
    .select({ n: sql<number>`count(distinct ${launchEvents.tokenAddress})::int` })
    .from(launchEvents)
    .innerJoin(launches, eq(launches.tokenAddress, launchEvents.tokenAddress))
    .where(and(eq(launchEvents.kind, "GRADUATED"), inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"])));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Distinct tokens with a GRADUATED launch_event in the last 24h, whose venue
 * is CURVE or HOOK_CURVE, and where occurred_at - launches.created_at > interval '60 seconds'
 * to exclude same-tick graduations.
 */
export async function countCurveGraduations24h(nowMs = Date.now()): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const rows = await conn
    .select({ n: sql<number>`count(distinct ${launchEvents.tokenAddress})::int` })
    .from(launchEvents)
    .innerJoin(launches, eq(launches.tokenAddress, launchEvents.tokenAddress))
    .where(
      and(
        eq(launchEvents.kind, "GRADUATED"),
        inArray(launches.venueKind, ["CURVE", "HOOK_CURVE"]),
        gte(launchEvents.occurredAt, sinceIso),
        sql`${launchEvents.occurredAt} - ${launches.createdAt} > interval '60 seconds'`,
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

/** Sum of buys + sells in launch_trade_hourly over the last 24h. */
export async function countCurveTrades24h(nowMs = Date.now()): Promise<number> {
  const conn = database();
  if (!conn) return 0;
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const rows = await conn
    .select({
      total: sql<number>`coalesce(sum(${launchTradeHourly.buys} + ${launchTradeHourly.sells}), 0)::int`,
    })
    .from(launchTradeHourly)
    .where(gte(launchTradeHourly.hour, sinceIso));
  return Number(rows[0]?.total ?? 0);
}

/** Total buys + sells across all tokens or for a single token over the last 24h. */
export async function read24hTradeCount(tokenAddress?: string, nowMs = Date.now()): Promise<number> {
  if (!tokenAddress) return countCurveTrades24h(nowMs);
  const conn = database();
  if (!conn) return 0;
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
  const rows = await conn
    .select({
      total: sql<number>`coalesce(sum(${launchTradeHourly.buys} + ${launchTradeHourly.sells}), 0)::int`,
    })
    .from(launchTradeHourly)
    .where(
      and(
        eq(launchTradeHourly.tokenAddress, tokenAddress.toLowerCase()),
        gte(launchTradeHourly.hour, sinceIso),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

export interface TradesSummary {
  buys: number;
  sells: number;
  total: number;
}

/** Summarizes 24h buys, sells, and total for a single token or multiple tokens from launch_trade_hourly. */
export async function readTradesSummary(tokenAddress: string, nowMs?: number): Promise<TradesSummary>;
export async function readTradesSummary(tokenAddresses: readonly string[], nowMs?: number): Promise<Map<string, TradesSummary>>;
export async function readTradesSummary(
  tokenOrTokens: string | readonly string[],
  nowMs = Date.now(),
): Promise<TradesSummary | Map<string, TradesSummary>> {
  const conn = database();
  const sinceIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();

  if (typeof tokenOrTokens === "string") {
    if (!conn) return { buys: 0, sells: 0, total: 0 };
    const rows = await conn
      .select({
        buys: sql<number>`coalesce(sum(${launchTradeHourly.buys}), 0)::int`,
        sells: sql<number>`coalesce(sum(${launchTradeHourly.sells}), 0)::int`,
      })
      .from(launchTradeHourly)
      .where(
        and(
          eq(launchTradeHourly.tokenAddress, tokenOrTokens.toLowerCase()),
          gte(launchTradeHourly.hour, sinceIso),
        ),
      );
    const buys = Number(rows[0]?.buys ?? 0);
    const sells = Number(rows[0]?.sells ?? 0);
    return { buys, sells, total: buys + sells };
  }

  const out = new Map<string, TradesSummary>();
  const addrs = lower(tokenOrTokens);
  if (addrs.length === 0 || !conn) {
    for (const a of addrs) out.set(a, { buys: 0, sells: 0, total: 0 });
    return out;
  }

  for (const part of chunks(addrs, 500)) {
    const rows = await conn
      .select({
        tokenAddress: launchTradeHourly.tokenAddress,
        buys: sql<number>`coalesce(sum(${launchTradeHourly.buys}), 0)::int`,
        sells: sql<number>`coalesce(sum(${launchTradeHourly.sells}), 0)::int`,
      })
      .from(launchTradeHourly)
      .where(
        and(
          inArray(launchTradeHourly.tokenAddress, part),
          gte(launchTradeHourly.hour, sinceIso),
        ),
      )
      .groupBy(launchTradeHourly.tokenAddress);

    for (const r of rows) {
      const b = Number(r.buys ?? 0);
      const s = Number(r.sells ?? 0);
      out.set(r.tokenAddress.toLowerCase(), { buys: b, sells: s, total: b + s });
    }
  }

  for (const a of addrs) {
    if (!out.has(a)) {
      out.set(a, { buys: 0, sells: 0, total: 0 });
    }
  }

  return out;
}

/** Inserts a batch of V4 pool drafts into v4_pools on conflict do nothing. */
export async function writeV4Pools(pools: readonly V4PoolDraft[]): Promise<void> {
  const conn = database();
  if (!conn || pools.length === 0) return;
  for (const part of chunks(pools, 1000)) {
    await conn
      .insert(v4Pools)
      .values(
        part.map((p): typeof v4Pools.$inferInsert => ({
          poolId: p.poolId.toLowerCase(),
          currency0: p.currency0.toLowerCase(),
          currency1: p.currency1.toLowerCase(),
          fee: p.fee,
          tickSpacing: p.tickSpacing,
          hooks: p.hooks.toLowerCase(),
          initBlock: p.blockNumber,
          initTx: p.txHash,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Inserts a batch of launch drafts into launches on conflict do nothing. */
export async function writeLaunchDrafts(
  drafts: readonly LaunchDraft[],
  createdAtIso?: string | null,
): Promise<void> {
  const conn = database();
  if (!conn || drafts.length === 0) return;
  const validDrafts = drafts.filter(
    (d) => typeof d.tokenAddress === "string" && d.tokenAddress.length === 42 && d.tokenAddress.startsWith("0x"),
  );
  if (validDrafts.length === 0) return;
  for (const part of chunks(validDrafts, 400)) {
    await conn
      .insert(launches)
      .values(
        part.map((d): typeof launches.$inferInsert => ({
          tokenAddress: d.tokenAddress.toLowerCase(),
          launchpadId: d.launchpadId,
          family: d.family,
          creatorAddress: d.creatorAddress?.toLowerCase() ?? null,
          createdBlock: d.createdBlock,
          createdAt: createdAtIso ?? new Date().toISOString(),
          launchTxHash: d.launchTxHash,
          venueKind: d.venueKind,
          curveAddress: d.curveAddress?.toLowerCase() ?? null,
          poolRef: textSafe(d.poolRef?.toLowerCase()),
          quoteToken: d.quoteToken?.toLowerCase() ?? null,
          quoteSymbol: textSafe(d.quoteSymbol),
          quoteDecimals: d.quoteDecimals,
          targetQuote: big(d.targetQuote),
          name: textSafe(d.name),
          symbol: textSafe(d.symbol),
          metadataUri: textSafe(d.metadataUri),
          devBuyQuote: big(d.devBuyQuote),
          detail: jsonSafe(d.detail),
          source: "ingest",
        })),
      )
      .onConflictDoNothing();
  }
}
