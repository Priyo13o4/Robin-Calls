import { NextRequest, NextResponse } from "next/server";
import { requireJobAuth } from "@/lib/security/job-auth";
import { readSequencerBudget, readSequencerHealth, readSequencerMetrics, sanitizeSequencerError } from "@/lib/data/sequencer";

export const dynamic = "force-dynamic";

/** Authenticated, bounded operational snapshot for the admin sequencer page. */
export async function GET(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const [health, budgets, metrics] = await Promise.all([
      readSequencerHealth(now),
      readSequencerBudget(now),
      readSequencerMetrics(since),
    ]);
    const checkpoint = (stream: string) => health.checkpoints.find((row) => row.stream === stream);
    const runtime = checkpoint("runtime");
    const heartbeatAt = runtime?.at ?? runtime?.updatedAt ?? null;
    const heartbeatAgeMs = heartbeatAt ? Math.max(0, now.getTime() - Date.parse(heartbeatAt)) : null;
    const runtimeFresh = heartbeatAgeMs !== null && Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs <= 45_000;
    const feedAt = checkpoint("feed")?.at ?? null;
    const feedAgeMs = feedAt ? Math.max(0, now.getTime() - Date.parse(feedAt)) : null;
    const feedFresh = feedAgeMs !== null && Number.isFinite(feedAgeMs) && feedAgeMs <= 90_000;
    const relaySocket = checkpoint("socket")?.status ?? "unknown";
    const ponsSocket = checkpoint("pons")?.status ?? "unknown";
    const serviceStatus = !runtimeFresh
      ? runtime ? "heartbeat_stale" : "unknown"
      : runtime?.status === "running" && relaySocket === "connected" && ponsSocket === "connected" && feedFresh
        ? "live"
        : "degraded";
    return NextResponse.json({
      available: health.available,
      unavailableReason: health.unavailableReason,
      generatedAt: now.toISOString(),
      service: {
        status: serviceStatus,
        runtimeStatus: runtime?.status ?? "unknown",
        runtimeFresh,
        heartbeatAt,
        heartbeatAgeMs,
        heartbeatStaleAfterMs: 45_000,
        sequencerSocketStatus: relaySocket,
        ponsSocketStatus: ponsSocket,
        feedFresh,
        feedAgeMs,
        feedStaleAfterMs: 90_000,
      },
      queue: health.queue,
      checkpoints: health.checkpoints,
      budgets: budgets.map((row, index) => ({
        account: `account ${index + 1}`,
        reservedCredits: row.reserved,
        observedCredits: row.observed,
        spentCredits: row.credits,
      })),
      budgetLimits: { perAccountDaily: 10_000, totalDaily: 20_000 },
      metrics: metrics.map((row) => ({
        hour: row.hour,
        provider: row.provider,
        event: row.event,
        reason: row.reason ? sanitizeSequencerError(row.reason) : null,
        count: row.count,
        credits: row.credits,
        latencyMs: row.latencyMs,
        meanLatencyMs: row.count > 0 ? Math.round(row.latencyMs / row.count) : null,
      })),
    }, { status: health.available ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ available: false, unavailableReason: "read_failed" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
