import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { parseLogFilters, EXPORT_LIMIT } from "../query";
import { queryErrorEventsData, queryScanRunsData } from "@/lib/data/observability";
import { toCsv, csvFilenameStamp } from "@/lib/format/csv";

/**
 * Size-limited CSV export of the filtered, sanitized Logs view (PRD §20.4).
 * Rows are already redacted at ingestion; this route only flattens them.
 * Stack traces and detail payloads are deliberately excluded from CSV —
 * they don't survive flattening and belong in the panel's detail view.
 */

const ERROR_COLUMNS = [
  "id", "occurred_at", "severity", "category", "code", "message", "fingerprint",
  "route", "operation", "request_id", "scan_id", "token_address", "provider_id",
  "http_status", "request_outcome", "acknowledged_at", "acknowledged_by",
  "resolved_at", "resolved_by",
] as const;

const SCAN_COLUMNS = [
  "id", "scan_id", "request_id", "token_address", "started_at", "duration_ms",
  "outcome", "source", "receipt_action", "verdict_id", "score", "tier",
  "rpc_logical_calls", "rpc_physical_attempts", "rpc_expected_reverts",
  "rpc_provider_switches", "rpc_total_latency_ms", "rpc_budget_exceeded",
  "error_code", "evidence_bytes",
] as const;

export async function GET(req: NextRequest) {
  await requireAdmin(); // redirects to /admin/login when not an admin

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const f = parseLogFilters(params);
  const data =
    f.tab === "errors"
      ? await queryErrorEventsData(f, EXPORT_LIMIT)
      : await queryScanRunsData(f, EXPORT_LIMIT);

  const columns = f.tab === "errors" ? ERROR_COLUMNS : SCAN_COLUMNS;

  const csv = toCsv(columns, (data as unknown as Record<string, unknown>[]) ?? []);
  const stamp = csvFilenameStamp();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="robincalls-${f.tab}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
