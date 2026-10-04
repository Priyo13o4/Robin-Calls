import { and, desc, eq, inArray, or } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { launches, launchEvents, v4Pools, verdicts } from "@/lib/db/schema";

export interface TokenProvenanceRecord {
  tokenAddress: string;
  family: string;
  venueKind: string;
  launchpadId: number | null;
  curveAddress: string | null;
  launchPoolRef: string | null;
  quoteToken: string | null;
  createdAt: string | null;
  /** The launch's own V4 PoolKey as ingested (hook curves only); unverified shape until checked. */
  launchPoolKey: V4LaunchPoolKey | null;
  graduatedEvent: {
    poolRef: string | null;
    txHash: string | null;
    occurredAt: string | null;
    detail: Record<string, unknown> | null;
  } | null;
  v4Pools: Array<{
    poolId: string;
    currency0: string;
    currency1: string;
    fee: number;
    tickSpacing: number;
    hooks: string;
  }>;
}

export interface V4LaunchPoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/** Shape-checks `launches.detail.poolKey`. Identity is proven by the caller hashing it. */
export function launchPoolKeyOf(detail: unknown): V4LaunchPoolKey | null {
  const k = (detail as { poolKey?: Record<string, unknown> } | null)?.poolKey;
  if (!k || typeof k !== "object") return null;
  const { currency0, currency1, fee, tickSpacing, hooks } = k;
  if (typeof currency0 !== "string" || !ADDR_RE.test(currency0) ||
      typeof currency1 !== "string" || !ADDR_RE.test(currency1) ||
      typeof hooks !== "string" || !ADDR_RE.test(hooks) ||
      !Number.isInteger(fee) || !Number.isInteger(tickSpacing)) return null;
  return {
    currency0: currency0.toLowerCase(),
    currency1: currency1.toLowerCase(),
    fee: fee as number,
    tickSpacing: tickSpacing as number,
    hooks: hooks.toLowerCase(),
  };
}

/**
 * Validates whether ref is a 40-hex address (V2/V3) or 64-hex poolId (V4).
 */
export function poolShapedRef(ref: string | null | undefined): string | null {
  return ref && /^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref.trim())
    ? ref.trim().toLowerCase()
    : null;
}

/**
 * Reads token launch provenance, authoritative graduation events, and registered V4 pools.
 * Returns null if DB is unavailable or token is unknown in launches table.
 * Throws on DB connection/query failure so caller can distinguish unconfigured/fault from unknown.
 */
export async function readTokenProvenanceRecord(
  tokenAddress: string,
): Promise<TokenProvenanceRecord | null> {
  const conn = database();
  if (!conn || !tokenAddress) return null;
  const token = tokenAddress.toLowerCase().trim();

  const [launchRow] = await conn
    .select()
    .from(launches)
    .where(eq(launches.tokenAddress, token))
    .limit(1);

  if (!launchRow) {
    const [verdictRow] = await conn
      .select({
        tokenAddress: verdicts.tokenAddress,
        primaryPoolAddress: verdicts.primaryPoolAddress,
        createdAt: verdicts.createdAt,
      })
      .from(verdicts)
      .where(eq(verdicts.tokenAddress, token))
      .orderBy(desc(verdicts.id))
      .limit(1);

    if (verdictRow?.primaryPoolAddress) {
      const v4Rows = await conn
        .select()
        .from(v4Pools)
        .where(or(eq(v4Pools.currency0, token), eq(v4Pools.currency1, token)));

      return {
        tokenAddress: token,
        family: "direct-dex",
        venueKind: "POOL",
        launchpadId: null,
        curveAddress: null,
        launchPoolRef: poolShapedRef(verdictRow.primaryPoolAddress),
        quoteToken: null,
        createdAt: verdictRow.createdAt ?? null,
        launchPoolKey: null,
        graduatedEvent: null,
        v4Pools: v4Rows.map((p) => ({
          poolId: p.poolId.toLowerCase(),
          currency0: p.currency0.toLowerCase(),
          currency1: p.currency1.toLowerCase(),
          fee: p.fee,
          tickSpacing: p.tickSpacing,
          hooks: p.hooks.toLowerCase(),
        })),
      };
    }

    return null;
  }

  const events = await conn
    .select()
    .from(launchEvents)
    .where(
      and(
        eq(launchEvents.tokenAddress, token),
        inArray(launchEvents.kind, ["GRADUATED", "MIGRATED"]),
      ),
    )
    .orderBy(desc(launchEvents.blockNumber), desc(launchEvents.logIndex));

  // Critical fix: Rows with detail.factory were emitted by the direct-dex bug on
  // permissionless PairCreated/PoolCreated. Do not trust such rows as authoritative evidence.
  const authoritativeEvents = events.filter((e) => {
    const detail = e.detail as Record<string, unknown> | null;
    return !detail || detail.factory === undefined || detail.factory === null;
  });
  // Prefer an authoritative event that carries a validated poolRef; fallback to latest authoritative event.
  const authoritativeEvent =
    authoritativeEvents.find((e) => poolShapedRef(e.poolRef) !== null) ??
    authoritativeEvents[0] ??
    null;

  const v4Rows = await conn
    .select()
    .from(v4Pools)
    .where(or(eq(v4Pools.currency0, token), eq(v4Pools.currency1, token)));

  return {
    tokenAddress: launchRow.tokenAddress.toLowerCase(),
    family: launchRow.family,
    venueKind: launchRow.venueKind,
    launchpadId: launchRow.launchpadId ?? null,
    curveAddress: launchRow.curveAddress,
    launchPoolRef: poolShapedRef(launchRow.poolRef),
    quoteToken: launchRow.quoteToken,
    createdAt: launchRow.createdAt,
    launchPoolKey: launchRow.venueKind === "HOOK_CURVE" ? launchPoolKeyOf(launchRow.detail) : null,
    graduatedEvent: authoritativeEvent
      ? {
          poolRef: poolShapedRef(authoritativeEvent.poolRef),
          txHash: authoritativeEvent.txHash,
          occurredAt: authoritativeEvent.occurredAt,
          detail: authoritativeEvent.detail as Record<string, unknown> | null,
        }
      : null,
    v4Pools: v4Rows.map((p) => ({
      poolId: p.poolId.toLowerCase(),
      currency0: p.currency0.toLowerCase(),
      currency1: p.currency1.toLowerCase(),
      fee: p.fee,
      tickSpacing: p.tickSpacing,
      hooks: p.hooks.toLowerCase(),
    })),
  };
}

/**
 * Resolves a V4 pool by poolId.
 */
export async function readV4PoolById(poolId: string) {
  const conn = database();
  if (!conn || !poolId) return null;
  const rows = await conn
    .select()
    .from(v4Pools)
    .where(eq(v4Pools.poolId, poolId.toLowerCase().trim()))
    .limit(1);
  return rows[0] ?? null;
}
