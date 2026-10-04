import { AdminHeading } from "../../components/AdminShell";
import { InfoBox } from "../../components/ui";
import {
  readAnalyticsSummary,
  readAnalyticsTimeseries,
  readPreviousPeriodTimeseries,
  readTopPages,
  readTopReferrers,
  readCountryDistribution,
  readDeviceBreakdown,
  readIngestHealth,
  readBotTrend,
  type TimeRange,
} from "@/lib/data/analytics";
import { AnalyticsDashboardClient } from "./AnalyticsClient";

export const dynamic = "force-dynamic";

interface AnalyticsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const COUNTRIES_TOP_LIMIT = 12;
// Comfortably above the ~195 ISO country count; a "view all" table has no
// reason to paginate below that.
const COUNTRIES_ALL_LIMIT = 250;

function parseRange(raw: unknown): TimeRange {
  if (raw === "7d") return "7d";
  if (raw === "30d") return "30d";
  return "24h";
}

export default async function AnalyticsDashboard(props: AnalyticsPageProps) {
  const searchParams = await props.searchParams;
  const range = parseRange(searchParams.range);
  const countriesView = searchParams.countriesView === "all" ? "all" : "top";
  const countriesLimit =
    countriesView === "all" ? COUNTRIES_ALL_LIMIT : COUNTRIES_TOP_LIMIT;

  // Concurrent query fetching across all analytics domains (AGENTS.md §1)
  const [
    summary,
    timeseries,
    previousTimeseries,
    pages,
    referrers,
    countries,
    devices,
    ingestHealth,
    botTrend,
  ] = await Promise.all([
    readAnalyticsSummary(range),
    readAnalyticsTimeseries(range),
    readPreviousPeriodTimeseries(range),
    readTopPages(range, 12),
    readTopReferrers(range, 12),
    readCountryDistribution(range, countriesLimit),
    readDeviceBreakdown(range),
    readIngestHealth(),
    readBotTrend(range),
  ]);

  return (
    <>
      <AdminHeading
        title="Traffic Analytics"
        sub="Edge-logged request volume, latency profiles, error rates, and client distribution."
      />

      {!summary.available && (
        <InfoBox tone="warning">
          Analytics database is unconfigured or unreachable. Metrics will appear once the
          connection is established.
        </InfoBox>
      )}

      <AnalyticsDashboardClient
        summary={summary}
        timeseries={timeseries}
        previousTimeseries={previousTimeseries}
        pages={pages}
        referrers={referrers}
        countries={countries}
        countriesView={countriesView}
        devices={devices}
        botTrend={botTrend}
        ingestHealth={ingestHealth}
        range={range}
      />
    </>
  );
}
