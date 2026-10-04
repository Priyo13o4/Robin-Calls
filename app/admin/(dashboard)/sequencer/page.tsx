import { AdminHeading } from "../../components/AdminShell";
import { Badge, InfoBox } from "../../components/ui";
import { requireAdmin } from "@/lib/auth/guard";
import { summarizeRpcSpend } from "@/lib/sequencer/spend-summary";
import Link from "next/link";
import { readSequencerBudget, readSequencerHealth, readSequencerMetrics, sanitizeSequencerError } from "@/lib/data/sequencer";

export const dynamic = "force-dynamic";

function stamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—";
}

const EVENTS_PAGE = 50;

export default async function SequencerStatusPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  const pageParam = Number.parseInt((await searchParams)?.page ?? "", 10);
  const now = new Date();
  const [health, budgets, metrics] = await Promise.all([
    readSequencerHealth(now),
    readSequencerBudget(now),
    readSequencerMetrics(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  const spend = summarizeRpcSpend(metrics);
  const spendCalls = spend.reduce((n, r) => n + r.calls, 0);
  const spendCu = spend.every((r) => r.cu !== null) ? spend.reduce((n, r) => n + (r.cu ?? 0), 0) : null;
  const newestFirst = [...metrics].reverse();
  const pages = Math.max(1, Math.ceil(newestFirst.length / EVENTS_PAGE));
  const page = Number.isSafeInteger(pageParam) && pageParam >= 1 ? Math.min(pageParam, pages) : 1;
  const eventRows = newestFirst.slice((page - 1) * EVENTS_PAGE, page * EVENTS_PAGE);
  const totalObserved = budgets.reduce((sum, row) => sum + row.observed, 0);
  const totalReserved = budgets.reduce((sum, row) => sum + row.reserved, 0);
  const totalCredits = budgets.reduce((sum, row) => sum + row.credits, 0);
  const fallbackRows = metrics.filter((row) => row.provider.startsWith("blockscout") || row.event.includes("fallback") || row.event === "budget_denied");
  const throttleCount = metrics.filter((row) => row.event.includes("429") || row.event.includes("throttled")).reduce((sum, row) => sum + row.count, 0);
  const checkpoint = (stream: string) => health.checkpoints.find((item) => item.stream === stream);
  const feed = checkpoint("feed");
  const runtime = checkpoint("runtime");
  const socket = checkpoint("socket");
  const ponsSocket = checkpoint("pons");
  const allCoverage = checkpoint("coverage:all");
  const nonPonsCoverage = checkpoint("coverage:nonpons");
  const heartbeatAt = runtime?.at ?? runtime?.updatedAt ?? null;
  const heartbeatAgeMs = heartbeatAt ? Math.max(0, now.getTime() - Date.parse(heartbeatAt)) : null;
  const runtimeFresh = heartbeatAgeMs !== null && Number.isFinite(heartbeatAgeMs) && heartbeatAgeMs <= 45_000;
  const feedAgeMs = feed?.at ? Math.max(0, now.getTime() - Date.parse(feed.at)) : null;
  const feedFresh = feedAgeMs !== null && Number.isFinite(feedAgeMs) && feedAgeMs <= 90_000;
  const serviceStatus = !runtimeFresh
    ? runtime ? "HEARTBEAT STALE" : "UNKNOWN"
    : runtime?.status === "running" && socket?.status === "connected" && ponsSocket?.status === "connected" && feedFresh
      ? "LIVE"
      : "DEGRADED";

  return (
    <>
      <AdminHeading title="System · Sequencer" sub="Read-only feed, confirmation, provider budget, and durable queue health." />
      {!health.available && (
        <InfoBox tone="warning">
          Sequencer persistence is unavailable ({health.unavailableReason ?? "read_failed"}). Empty values below are not a healthy or complete state.
        </InfoBox>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3 font-mono text-[11px] text-[#8a8a8a]">
        <span>WORKER</span>
        <Badge tone={serviceStatus === "LIVE" ? "success" : "warning"}>
          {serviceStatus}
        </Badge>
        <span>·</span><span>LAST 24H PROVIDER 429s: {throttleCount}</span>
        <span>·</span><span>UPDATED {stamp(now.toISOString())}</span>
      </div>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="QUEUE PENDING" value={health.available ? health.queue.pending : "—"} detail={`${health.queue.ready} ready`} />
        <Metric label="OLDEST QUEUED" value={health.available ? stamp(health.queue.oldestCreatedAt) : "—"} detail={`max retries ${health.queue.maxAttempts}`} />
        <Metric label="ESTIMATED PRO CREDITS TODAY" value={health.available ? totalCredits.toLocaleString() : "—"} detail={`${totalObserved.toLocaleString()} observed · ${totalReserved.toLocaleString()} reserved`} />
        <Metric label="LAST 24H PROVIDER EVENTS" value={metrics.reduce((sum, row) => sum + row.count, 0).toLocaleString()} detail="Robinscan, Blockscout, PumpDev, recovery and worker metrics" />
      </section>

      {health.queue.lastError && (
        <div className="mb-8 border border-[#4a3030] bg-[#160f0f] p-4">
        <h2 className="mb-2 font-mono text-[10px] tracking-[0.18em] text-[#c08070]">OLDEST RETRY ERROR</h2>
          <p className="break-words font-mono text-xs text-[#bd9b92]">{health.queue.lastError}</p>
        </div>
      )}

      <section className="mb-8 border border-[#2a2a2a] bg-[#141414] p-5">
        <h2 className="mb-4 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">FEED POSITION AND CONFIRMED COVERAGE</h2>
        <p className="mb-4 text-xs leading-relaxed text-[#777]">The raw feed sequence is a hint cursor. Confirmed coverage advances separately after scoped recovery and committed execution evidence.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <Checkpoint label="RAW FEED" item={feed} value={feed?.sequence == null ? "—" : `sequence ${feed.sequence}`} />
          <Checkpoint label="CONFIRMED · ALL FAMILIES" item={allCoverage} value={allCoverage?.nextBlock == null ? "—" : `next block ${allCoverage.nextBlock}`} />
          <Checkpoint label="CONFIRMED · NON-PONS" item={nonPonsCoverage} value={nonPonsCoverage?.nextBlock == null ? "—" : `next block ${nonPonsCoverage.nextBlock}`} />
        </div>
        <div className="mt-4 grid gap-2 text-xs text-[#777] sm:grid-cols-2">
          <span>Worker runtime: {runtime?.status ?? "—"} · heartbeat {stamp(heartbeatAt)}{runtimeFresh ? " · fresh" : ` · stale/unknown (threshold 45s)`}</span>
          <span>Sequencer socket: {socket?.status ?? "unknown"} · last change {stamp(socket?.at ?? socket?.updatedAt)}</span>
          <span>Feed progress: {feedFresh ? "fresh" : "stale/unknown (threshold 90s)"} · {stamp(feed?.at)}</span>
          <span>Pons socket: {ponsSocket?.status ?? "unknown"} · last change {stamp(ponsSocket?.at ?? ponsSocket?.updatedAt)}</span>
          <span>Robinscan: HTTP {checkpoint("provider:robinscan")?.lastStatus ?? "—"} · {checkpoint("provider:robinscan")?.reason ? sanitizeSequencerError(checkpoint("provider:robinscan")!.reason!) : "no cooldown"}</span>
          <span>Blockscout public: HTTP {checkpoint("provider:blockscout_public")?.lastStatus ?? "—"} · {checkpoint("provider:blockscout_public")?.reason ? sanitizeSequencerError(checkpoint("provider:blockscout_public")!.reason!) : "no cooldown"}</span>
          <span>Blockscout PRO: HTTP {checkpoint("provider:blockscout")?.lastStatus ?? "—"} · {checkpoint("provider:blockscout")?.reason ? sanitizeSequencerError(checkpoint("provider:blockscout")!.reason!) : "no cooldown"}</span>
        </div>
      </section>

      <section className="mb-8 border border-[#2a2a2a] bg-[#141414] p-5">
        <h2 className="mb-4 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">EXPLORER BUDGET · UTC DAY</h2>
        <p className="mb-4 text-xs text-[#777]">Sequencer PRO reservation caps: 10,000 credits per account and 20,000 total. Recorded attempts include scanner traffic; credits are estimates, not the provider billing ledger. Public Blockscout consumes no PRO credits.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric label="SEQUENCER PRO RESERVED" value={health.available ? `${totalReserved.toLocaleString()} / 20,000` : "—"} detail={`${totalObserved.toLocaleString()} estimated PRO credits across recorded callers`} />
          {budgets.map((row, index) => <Metric key={row.accountId} label={`ACCOUNT ${index + 1}`} value={`${row.reserved.toLocaleString()} / 10,000 reserved`} detail={`${row.observed.toLocaleString()} estimated PRO credits across recorded callers`} />)}
          {budgets.length === 0 && <Metric label="ACCOUNTS" value={health.available ? "No spend recorded" : "—"} detail="A missing row is not evidence that provider capacity is unlimited." />}
        </div>
      </section>

      <section className="mb-8 border border-[#2a2a2a] bg-[#141414] p-5">
        <h2 className="mb-4 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">RPC SPEND BY JOB · LAST 24H</h2>
        <p className="mb-4 text-xs text-[#777]">Every sequencer job's chain calls. Compute units use Alchemy's per-method weights; a job shows — until its first hour with unit accounting. Curve polling and scans are not in this table.</p>
        {spend.length === 0 ? <p className="text-xs text-[#666]">No RPC spend recorded in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left font-mono text-[11px]">
              <thead className="text-[#666]"><tr><th className="pb-2">JOB</th><th className="text-right">CALLS</th><th className="text-right">ERRORS</th><th className="text-right">COMPUTE UNITS</th><th className="pl-4">PROVIDERS</th></tr></thead>
              <tbody className="text-[#aaa]">
                {spend.map((r) => <tr key={r.job} className="border-t border-[#222]">
                  <td className="py-2 pr-3 text-[#ededea]">{r.job}</td><td className="text-right">{r.calls.toLocaleString()}</td><td className="text-right">{r.errors.toLocaleString()}</td><td className="text-right">{r.cu === null ? "—" : r.cu.toLocaleString()}</td>
                  <td className="pl-4">{r.providers.map((p) => `${p.id} ${p.calls}`).join(" · ")}</td>
                </tr>)}
                <tr className="border-t border-[#333] text-[#ededea]"><td className="py-2">TOTAL</td><td className="text-right">{spendCalls.toLocaleString()}</td><td className="text-right">{spend.reduce((n, r) => n + r.errors, 0).toLocaleString()}</td><td className="text-right">{spendCu === null ? "—" : spendCu.toLocaleString()}</td><td /></tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="border border-[#2a2a2a] bg-[#141414] p-5">
        <h2 className="mb-4 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">PROVIDER AND FALLBACK EVENTS · LAST 24H · NEWEST FIRST</h2>
        {metrics.length === 0 ? <p className="text-xs text-[#666]">No persisted events in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left font-mono text-[11px]">
              <thead className="text-[#666]"><tr><th className="pb-2">HOUR UTC</th><th>PROVIDER</th><th>EVENT</th><th>REASON</th><th className="text-right">COUNT</th><th className="text-right">CREDITS</th><th className="text-right">AVG MS</th></tr></thead>
              <tbody className="text-[#aaa]">{eventRows.map((row, i) => <tr key={`${row.hour}-${row.provider}-${row.event}-${row.reason}-${i}`} className="border-t border-[#222]">
                <td className="py-2 pr-3">{stamp(row.hour)}</td><td className="pr-3">{row.provider}</td><td className="pr-3">{row.event}</td><td className="max-w-[250px] break-words pr-3">{row.reason ? sanitizeSequencerError(row.reason) : "—"}</td><td className="text-right">{row.count}</td><td className="text-right">{row.credits}</td><td className="text-right">{row.count ? Math.round(row.latencyMs / row.count) : "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center gap-3 font-mono text-xs text-[#8a8a8a]">
            {page > 1 && <Link href={`/admin/sequencer?page=${page - 1}`} className="border border-[#2a2a2a] px-3 py-1.5 hover:text-[#ccff00]">← NEWER</Link>}
            <span>PAGE {page} / {pages}</span>
            {page < pages && <Link href={`/admin/sequencer?page=${page + 1}`} className="border border-[#2a2a2a] px-3 py-1.5 hover:text-[#ccff00]">OLDER →</Link>}
          </div>
        )}
        {fallbackRows.length > 0 && <p className="mt-3 text-[10px] text-[#666]">Fallback or budget-related rows are included above ({fallbackRows.length} event groups).</p>}
      </section>
    </>
  );
}

function Metric({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return <div className="border border-[#2a2a2a] bg-[#111] px-4 py-4"><div className="break-words text-lg font-semibold tabular-nums text-[#ededea]">{value}</div><div className="mt-2 font-mono text-[10px] tracking-[0.15em] text-[#8a8a8a]">{label}</div><div className="mt-1 text-[10px] text-[#5d5d5d]">{detail}</div></div>;
}

function Checkpoint({ label, item, value }: { label: string; item?: { at?: string; updatedAt: string; scope?: string }; value: string }) {
  return <div className="border border-[#242424] bg-[#101010] p-4"><div className="font-mono text-[10px] tracking-[0.15em] text-[#747474]">{label}</div><div className="mt-2 font-mono text-sm text-[#ededea]">{value}</div><div className="mt-1 text-[10px] text-[#606060]">checkpoint {stamp(item?.at ?? item?.updatedAt)}{item?.scope ? ` · ${item.scope}` : ""}</div></div>;
}
