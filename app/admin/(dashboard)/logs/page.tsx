import { ActionForm } from "@/app/admin/components/ActionForm";
import Link from "next/link";
import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, type Tone } from "../../components/ui";
import { readUnresolvedAppErrorCount } from "@/lib/data/observability";
import { acknowledgeErrorAction, resolveErrorAction } from "./actions";
import {
  errorEventsQuery,
  parseLogFilters,
  scanRunsQuery,
  PAGE_SIZE,
  type LogFilters,
} from "./query";

export const dynamic = "force-dynamic";


/**
 * Admin Logs panel (PRD §20.4): sanitized application errors and per-pipeline
 * scan summaries. Server-rendered, GET-filterable, cursor-paginated (id desc).
 */

interface ErrorRow {
  id: number;
  occurred_at: string;
  severity: string;
  category: string;
  code: string;
  message: string;
  fingerprint: string;
  route: string | null;
  operation: string | null;
  request_id: string | null;
  scan_id: string | null;
  token_address: string | null;
  provider_id: string | null;
  http_status: number | null;
  request_outcome: string | null;
  stack: string | null;
  details: unknown;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface ScanRow {
  id: number;
  scan_id: string;
  request_id: string | null;
  token_address: string;
  started_at: string;
  duration_ms: number | null;
  outcome: string | null;
  source: string | null;
  receipt_action: string | null;
  verdict_id: number | null;
  score: number | null;
  tier: string | null;
  rpc_logical_calls: number;
  rpc_physical_attempts: number;
  rpc_expected_reverts: number;
  rpc_provider_switches: number;
  rpc_method_counts: Record<string, number> | null;
  rpc_total_latency_ms: number | null;
  rpc_budget_exceeded: boolean;
  provider_states: Record<string, string> | null;
  /** Migration 0067. Null on rows written before it, and on scans that made no
   *  RPC attempt — the render distinguishes those two from a served-nothing map. */
  provider_calls: Record<string, { n: number; err: number; ms: number }> | null;
  error_code: string | null;
  evidence_bytes: number | null;
}

const short = (v: string | null, n = 12) => (v ? `${v.slice(0, n)}…` : "—");
/**
 * Timestamps persist as UTC (Postgres timestamptz serializes with a +00:00
 * offset). UTC is the default view — the naive slice already shows the stored
 * wall-clock. IST (UTC+5:30) is opt-in via the toggle: parse the offset-bearing
 * ISO to an instant and reformat in Asia/Kolkata. The zone is labelled either
 * way so the number is never ambiguous.
 */
const when = (iso: string, tz: "utc" | "ist" = "utc") => {
  if (tz !== "ist") return `${iso.replace("T", " ").slice(0, 19)} UTC`;
  const s = new Date(iso)
    .toLocaleString("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(",", "");
  return `${s} IST`;
};

/** Rebuild the query string, preserving active filters. */
/** Labelled monospace blob — the detail rows carry several and they are easy
 *  to confuse unheaded (see the SERVED/DENIED pair below). */
function Blob({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#2a2a2a] bg-[#0a0a0a] p-3">
      <div className="mb-1.5 font-mono text-[9px] tracking-[0.18em] text-[#5a5a5a]">{label}</div>
      <pre className="overflow-auto font-mono text-[10px] text-[#8a8a8a]">{children}</pre>
    </div>
  );
}

/**
 * `provider_calls` as one line per provider, busiest first — this is the column
 * people open the row to read, and raw JSON buries it.
 *
 * Renders whatever shape the row actually holds rather than trusting the type:
 * these are historical rows, and a scan written before migration 0067 has no
 * key here at all.
 */
function providerCallLines(raw: unknown): string {
  if (!raw || typeof raw !== "object") return String(raw);
  const entries = Object.entries(raw as Record<string, unknown>)
    .map(([id, v]) => {
      const s = (v ?? {}) as { n?: number; err?: number; ms?: number };
      return { id, n: s.n ?? 0, err: s.err ?? 0, ms: s.ms ?? 0 };
    })
    .sort((a, b) => b.n - a.n);
  if (entries.length === 0) return "{}";
  const pad = Math.max(...entries.map((e) => e.id.length));
  return entries
    .map(
      (e) =>
        `${e.id.padEnd(pad)}  ${String(e.n).padStart(4)} calls  ${String(e.err).padStart(3)} err  ${e.ms} ms`
    )
    .join("\n");
}

function qs(f: LogFilters, overrides: Record<string, string | null>): string {
  const params = new URLSearchParams();
  const base: Record<string, string | null> = {
    tab: f.tab,
    severity: f.severity,
    outcome: f.outcome,
    token: f.token,
    q: f.search,
    unresolved: f.unresolvedOnly ? "1" : null,
    overbudget: f.overBudgetOnly ? "1" : null,
    tz: f.tz === "ist" ? "ist" : null,
    ...overrides,
  };
  for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
  return `?${params.toString()}`;
}

const SEVERITY_TONE: Record<string, Tone> = {
  WARN: "warning",
  ERROR: "danger",
  FATAL: "danger",
};
const OUTCOME_TONE: Record<string, Tone> = {
  complete: "success",
  partial: "warning",
  rejected: "warning",
  failed: "danger",
};

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const f = parseLogFilters(await searchParams);

  let errors: ErrorRow[] = [];
  let scans: ScanRow[] = [];
  if (f.tab === "errors") {
    errors = (await errorEventsQuery(f, PAGE_SIZE)) as any[];
  } else {
    scans = (await scanRunsQuery(f, PAGE_SIZE)) as any[];
  }
  const rows = f.tab === "errors" ? errors : scans;
  const lastId = rows.length === PAGE_SIZE ? rows[rows.length - 1].id : null;
  const unresolvedCount = await readUnresolvedAppErrorCount();


  return (
    <>
      <AdminHeading
        title="Logs"
        sub="Sanitized application errors and fresh-scan pipeline summaries. Retention-bounded; secrets and provider URLs are redacted before persistence."
      />

      {/* tabs */}
      <div className="mb-4 flex gap-2">
        {(["errors", "scans"] as const).map((tab) => (
          <Link
            key={tab}
            href={qs({ ...f, tab }, { before: null })}
            className={`border px-4 py-1.5 font-mono text-[11px] tracking-[0.16em] transition-colors ${
              f.tab === tab
                ? "border-[#ededea] text-[#ededea]"
                : "border-[#2a2a2a] text-[#8a8a8a] hover:text-[#ededea]"
            }`}
          >
            {tab === "errors" ? "ERROR EVENTS" : "SCAN RUNS"}
            {tab === "errors" && unresolvedCount > 0 && (
              <span className="ml-2 rounded-full bg-[#8a3a30] px-1.5 py-px text-[9px] font-bold text-[#ededea]">
                {unresolvedCount}
              </span>
            )}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {/* timezone toggle — display only; stored values stay UTC */}
          <div className="flex border border-[#2a2a2a]">
            {(["utc", "ist"] as const).map((z) => (
              <Link
                key={z}
                href={qs({ ...f, tz: z }, {})}
                className={`px-3 py-1.5 font-mono text-[11px] tracking-[0.16em] transition-colors ${
                  f.tz === z
                    ? "bg-[#1c1c1c] text-[#ededea]"
                    : "text-[#8a8a8a] hover:text-[#ededea]"
                }`}
              >
                {z.toUpperCase()}
              </Link>
            ))}
          </div>
          <Link
            href={`/admin/logs/export${qs(f, { before: null })}`}
            className="border border-[#2a2a2a] px-4 py-1.5 font-mono text-[11px] tracking-[0.16em] text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ccff00]"
          >
            EXPORT CSV
          </Link>
        </div>
      </div>

      {/* filters */}
      <form className="mb-6 flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="tab" value={f.tab} />
        <input type="hidden" name="tz" value={f.tz} />
        {f.tab === "errors" ? (
          <select
            name="severity"
            defaultValue={f.severity ?? ""}
            className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea]"
          >
            <option value="">ALL SEVERITIES</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
            <option value="FATAL">FATAL</option>
          </select>
        ) : (
          <select
            name="outcome"
            defaultValue={f.outcome ?? ""}
            className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea]"
          >
            <option value="">ALL OUTCOMES</option>
            <option value="complete">complete</option>
            <option value="partial">partial</option>
            <option value="rejected">rejected</option>
            <option value="failed">failed</option>
          </select>
        )}
        <input
          name="token"
          defaultValue={f.token ?? ""}
          placeholder="token address"
          className="w-52 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d]"
        />
        <input
          name="q"
          defaultValue={f.search ?? ""}
          placeholder={f.tab === "errors" ? "code / message" : "error code / scan id"}
          className="w-52 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d]"
        />
        <label className="flex items-center gap-2 px-1 py-2 font-mono text-[11px] text-[#8a8a8a]">
          {f.tab === "errors" ? (
            <>
              <input type="checkbox" name="unresolved" value="1" defaultChecked={f.unresolvedOnly} />
              UNRESOLVED ONLY
            </>
          ) : (
            <>
              <input type="checkbox" name="overbudget" value="1" defaultChecked={f.overBudgetOnly} />
              OVER RPC BUDGET
            </>
          )}
        </label>
        <button className="border border-[#2a2a2a] px-4 py-2 text-[11px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ededea] hover:text-[#ededea]">
          FILTER
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState>Nothing matches this filter. Quiet night.</EmptyState>
      ) : f.tab === "errors" ? (
        <div className="space-y-2">
          {errors.map((r) => (
            <details key={r.id} className="border border-[#2a2a2a] bg-[#141414]">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 font-mono text-[11px]">
                <span className="text-[#3d3d3d]">#{r.id}</span>
                <span className="text-[#8a8a8a]">{when(r.occurred_at, f.tz)}</span>
                <Badge tone={SEVERITY_TONE[r.severity] ?? "neutral"}>{r.severity}</Badge>
                <span className="text-[#ededea]">{r.code}</span>
                <span className="hidden text-[#8a8a8a] sm:inline">{r.route ?? r.operation ?? ""}</span>
                <span className="ml-auto flex items-center gap-2">
                  {r.resolved_at ? (
                    <Badge tone="neutral">RESOLVED</Badge>
                  ) : r.acknowledged_at ? (
                    <Badge tone="neutral">ACK</Badge>
                  ) : (
                    <Badge tone="warning">OPEN</Badge>
                  )}
                </span>
              </summary>
              <div className="space-y-3 border-t border-[#2a2a2a] px-4 py-3 text-xs">
                <p className="text-[#ededea]">{r.message}</p>
                <div className="grid gap-1 font-mono text-[10px] text-[#8a8a8a] sm:grid-cols-2">
                  <span>fingerprint <code className="text-[#ededea]">{r.fingerprint}</code></span>
                  <span>category <code className="text-[#ededea]">{r.category}</code></span>
                  <span>request <code className="text-[#ededea]">{r.request_id ?? "—"}</code></span>
                  <span>scan <code className="text-[#ededea]">{r.scan_id ?? "—"}</code></span>
                  {r.token_address && (
                    <span>
                      token{" "}
                      <Link href={`/scan/${r.token_address}`} className="text-[#ededea] hover:underline">
                        {r.token_address}
                      </Link>
                    </span>
                  )}
                  {r.provider_id && <span>provider <code className="text-[#ededea]">{r.provider_id}</code></span>}
                  {r.operation && <span>operation <code className="text-[#ededea]">{r.operation}</code></span>}
                  {r.http_status != null && <span>http <code className="text-[#ededea]">{r.http_status}</code></span>}
                  {r.resolved_at && (
                    <span>resolved {when(r.resolved_at, f.tz)} by {r.resolved_by ?? "admin"}</span>
                  )}
                </div>
                {r.stack && (
                  <pre className="max-h-64 overflow-auto border border-[#2a2a2a] bg-[#0a0a0a] p-3 font-mono text-[10px] leading-relaxed text-[#8a8a8a]">
                    {r.stack}
                  </pre>
                )}
                {r.details != null && (
                  <pre className="max-h-64 overflow-auto border border-[#2a2a2a] bg-[#0a0a0a] p-3 font-mono text-[10px] leading-relaxed text-[#8a8a8a]">
                    {JSON.stringify(r.details, null, 2)}
                  </pre>
                )}
                {!r.resolved_at && (
                  <div className="flex gap-2">
                    {!r.acknowledged_at && (
                      <ActionForm action={acknowledgeErrorAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="border border-[#2a2a2a] px-3 py-1.5 text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ededea] hover:text-[#ededea]">
                          ACKNOWLEDGE
                        </button>
                      </ActionForm>
                    )}
                    <ActionForm action={resolveErrorAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="border border-[#2a2a2a] px-3 py-1.5 text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ccff00]">
                        RESOLVE
                      </button>
                    </ActionForm>
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {scans.map((r) => (
            <details key={r.id} className="border border-[#2a2a2a] bg-[#141414]">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-2.5 font-mono text-[11px]">
                <span className="text-[#3d3d3d]">#{r.id}</span>
                <span className="text-[#8a8a8a]">{when(r.started_at, f.tz)}</span>
                <Link href={`/scan/${r.token_address}`} className="text-[#ededea] hover:underline">
                  {short(r.token_address, 10)}
                </Link>
                <Badge tone={r.outcome ? (OUTCOME_TONE[r.outcome] ?? "neutral") : "neutral"}>
                  {r.outcome ?? "—"}
                </Badge>
                <span className="text-[#8a8a8a]">
                  rpc {r.rpc_logical_calls}/{r.rpc_physical_attempts}
                </span>
                {r.rpc_budget_exceeded && <Badge tone="danger">OVER BUDGET</Badge>}
                <span className="ml-auto text-[#8a8a8a]">
                  {r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : ""}
                </span>
              </summary>
              <div className="space-y-3 border-t border-[#2a2a2a] px-4 py-3 text-xs">
                <div className="grid gap-1 font-mono text-[10px] text-[#8a8a8a] sm:grid-cols-2">
                  <span>scan <code className="text-[#ededea]">{r.scan_id}</code></span>
                  <span>request <code className="text-[#ededea]">{r.request_id ?? "—"}</code></span>
                  <span>receipt <code className="text-[#ededea]">{r.receipt_action ?? "—"}</code>
                    {r.verdict_id ? ` · verdict #${r.verdict_id}` : ""}</span>
                  <span>score <code className="text-[#ededea]">{r.score ?? "—"}</code> · tier <code className="text-[#ededea]">{r.tier ?? "—"}</code></span>
                  <span>expected reverts <code className="text-[#ededea]">{r.rpc_expected_reverts}</code></span>
                  <span>provider switches <code className="text-[#ededea]">{r.rpc_provider_switches}</code></span>
                  <span>rpc latency <code className="text-[#ededea]">{r.rpc_total_latency_ms ?? "—"} ms</code></span>
                  <span>evidence <code className="text-[#ededea]">{r.evidence_bytes ?? "—"} B</code></span>
                  {r.error_code && <span>error <code className="text-[#d97a6a]">{r.error_code}</code></span>}
                </div>
                {r.rpc_method_counts && (
                  <Blob label="METHODS">{JSON.stringify(r.rpc_method_counts, null, 2)}</Blob>
                )}
                {/* SERVED vs DENIED — labelled because absence means opposite
                    things in the two maps, and they used to render identically
                    as two unheaded blobs (docs/KNOWN-PROBLEMS.md L40). */}
                {r.provider_calls ? (
                  <Blob label="PROVIDERS · SERVED">
                    {providerCallLines(r.provider_calls)}
                  </Blob>
                ) : (
                  <Blob label="PROVIDERS · SERVED">no RPC attempted this scan</Blob>
                )}
                {r.provider_states && (
                  <Blob label="PROVIDERS · DENIED">
                    {JSON.stringify(r.provider_states, null, 2)}
                  </Blob>
                )}
              </div>
            </details>
          ))}
        </div>
      )}

      {/* cursor pagination */}
      {lastId && (
        <div className="mt-6 text-center">
          <Link
            href={qs(f, { before: String(lastId) })}
            className="border border-[#2a2a2a] px-5 py-2 font-mono text-[11px] tracking-[0.16em] text-[#8a8a8a] hover:border-[#ededea] hover:text-[#ededea]"
          >
            OLDER →
          </Link>
        </div>
      )}
    </>
  );
}
