import { AdminHeading } from "../../components/AdminShell";
import { Badge, InfoBox } from "../../components/ui";
import { flags, RUG_CRITERIA_VERSION } from "@/lib/config/flags";
import { scanMarketProviderId } from "@/lib/market/registry";
import {
  scanControlConfig,
  scanCoordinator,
  type CapacityGauge,
  type CapacitySnapshot,
} from "@/lib/scan-control";

export const dynamic = "force-dynamic";

/**
 * Phase 6 acceptance §24.15 — daily capacity has an admin-visible status.
 * Read-only: reads the live Valkey counters without consuming budget, and
 * surfaces the kill switches + launch-gating flags an operator flips under load.
 */

function pct(g: CapacityGauge): number | null {
  if (g.used === null || g.limit <= 0) return null;
  return Math.min(100, Math.round((g.used / g.limit) * 100));
}

function Gauge({ label, gauge, hint }: { label: string; gauge: CapacityGauge; hint?: string }) {
  const p = pct(gauge);
  const used = gauge.used === null ? "—" : gauge.used;
  const remaining = gauge.used === null ? null : Math.max(0, gauge.limit - gauge.used);
  // Amber past 75%, red past 90% — the operator's "shed load soon" signal.
  const bar = p === null ? "#3d3d3d" : p >= 90 ? "#8a3a30" : p >= 75 ? "#8a6d1f" : "#3d5c3d";
  return (
    <div className="border border-[#2a2a2a] bg-[#141414] px-5 py-5">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-bold tabular-nums text-[#ededea]">
          {used}
          <span className="text-base font-normal text-[#8a8a8a]"> / {gauge.limit}</span>
        </span>
        {remaining !== null && (
          <span className="font-mono text-[11px] text-[#8a8a8a]">{remaining} left</span>
        )}
      </div>
      <div className="mt-3 h-1 w-full bg-[#0a0a0a]">
        <div className="h-full" style={{ width: `${p ?? 0}%`, background: bar }} />
      </div>
      <div className="mt-2 text-[11px] tracking-[0.16em] text-[#8a8a8a]">{label}</div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-[#4a4a4a]">{hint}</div>}
    </div>
  );
}

function Flag({ label, on, offNote }: { label: string; on: boolean; offNote?: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-[#8a8a8a]">{label}</span>
      <Badge tone={on ? "success" : "neutral"}>
        {on ? "ENABLED" : offNote ? `OFF · ${offNote}` : "OFF"}
      </Badge>
    </li>
  );
}

/**
 * The clock read lives here, outside the component body: `Date.now()` is impure,
 * and calling it during render is a purity violation even in an async Server
 * Component. Every coordinator method takes `nowMs` from its caller by design
 * (lib/scan-control/types.ts) so the clock stays injectable for tests — so the
 * fix is to read it at the edge, not to widen that interface. `force-dynamic`
 * above keeps this per-request, so the snapshot is still live, not build-time.
 */
async function readCapacity(): Promise<CapacitySnapshot | null> {
  const coordinator = scanCoordinator();
  if (!coordinator) return null;
  return coordinator.readCapacitySnapshot(Date.now());
}

export default async function CapacityStatus() {
  const cfg = scanControlConfig();
  const snapshot = await readCapacity();

  // Never re-derive the default here: a duplicate would let this page report a
  // provider the scanner is not using (§8 #20).
  const marketProvider = scanMarketProviderId();

  return (
    <>
      <AdminHeading title="Capacity" sub="Live scan budget and the switches that shed load." />

      {/* A null snapshot means no coordinator at all — readCapacity only returns
          null when Valkey is unconfigured. A configured-but-unreachable Valkey
          still returns a snapshot, with `reachable: false`. */}
      {!snapshot ? (
        <InfoBox tone="danger">
          Scan coordination is not configured (no Valkey). In production this means{" "}
          <span className="font-semibold">fresh scans are disabled</span> — only cached
          and ledger reads are served (PRD §10.4). Set{" "}
          <span className="font-mono">REDIS_URL</span> to enable them.
        </InfoBox>
      ) : !snapshot.reachable ? (
        <InfoBox tone="warning">
          Valkey is configured but the counters could not be read right now. Limits
          still apply on the scan path; the numbers below are unavailable until it
          recovers.
        </InfoBox>
      ) : null}

      {snapshot && (
        <>
          <div className="mb-2 flex items-center gap-3 font-mono text-[11px] text-[#8a8a8a]">
            <span>
              COORDINATION:{" "}
              <span className="text-[#ededea]">{snapshot.coordinator.toUpperCase()}</span>
            </span>
            <span>·</span>
            <span>UTC DAY {snapshot.day}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Gauge
              label="FRESH PIPELINES TODAY"
              gauge={snapshot.pipelinesToday}
              hint="Resets at UTC midnight."
            />
            <Gauge
              label="CANONICAL RECEIPTS TODAY"
              gauge={snapshot.receiptsToday}
              hint="New ledger writes; reuse/cache don't count."
            />
            <Gauge
              label="PIPELINES RUNNING NOW"
              gauge={snapshot.activePipelines}
              hint="Raise the cap only after RPC load testing."
            />
            <Gauge label="GLOBAL BURST WINDOW" gauge={snapshot.globalBurst} />
          </div>
        </>
      )}

      <div className="mt-8 grid gap-3 lg:grid-cols-2">
        <div className="border border-[#2a2a2a] bg-[#141414] p-5">
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
            KILL SWITCHES &amp; GATES
          </h2>
          <ul className="space-y-1 text-xs">
            <Flag label="Public scan" on={flags.publicScan} offNote="all scanning paused" />
            <Flag label="Fresh scan" on={flags.freshScan} offNote="cached/ledger only" />
            <Flag label="Ledger append" on={flags.ledgerAppend} offNote="no new receipts" />
            <Flag label="Uniswap V2 adapter" on={flags.uniswapV2} />
            <Flag label="Uniswap V4 adapter" on={flags.uniswapV4} />
            <Flag label="The Watch (slow-rug)" on={flags.slowRugMonitor} offNote="job no-ops" />
            <Flag label="Lineage trace" on={flags.lineageTrace} offNote="job no-ops" />
            <Flag
              label="Wanted ingestion"
              on={flags.wantedIngestion}
              offNote="board frozen (§7.6)"
            />
            <Flag label="MCP server" on={flags.mcp} />
          </ul>
        </div>

        <div className="border border-[#2a2a2a] bg-[#141414] p-5">
          <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
            CONFIGURED LIMITS
          </h2>
          <div className="space-y-3 text-xs text-[#8a8a8a]">
            <div>
              <p className="mb-1 text-[10px] tracking-[0.14em] text-[#4a4a4a]">PER-IP RATE</p>
              <p>
                {cfg.ipBurstLimit} requests / {cfg.ipBurstWindowSeconds}s burst ·{" "}
                {cfg.ipDailyLimit} / day
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] tracking-[0.14em] text-[#4a4a4a]">GLOBAL RATE</p>
              <p>
                {cfg.globalBurstLimit} / {cfg.globalBurstWindowSeconds}s burst ·{" "}
                {cfg.globalMaxConcurrent} running at once
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] tracking-[0.14em] text-[#4a4a4a]">DAILY CAPS</p>
              <p>
                {cfg.globalDailyPipelineLimit} fresh pipelines · {cfg.globalDailyReceiptLimit}{" "}
                canonical receipts
              </p>
            </div>
            <div>
              <p className="mb-1 text-[10px] tracking-[0.14em] text-[#4a4a4a]">TIMING</p>
              <p>
                {cfg.tokenCooldownSeconds}s cooldown per token · lock {cfg.lockTtlSeconds}s TTL /{" "}
                {cfg.lockWaitSeconds}s wait
              </p>
            </div>
            <p className="border-t border-[#2a2a2a] pt-2 text-[#4a4a4a]">
              Market provider: {marketProvider} · Rug criteria: {RUG_CRITERIA_VERSION}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
