import { Fragment } from "react";
import Link from "next/link";
import { AdminHeading } from "@/app/admin/components/AdminShell";
import { Badge, EmptyState, type Tone } from "@/app/admin/components/ui";
import { readRecentSwapPlanRuns, type SwapPlanRunRow } from "@/lib/data/swap-plan-runs";

export const dynamic = "force-dynamic";

function shortAddress(addr: string): string {
  if (!addr) return "—";
  if (addr === "0x0000000000000000000000000000000000000000") return "NATIVE";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function shortUuid(id: string): string {
  if (!id) return "—";
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function statusTone(status: string): Tone {
  switch (status) {
    case "ready":
      return "success";
    case "quote-unavailable":
    case "no-route":
      return "warning";
    case "invalid":
    case "disabled":
    case "fee-unconfigured":
    case "config-unavailable":
    case "unsupported-pair":
      return "danger";
    default:
      return "neutral";
  }
}

function formatUtc(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 50;

/** Order is the reading order when a quote is questioned: what was served, what it cost, why others lost. */
const DETAIL_KEYS = [
  "quoteOutcome", "routeType", "routeSource", "graphStatus", "graphCandidates", "graphSkipped", "hops", "selectedRouteKey", "selectedFeeTier", "priceImpactBps", "poolFeeBps",
  "quotedOut", "minOut", "slippageBps", "slippageMode", "simulationStatus", "roundTripStatus", "roundTripLossBps", "roundTripDetail", "advice", "searchComplete",
  "candidateCount", "alternativeCount", "excludedCount", "excludedPools", "unsearchedVenuesCount",
  "rpcAttempts", "rpcCu", "rpcMethods", "rpcProviders", "failureReason", "detail",
] as const;

function detailLine(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (meta.hops) parts.push(String(meta.hops));
  if (meta.routeSource === "graph") parts.push("pool graph");
  if (typeof meta.priceImpactBps === "number") parts.push(`impact ${(meta.priceImpactBps / 100).toFixed(2)}%`);
  if (typeof meta.poolFeeBps === "number") parts.push(`pool fee ${(meta.poolFeeBps / 100).toFixed(2)}%`);
  if (typeof meta.rpcAttempts === "number") parts.push(`${meta.rpcAttempts} rpc`);
  if (typeof meta.rpcCu === "number") parts.push(`${meta.rpcCu} CU`);
  if (typeof meta.excludedCount === "number") parts.push(`${meta.excludedCount} excluded`);
  return parts.join(" · ") || "open";
}

function pageHref(q: string | undefined, before: number | null): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (before) params.set("before", String(before));
  const qs = params.toString();
  return qs ? `/admin/swap/logs?${qs}` : "/admin/swap/logs";
}

export default async function SwapLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; before?: string }>;
}) {
  const { q, before } = (await searchParams) ?? {};
  const beforeId = Number.parseInt(before ?? "", 10);
  const cursor = Number.isSafeInteger(beforeId) && beforeId > 0 ? beforeId : null;
  let rows: SwapPlanRunRow[] = [];
  let storageUnavailable = false;
  try {
    rows = await readRecentSwapPlanRuns({ limit: PAGE_SIZE, query: q, beforeId: cursor });
  } catch {
    storageUnavailable = true;
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/swap"
          className="font-mono text-xs text-[#8a8a8a] transition-colors hover:text-[#ccff00]"
        >
          ← SWAP SETTINGS
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <AdminHeading
          title="Swap Plan · Request Logs"
          sub={`${PAGE_SIZE} per page, newest first. Open a row for its route, price impact, RPC mix and why pools lost.`}
        />

        <form method="GET" className="flex items-center gap-2">
          <input
            name="q"
            type="text"
            defaultValue={q ?? ""}
            placeholder="Search request ID, account, token..."
            className="w-64 border border-[#2a2a2a] bg-[#141414] px-3 py-1.5 font-mono text-xs text-[#ededea] placeholder-[#555] outline-none focus:border-[#ccff00]"
          />
          {q && (
            <Link
              href="/admin/swap/logs"
              className="border border-[#2a2a2a] bg-[#141414] px-2.5 py-1.5 font-mono text-xs text-[#8a8a8a] hover:text-[#ededea]"
            >
              CLEAR
            </Link>
          )}
          <button
            type="submit"
            className="border border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-1.5 font-mono text-xs font-bold text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
          >
            FILTER
          </button>
        </form>
      </div>

      {storageUnavailable ? (
        <EmptyState>Swap logs are unavailable. Apply database migration 0101 and reload.</EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState>
          {q
            ? `No swap plan requests matched query "${q}".`
            : "No swap plan requests recorded yet."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
          <table className="w-full text-left font-mono text-xs text-[#ededea]">
            <thead className="border-b border-[#2a2a2a] bg-[#0f0f0f] text-[10px] tracking-[0.14em] text-[#8a8a8a]">
              <tr>
                <th className="px-3 py-2.5">TIMESTAMP</th>
                <th className="px-3 py-2.5">REQUEST ID</th>
                <th className="px-3 py-2.5">PAIR</th>
                <th className="px-3 py-2.5">ACCOUNT</th>
                <th className="px-3 py-2.5">AMOUNT IN</th>
                <th className="px-3 py-2.5">STATUS</th>
                <th className="px-3 py-2.5">STAGE / CODE</th>
                <th className="px-3 py-2.5">LATENCY</th>
                <th className="px-3 py-2.5">METADATA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e1e1e]">
              {rows.map((row: SwapPlanRunRow) => {
                const meta = row.metadata;
                const failure = meta?.failureReason ? String(meta.failureReason) : null;
                const venue = meta?.selectedVenue ? String(meta.selectedVenue) : meta?.venue ? String(meta.venue) : null;
                const simStatus = meta?.simulationStatus ? String(meta.simulationStatus) : null;

                return (
                  <Fragment key={row.id}>
                  <tr className="transition-colors hover:bg-[#1a1a1a]">
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#8a8a8a]">
                      {formatUtc(row.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-[#ededea]" title={row.requestId}>
                      {shortUuid(row.requestId)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="text-[#ccff00]">{shortAddress(row.tokenIn)}</span>
                      <span className="mx-1 text-[#555]">→</span>
                      <span className="text-[#ccff00]">{shortAddress(row.tokenOut)}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#8a8a8a]" title={row.account}>
                      {shortAddress(row.account)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#ededea]" title={row.amountIn}>
                      {row.amountIn.length > 14 ? `${row.amountIn.slice(0, 10)}…` : row.amountIn}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="text-[#8a8a8a]">{row.stage ?? "—"}</span>
                      {row.code && <span className="text-[#ededea]"> / {row.code}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[#8a8a8a]">
                      {row.durationMs}ms
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-[#8a8a8a]">
                      {venue && (
                        <span className="mr-2 inline-block rounded bg-[#222] px-1.5 py-0.5 text-[10px] text-[#ccc]">
                          {venue}
                        </span>
                      )}
                      {simStatus && (
                        <span className="mr-2 inline-block rounded bg-[#222] px-1.5 py-0.5 text-[10px] text-[#ccc]">
                          sim: {simStatus}
                        </span>
                      )}
                      {failure && (
                        <span className="text-[#e0897a]" title={failure}>
                          {failure.length > 35 ? `${failure.slice(0, 35)}…` : failure}
                        </span>
                      )}
                      {!venue && !simStatus && !failure && (
                        <span className="text-[#555]">—</span>
                      )}
                    </td>
                  </tr>
                  {meta && (
                    <tr className="bg-[#101010]">
                      <td colSpan={9} className="px-3 pb-2.5 pt-0">
                        <details>
                          <summary className="cursor-pointer text-[10px] tracking-[0.14em] text-[#6a6a6a] hover:text-[#ccff00]">
                            DETAIL · {detailLine(meta)}
                          </summary>
                          <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[11px]">
                            {DETAIL_KEYS.filter((k) => meta[k] !== undefined && meta[k] !== null).map((k) => (
                              <Fragment key={k}>
                                <dt className="text-[#6a6a6a]">{k}</dt>
                                <dd className="break-all text-[#d4d4d4]">{String(meta[k])}</dd>
                              </Fragment>
                            ))}
                          </dl>
                        </details>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(cursor || rows.length === PAGE_SIZE) && (
        <div className="mt-4 flex gap-3 font-mono text-xs">
          {cursor && (
            <Link href={pageHref(q, null)} className="border border-[#2a2a2a] px-3 py-1.5 text-[#8a8a8a] hover:text-[#ccff00]">
              ← NEWEST
            </Link>
          )}
          {rows.length === PAGE_SIZE && (
            <Link href={pageHref(q, rows[rows.length - 1].id)} className="border border-[#2a2a2a] px-3 py-1.5 text-[#8a8a8a] hover:text-[#ccff00]">
              OLDER →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
