import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { toCsv, csvFilenameStamp } from "@/lib/format/csv";
import {
  readAnalyticsSummary,
  readAnalyticsTimeseries,
  readTopPages,
  readTopReferrers,
  readCountryDistribution,
  readDeviceBreakdown,
  type TimeRange,
} from "@/lib/data/analytics";

/**
 * CSV export for the analytics dashboard, mirroring logs/export/route.ts's
 * shape (requireAdmin, size-bounded, no-store). `dataset` picks which of the
 * six read functions backs the file — there is no combined export because
 * they don't share a row shape.
 */

const DATASETS = [
  "summary",
  "timeseries",
  "pages",
  "referrers",
  "countries",
  "devices",
  "browsers",
  "os",
  "bots",
] as const;
type Dataset = (typeof DATASETS)[number];

const TIMESERIES_COLUMNS = [
  "timestamp", "views", "visitors", "latencyMs", "p95LatencyMs", "errors",
  "status2xx", "status3xx", "status4xx", "status5xx", "bytes",
] as const;

const RANKED_COLUMNS = ["name", "code", "count", "uniqueCount", "percentage"] as const;

/** Pages carry timing; referrers and countries do not, so they keep the base set. */
const PAGE_COLUMNS = [
  ...RANKED_COLUMNS,
  "avgLatencyMs",
  "p95LatencyMs",
  "latencySamples",
] as const;

function parseRange(raw: string | null): TimeRange {
  if (raw === "7d") return "7d";
  if (raw === "30d") return "30d";
  return "24h";
}

function parseDataset(raw: string | null): Dataset {
  return (DATASETS as readonly string[]).includes(raw ?? "")
    ? (raw as Dataset)
    : "timeseries";
}

export async function GET(req: NextRequest) {
  await requireAdmin(); // redirects to /admin/login when not an admin

  const range = parseRange(req.nextUrl.searchParams.get("range"));
  const dataset = parseDataset(req.nextUrl.searchParams.get("dataset"));

  let columns: readonly string[];
  let rows: unknown[];

  switch (dataset) {
    case "summary": {
      const s = await readAnalyticsSummary(range);
      columns = [
        "available", "totalViews", "totalUniqueVisitors", "totalBytes",
        "avgLatencyMs", "p95LatencyMs", "errorRatePercent",
        "status2xx", "status3xx", "status4xx", "status5xx",
        "viewsDeltaPercent", "visitorsDeltaPercent",
      ];
      rows = [{
        ...s,
        viewsDeltaPercent: s.previousPeriodDelta.viewsDeltaPercent,
        visitorsDeltaPercent: s.previousPeriodDelta.visitorsDeltaPercent,
      }];
      break;
    }
    case "pages":
      columns = PAGE_COLUMNS;
      rows = await readTopPages(range, 1000);
      break;
    case "referrers":
      columns = RANKED_COLUMNS;
      rows = await readTopReferrers(range, 1000);
      break;
    case "countries":
      columns = RANKED_COLUMNS;
      rows = await readCountryDistribution(range, 1000);
      break;
    case "devices":
    case "browsers":
    case "os":
    case "bots": {
      const b = await readDeviceBreakdown(range);
      columns = RANKED_COLUMNS;
      rows = b[dataset];
      break;
    }
    case "timeseries":
    default:
      columns = TIMESERIES_COLUMNS;
      rows = await readAnalyticsTimeseries(range);
      break;
  }

  const csv = toCsv(columns, rows as Record<string, unknown>[]);
  const stamp = csvFilenameStamp();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="robincalls-analytics-${dataset}-${range}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
