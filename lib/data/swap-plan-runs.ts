import { and, desc, eq, inArray, lt, or, ilike } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { swapPlanRuns } from "@/lib/db/schema";

export interface SwapPlanRunRow {
  id: number;
  requestId: string;
  createdAt: string;
  account: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  status: string;
  stage: string | null;
  code: string | null;
  durationMs: number;
  metadata: Record<string, unknown> | null;
}

export interface InsertSwapPlanRun {
  requestId: string;
  createdAt?: string;
  account: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  status: string;
  stage?: string | null;
  code?: string | null;
  durationMs: number;
  metadata?: Record<string, unknown> | null;
}

const MAX_STRING_LENGTH = 200;

// Whitelist of permissible metadata keys to prevent leaking calldata, signatures,
// permits, stack traces, or unbounded venue listings.
const ALLOWED_METADATA_KEYS = new Set([
  "searchComplete",
  "unquotedPools",
  "unsearchedVenuesCount",
  "candidateCount",
  "quoteCount",
  "venue",
  "protocol",
  "feeTier",
  "simulationStatus",
  "failureReason",
  "detail",
  "slippageBps",
  "slippageMode",
  "isUnscanned",
  "alternativeCount",
  "excludedCount",
  "unknownHookCount",
  "blockedCount",
  "unpricedCount",
  "otherExcludedCount",
  "quoteOutcome",
  "selectedFamily",
  "selectedProtocol",
  "selectedVenue",
  "selectedPoolId",
  "selectedRouteKey",
  "selectedFeeTier",
  "routeType",
  "cacheState",
  "hookAdmission",
  // Per-plan RPC use, "provider:calls[/Nerr]:ms,..." (app/api/swap/plan/route.ts).
  "rpcAttempts",
  "rpcProviders",
  // "eth_call:20,eth_getLogs:2" and its estimated compute units.
  "rpcMethods",
  "rpcCu",
  // Readable route and why pools lost (lib/swap/route-analytics.ts).
  "hops",
  "excludedPools",
  "quotedOut",
  "minOut",
  "priceImpactBps",
  "poolFeeBps",
  "advice",
  // Pool graph per request (lib/swap/graph-candidates.ts): searched or why not, routes offered, served from it.
  "graphStatus",
  "graphCandidates",
  "graphSkipped",
  "roundTripStatus",
  "roundTripLossBps",
  "roundTripDetail",
  "routeSource",
]);

/**
 * Bounds and sanitizes metadata before persistence.
 * Strictly strips signatures, permits, calldata, raw bodies, and stack traces.
 */
export function sanitizeSwapPlanMetadata(
  raw?: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;

    if (typeof value === "string") {
      // Preserve the ordered public pools, including second-hop changes, without accepting free text.
      if (key === "selectedRouteKey") {
        // Up to 3 pools: a graph route key must not be dropped for its length.
        if (/^[a-z0-9-]{1,40}:(?:0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})|-)(?:>(?:0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})|-)){0,2}$/.test(value)) {
          sanitized[key] = value.toLowerCase();
        }
        continue;
      }
      // A pool identity is the metric we need to correlate decoy and selected
      // routes. It is a public contract address or V4 bytes32 ID, so retain
      // only those exact shapes rather than applying the free-text redactor.
      if (key === "excludedPools") {
        const ok = value.split(",").filter((e) => /^(?:0x(?:[0-9a-f]{40}|[0-9a-f]{64})|-):[a-z-]{1,16}$/.test(e.toLowerCase()));
        if (ok.length) sanitized[key] = ok.join(",").toLowerCase();
        continue;
      }
      if (key === "rpcMethods" || key === "hops" || key === "graphSkipped") {
        if (/^[a-zA-Z0-9_:>,?-]{1,400}$/.test(value)) sanitized[key] = value;
        continue;
      }
      if (key === "selectedPoolId") {
        if (/^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)) {
          sanitized[key] = value.toLowerCase();
        }
        continue;
      }
      // Revert text can originate from a token contract or RPC provider.
      // Keep the diagnostic phrase without persisting embedded transaction data.
      const redacted = value.replace(/0x[0-9a-fA-F]{32,}/g, "[hex redacted]");
      sanitized[key] =
        redacted.length > MAX_STRING_LENGTH
          ? `${redacted.slice(0, MAX_STRING_LENGTH)}…`
          : redacted;
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/**
 * Persists a validated swap plan run to swap_plan_runs.
 * Never throws out to caller; fails silently or logs if database write fails.
 */
export async function recordSwapPlanRun(data: InsertSwapPlanRun): Promise<void> {
  const conn = database();
  if (!conn) return;

  const metadata = sanitizeSwapPlanMetadata(data.metadata);

  await conn.insert(swapPlanRuns).values({
    requestId: data.requestId,
    createdAt: data.createdAt ?? new Date().toISOString(),
    account: data.account.toLowerCase(),
    tokenIn: data.tokenIn.toLowerCase(),
    tokenOut: data.tokenOut.toLowerCase(),
    amountIn: String(data.amountIn),
    status: data.status,
    stage: data.stage ?? null,
    code: data.code ?? null,
    durationMs: Math.max(0, Math.round(data.durationMs)),
    metadata,
  });
}

/**
 * Reads the most recent swap plan runs for admin diagnostics.
 */
export async function readRecentSwapPlanRuns(params?: {
  limit?: number;
  query?: string;
  /** Cursor: rows with id strictly below this (id desc, append-only). */
  beforeId?: number | null;
}): Promise<SwapPlanRunRow[]> {
  const conn = database();
  if (!conn) return [];

  const limit = Math.min(Math.max(1, params?.limit ?? 50), 100);
  const q = params?.query?.trim().toLowerCase();

  const whereClause = q
    ? or(
        eq(swapPlanRuns.requestId, q),
        ilike(swapPlanRuns.requestId, `%${q}%`),
        eq(swapPlanRuns.account, q),
        eq(swapPlanRuns.tokenIn, q),
        eq(swapPlanRuns.tokenOut, q),
        eq(swapPlanRuns.status, q),
        eq(swapPlanRuns.code, q)
      )
    : undefined;

  const before = params?.beforeId && Number.isSafeInteger(params.beforeId) && params.beforeId > 0 ? params.beforeId : null;
  const where = before ? (whereClause ? and(whereClause, lt(swapPlanRuns.id, before)) : lt(swapPlanRuns.id, before)) : whereClause;

  const rows = await conn
    .select()
    .from(swapPlanRuns)
    .where(where)
    .orderBy(desc(swapPlanRuns.id))
    .limit(limit);

  return rows.map((r) => ({
    id: Number(r.id),
    requestId: r.requestId,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
    account: r.account,
    tokenIn: r.tokenIn,
    tokenOut: r.tokenOut,
    amountIn: r.amountIn,
    status: r.status,
    stage: r.stage ?? null,
    code: r.code ?? null,
    durationMs: r.durationMs,
    metadata: (r.metadata as Record<string, unknown>) ?? null,
  }));
}

/**
 * Daily retention maintenance: purges expired swap_plan_runs rows in bounded batches.
 */
export async function purgeExpiredSwapPlanRuns(
  cutoffIso: string,
  batchSize = 500,
  maxBatches = 10
): Promise<{ deleted: number; exhausted: boolean }> {
  const conn = database();
  if (!conn) throw new Error("Database not configured.");

  let deleted = 0;

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await conn
      .select({ id: swapPlanRuns.id })
      .from(swapPlanRuns)
      .where(lt(swapPlanRuns.createdAt, cutoffIso))
      .orderBy(swapPlanRuns.id)
      .limit(batchSize);

    const ids = rows.map((r) => Number(r.id));
    if (ids.length === 0) return { deleted, exhausted: false };

    await conn.delete(swapPlanRuns).where(inArray(swapPlanRuns.id, ids));
    deleted += ids.length;

    if (ids.length < batchSize) return { deleted, exhausted: false };
  }

  return { deleted, exhausted: true };
}
