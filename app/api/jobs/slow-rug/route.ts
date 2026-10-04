import { NextRequest, NextResponse } from "next/server";
import { flags } from "@/lib/config/flags";
import { watchConfig } from "@/lib/config/watch";
import { evaluateTokenSeries } from "@/lib/watch/evaluate";
import {
  fetchTokenPairsBatch,
  pairToSnapshot,
  selectMonitoringPair,
  type DexScreenerPair,
} from "@/lib/market/dexscreener";
import { geckoTerminalProvider } from "@/lib/market/geckoterminal";
import { recordPumpDumpMark } from "@/lib/scanner/record";
import { reportError } from "@/lib/observability/reporter";
import { revalidatePath } from "next/cache";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import {
  readWatchedTokensData,
  writeMarketSnapshotBatch,
  readRecentSnapshotsSeries,
  upsertSlowRugWatchRecord,
  clearSlowRugWatchRecord,
  purgeDeadTokenSnapshots,
} from "@/lib/data/rugs";
import { chainEmptiedTokens } from "@/lib/market/chain-liquidity";

export const maxDuration = 60;

/**
 * The Watch (§4.3, PRD §11.8/§15.5/§16.3) — market monitoring job.
 *
 * 1. OBSERVE — batch up to 30 watched tokens into one DexScreener request,
 *    read each token's PINNED pool (a provider changing its "best pool" must
 *    never look like a drain), and insert one idempotent snapshot per token
 *    per hourly bucket.
 * 2. SLOW DRAIN — liquidity bled ≥ drainThreshold below its trailing
 *    multi-day peak → slow_rug_watch row (reason `liquidity-drain`).
 * 3. PUMP & DUMP (§15.5) — price/liquidity collapsed ≥ pumpDumpCollapsePct
 *    from its trailing 72h peak on a pool that had reached minPeakUsd →
 *    confirm through GeckoTerminal (confirmation-only provider) → permanent
 *    `pump_dump` mark + watch row (reason `pump-dump`). The mark caps future
 *    scores at DANGER; deployer indictment stays with the precision-gated rug
 *    criteria (§7.6), which this evidence feeds but never bypasses.
 *
 * Gated twice: the job secret AND ENABLE_SLOW_RUG_MONITOR.
 *
 *   POST /api/jobs/slow-rug
 *   header: x-job-secret: $INTERNAL_JOB_SECRET
 *   body (optional): { limit?: number }   // max tokens observed this run
 */

const BATCH_SIZE = Math.min(
  Number.parseInt(process.env.MARKET_MONITOR_BATCH_SIZE ?? "30", 10) || 30,
  30
);

interface TokenSeries {
  /** newest-first liquidity/price/volume observations inside the window */
  rows: { liq: number | null; price: number | null; ts: number }[];
}

function hourBucket(nowMs: number): string {
  const d = new Date(nowMs);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

async function observeBatch(
  tokens: string[],
  pinnedPools: Map<string, string | null>,
  bucketAt: string
): Promise<{ inserted: number; observed: number; failed: boolean }> {
  const { ok, status, pairs } = await fetchTokenPairsBatch(tokens);
  if (!ok) {
    await reportError({
      code: "RC_MARKET_UNAVAILABLE",
      message: `DexScreener monitor batch failed (${status})`,
      operation: "job.slowRug.observeBatch",
      providerId: "dexscreener",
      details: { batchSize: tokens.length },
    });
    return { inserted: 0, observed: 0, failed: true };
  }

  const byToken = new Map<string, DexScreenerPair[]>();
  for (const pair of pairs) {
    const base = pair.baseToken?.address?.toLowerCase();
    if (!base) continue;
    const list = byToken.get(base);
    if (list) list.push(pair);
    else byToken.set(base, [pair]);
  }

  const rows = [];
  for (const token of tokens) {
    const tokenPairs = byToken.get(token) ?? [];
    const pair = selectMonitoringPair(tokenPairs, token, pinnedPools.get(token) ?? null);
    if (!pair) continue; // NOT_FOUND is a domain result — no snapshot from absence (§16.3)
    const snap = pairToSnapshot(pair);
    rows.push({
      token_address: token,
      price_usd: snap.priceUsd,
      liquidity_usd: snap.liquidityUsd,
      volume_24h_usd: snap.volume24hUsd,
      buys_24h: snap.buys24h,
      sells_24h: snap.sells24h,
      buyers_24h: snap.buyers24h,
      sellers_24h: snap.sellers24h,
      fdv_usd: snap.fdvUsd,
      pool_address: snap.poolAddress,
      pool_created_at: snap.poolCreatedAt,
      bucket_at: bucketAt,
      provider: "dexscreener",
      // L142: a pool the provider returned without a liquidity figure was not
      // observed. SILYAN logged 24 "OK" rows with NULL liquidity after its pull.
      observation_status: snap.liquidityUsd == null ? "PARTIAL" : "OK",
    });
  }
  if (rows.length === 0) return { inserted: 0, observed: 0, failed: false };

  // L212: an emptied V4 pool keeps its DexScreener figure, so the drain rule could never fire on it.
  const emptied = await chainEmptiedTokens(
    rows.map((r) => ({ tokenAddress: r.token_address, poolAddress: r.pool_address, liquidityUsd: r.liquidity_usd })),
    "job.slowRug.chainEmptiedTokens",
  );
  for (const r of rows) {
    if (!emptied.has(r.token_address)) continue;
    r.liquidity_usd = 0;
    r.provider = "chain";
  }

  const success = await writeMarketSnapshotBatch(rows);
  if (!success) {
    await reportError({
      code: "RC_DB_WRITE_FAILED",
      message: `monitor snapshot upsert failed`,
      operation: "job.slowRug.snapshotUpsert",
    });
    return { inserted: 0, observed: rows.length, failed: true };
  }
  return { inserted: rows.length, observed: rows.length, failed: false };
}

/**
 * GeckoTerminal confirmation (§11.8): never mark off a single provider's view.
 * Confirmed when GT also sees the collapsed state — or sees no pool at all
 * (fully drained). GT unreachable → defer to the next cycle, never guess.
 */
async function confirmCollapse(
  token: string,
  peakPrice: number | null,
  peakLiq: number
): Promise<{ confirmed: boolean; via: string }> {
  const gt = await geckoTerminalProvider.fetchTokenMarket(token);
  if (gt.state === "NOT_FOUND") return { confirmed: true, via: "geckoterminal:pool-gone" };
  if (gt.state !== "OK" || !gt.snapshot) return { confirmed: false, via: `geckoterminal:${gt.state}` };
  const { pumpDumpCollapsePct } = watchConfig;
  const priceConfirmed =
    peakPrice != null &&
    gt.snapshot.priceUsd != null &&
    gt.snapshot.priceUsd <= peakPrice * (1 - pumpDumpCollapsePct);
  const liqConfirmed =
    gt.snapshot.liquidityUsd != null &&
    gt.snapshot.liquidityUsd <= peakLiq * (1 - pumpDumpCollapsePct);
  return { confirmed: priceConfirmed || liqConfirmed, via: "geckoterminal:snapshot" };
}

export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  if (!flags.slowRugMonitor) {
    return jobDisabled("Slow-rug monitor is disabled.");
  }

  let limit = watchConfig.watchMaxTokens; // default capped by watchMaxTokens
  try {
    const body = (await req.json()) as { limit?: number };
    if (body?.limit != null && Number.isFinite(body.limit)) {
      limit = Math.max(1, Math.min(body.limit, watchConfig.watchMaxTokens));
    }
  } catch {
    /* no body */
  }
  const nowMs = Date.now();
  const bucketAt = hourBucket(nowMs);

  const { tokens, pinnedPools, alreadyMarked, candidates, truncated } =
    await readWatchedTokensData(limit);

  let inserted = 0;
  let observed = 0;
  let providerCalls = 0;
  for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
    const batch = tokens.slice(i, i + BATCH_SIZE);
    providerCalls += 1;
    const result = await observeBatch(batch, pinnedPools, bucketAt);
    inserted += result.inserted;
    observed += result.observed;
  }

  const windowMs = Math.max(
    watchConfig.peakWindowDays * 864e5,
    watchConfig.pumpDumpWindowHours * 36e5
  );
  const since = new Date(nowMs - windowMs).toISOString();
  const snaps = await readRecentSnapshotsSeries(since, tokens);

  const series = new Map<string, TokenSeries>();
  for (const s of snaps) {
    const addr = s.token_address.toLowerCase();
    const entry = series.get(addr) ?? { rows: [] };
    entry.rows.push({
      liq: s.liquidity_usd,
      price: s.price_usd,
      ts: Date.parse(s.ts),
    });
    series.set(addr, entry);
  }

  let drainFlagged = 0;
  let pumpDumpMarked = 0;
  let checked = 0;
  let skippedInsufficientHistory = 0;

  for (const addr of tokens) {
    checked += 1;
    const tokenRows = series.get(addr)?.rows ?? [];
    if (tokenRows.length < 2) {
      skippedInsufficientHistory += 1;
      continue;
    }

    const evaluation = evaluateTokenSeries(tokenRows, nowMs, watchConfig);

    if (evaluation.drain) {
      const ok = await upsertSlowRugWatchRecord({
        tokenAddress: addr,
        reason: "liquidity-drain",
        peakLiquidityUsd: evaluation.drain.peak,
        currentLiquidityUsd: evaluation.drain.current,
        drainPct: evaluation.drain.pct,
        cleared: false,
        pinnedPoolAddress: pinnedPools.get(addr) ?? null,
        evidence: {
          peakUsd: evaluation.drain.peak,
          currentUsd: evaluation.drain.current,
          windowDays: watchConfig.peakWindowDays,
          threshold: watchConfig.drainThreshold,
        },
      });
      if (ok) drainFlagged += 1;
    } else if (evaluation.clearDrain) {
      await clearSlowRugWatchRecord(addr, "liquidity-drain");
    }

    if (alreadyMarked.has(addr)) continue;
    if (!evaluation.collapseCandidate) continue;

    const { peakPrice, fastLiqPeak, trigger } = evaluation.collapseCandidate;

    providerCalls += 1;
    const confirm = await confirmCollapse(addr, peakPrice, fastLiqPeak);
    if (!confirm.confirmed) continue;

    const evidence = {
      windowHours: watchConfig.pumpDumpWindowHours,
      collapseThresholdPct: watchConfig.pumpDumpCollapsePct * 100,
      peakPriceUsd: peakPrice,
      currentPriceUsd: tokenRows[0].price,
      peakLiquidityUsd: fastLiqPeak,
      currentLiquidityUsd: tokenRows[0].liq,
      trigger,
      confirmedVia: confirm.via,
      pinnedPool: pinnedPools.get(addr) ?? null,
    };
    const action = await recordPumpDumpMark({
      tokenAddress: addr,
      evidence,
      liquidityUsd: tokenRows[0].liq,
    });
    if (action) {
      pumpDumpMarked += 1;
      await upsertSlowRugWatchRecord({
        tokenAddress: addr,
        reason: "pump-dump",
        peakLiquidityUsd: fastLiqPeak,
        currentLiquidityUsd: tokenRows[0].liq,
        drainPct: Number(
          (tokenRows[0].liq != null && fastLiqPeak > 0 ? 1 - tokenRows[0].liq / fastLiqPeak : 1).toFixed(4)
        ),
        cleared: false,
        pinnedPoolAddress: pinnedPools.get(addr) ?? null,
        evidence,
      });
    }
  }

  if (drainFlagged > 0 || pumpDumpMarked > 0) revalidatePath("/scan", "layout");

  // After evaluation, so this run judged every watched token on full history first.
  let purge: { tokensPurged: number; rowsPurged: number; skipped: string | null } = { tokensPurged: 0, rowsPurged: 0, skipped: null };
  try {
    purge = await purgeDeadTokenSnapshots(tokens);
  } catch (err) {
    purge = { tokensPurged: 0, rowsPurged: 0, skipped: "error" };
    await reportError({
      code: "RC_DB_WRITE_FAILED",
      message: `Snapshot purge failed: ${err instanceof Error ? err.message : String(err)}`,
      operation: "job.slowRug.purgeSnapshots",
      details: { watchSet: tokens.length },
    });
  }

  return NextResponse.json({
    ok: true,
    observed,
    snapshotsInserted: inserted,
    checked,
    watchCandidates: candidates,
    watchTruncated: truncated,
    skippedInsufficientHistory,
    drainFlagged,
    pumpDumpMarked,
    providerCalls,
    snapshotsPurged: purge.rowsPurged,
    tokensPurged: purge.tokensPurged,
    purgeSkipped: purge.skipped,
    bucketAt,
  });
}
