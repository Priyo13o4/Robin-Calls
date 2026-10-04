import { queryErrorEventsData, queryScanRunsData } from "@/lib/data/observability";

/**
 * Shared filter parsing + query building for the admin Logs panel and its CSV
 * export, so the table and the download always agree on what "the filtered
 * view" means (PRD §20.4).
 */

export const PAGE_SIZE = 50;
export const EXPORT_LIMIT = 1000;

export interface LogFilters {
  tab: "errors" | "scans";
  severity: string | null;
  outcome: string | null;
  token: string | null;
  search: string | null;
  unresolvedOnly: boolean;
  overBudgetOnly: boolean;
  /** Display timezone for timestamps. Stored values are UTC; this is view-only. */
  tz: "utc" | "ist";
  /** Cursor: rows with id strictly below this (id desc ≈ time desc on append-only logs). */
  beforeId: number | null;
}

/** Keep filter text safe for PostgREST `or=` expressions. */
const sanitize = (v: string) => v.replace(/[^\w.\- ]/g, "").trim();

export function parseLogFilters(params: Record<string, string | undefined>): LogFilters {
  const beforeId = Number.parseInt(params.before ?? "", 10);
  return {
    tab: params.tab === "scans" ? "scans" : "errors",
    severity: ["WARN", "ERROR", "FATAL"].includes(params.severity ?? "")
      ? (params.severity as string)
      : null,
    outcome: ["complete", "partial", "rejected", "failed"].includes(params.outcome ?? "")
      ? (params.outcome as string)
      : null,
    token: params.token ? sanitize(params.token).toLowerCase() : null,
    search: params.q ? sanitize(params.q) : null,
    unresolvedOnly: params.unresolved === "1",
    overBudgetOnly: params.overbudget === "1",
    tz: params.tz === "ist" ? "ist" : "utc",
    beforeId: Number.isFinite(beforeId) && beforeId > 0 ? beforeId : null,
  };
}

export async function errorEventsQuery(f: LogFilters, limit: number) {
  return queryErrorEventsData(f, limit);
}

export async function scanRunsQuery(f: LogFilters, limit: number) {
  return queryScanRunsData(f, limit);
}
