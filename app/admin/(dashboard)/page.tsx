import { AdminHeading } from "../components/AdminShell";
import { Badge, InfoBox, SectionLabel, StatTile } from "../components/ui";
import { readAdminOverviewStats } from "@/lib/data/observability";
import { flags } from "@/lib/config/flags";
import { scanCoordinator } from "@/lib/scan-control";

export const dynamic = "force-dynamic";

/**
 * Command center. Previously this page showed only 5 directory/ledger counts
 * and 2 of 10 feature flags — everything an admin actually needs to act on
 * day to day (the review queue, active marks, active stains, unresolved
 * errors) was invisible until they happened to click into that page. This
 * groups by urgency: NEEDS ATTENTION first, then the steady-state counts.
 */

const FLAG_ROWS: Array<{ key: keyof typeof flags; label: string; offNote?: string }> = [
  { key: "publicScan", label: "Public scan", offNote: "all scanning paused" },
  { key: "freshScan", label: "Fresh scan", offNote: "cached/ledger only" },
  { key: "ledgerAppend", label: "Ledger append", offNote: "no new receipts" },
  { key: "uniswapV2", label: "Uniswap V2 adapter" },
  { key: "uniswapV4", label: "Uniswap V4 adapter" },
  { key: "slowRugMonitor", label: "Slow-rug monitor", offNote: "job no-ops" },
  { key: "lineageTrace", label: "Lineage trace", offNote: "job no-ops" },
  { key: "wantedIngestion", label: "Wanted ingestion", offNote: "board frozen (§7.6)" },
  { key: "whitelist", label: "Whitelist onboarding", offNote: "signups closed" },
  { key: "launchIngest", label: "Launch registry ingest", offNote: "feed frozen" },
  { key: "mcp", label: "MCP server" },
];

export default async function AdminOverview() {
  const [
    pending,
    verdicts,
    indicted,
    tracked,
    published,
    openReview,
    activeMarks,
    activeStains,
    unresolvedErrors,
    launchpadsEnabled,
    launchpadsTotal,
    lockersTotal,
  ] = await readAdminOverviewStats();


  const coordinator = scanCoordinator();
  const capacity = coordinator ? await coordinator.readCapacitySnapshot(Date.now()) : null;

  return (
    <>
      <AdminHeading title="Overview" sub="What needs a decision, then the state of the record." />

      <SectionLabel>NEEDS ATTENTION</SectionLabel>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="OPEN REVIEW ITEMS"
          value={openReview}
          href="/admin/review"
          tone={openReview ? "warning" : "success"}
          hint="Scans that came back indefinite — SKIPs, unclassified contract custodians, unmeasured pools."
        />
        <StatTile
          label="ACTIVE HONEYPOT MARKS"
          value={activeMarks}
          href="/admin/marks"
          tone={activeMarks ? "danger" : "success"}
          hint="Tokens permanently capped at DANGER."
        />
        <StatTile
          label="ACTIVE WALLET STAINS"
          value={activeStains}
          href="/admin/web"
          tone={activeStains ? "warning" : "success"}
          hint="Wallets flagged by proximity to a confirmed rug."
        />
        <StatTile
          label="UNRESOLVED ERRORS"
          value={unresolvedErrors}
          href="/admin/logs"
          tone={unresolvedErrors ? "danger" : "success"}
          hint="Application errors not yet acknowledged or resolved."
        />
      </div>

      <SectionLabel>DIRECTORY</SectionLabel>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="PENDING LISTINGS"
          value={pending}
          href="/admin/listings"
          tone={pending ? "warning" : "neutral"}
        />
        <StatTile label="PUBLISHED PLATFORMS" value={published} href="/admin/listings" />
        <StatTile
          label="LAUNCHPADS"
          value={`${launchpadsEnabled}/${launchpadsTotal}`}
          href="/admin/launchpads"
          hint="enabled / registered"
        />
        <StatTile label="TRACKED LAUNCHES" value={tracked} />
      </div>

      <SectionLabel>SCANNER RECORD</SectionLabel>
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="VERDICTS ISSUED" value={verdicts} href="/admin/ledger" />
        <StatTile label="WALLETS INDICTED" value={indicted} href="/admin/wanted" />
        <StatTile label="TRUSTED LOCKERS" value={lockersTotal} href="/admin/lockers" hint="enabled" />
        <StatTile
          label="SCAN CAPACITY"
          value={capacity ? (capacity.reachable ? "OK" : "DEGRADED") : "OFF"}
          href="/admin/capacity"
          tone={!capacity ? "warning" : capacity.reachable ? "success" : "danger"}
          hint={
            !capacity
              ? "No Upstash configured — fresh scans disabled."
              : capacity.reachable
                ? `${capacity.pipelinesToday.used ?? 0}/${capacity.pipelinesToday.limit} pipelines today`
                : "Counters unreachable right now."
          }
        />
      </div>

      <SectionLabel>FEATURE FLAGS</SectionLabel>
      <div className="grid gap-x-8 gap-y-1.5 border border-[#2a2a2a] bg-[#141414] p-5 sm:grid-cols-2">
        {FLAG_ROWS.map((f) => {
          const on = flags[f.key] as boolean;
          return (
            <div key={f.key} className="flex items-center justify-between gap-3 py-0.5 text-xs">
              <span className="text-[#8a8a8a]">{f.label}</span>
              <Badge tone={on ? "success" : "neutral"}>
                {on ? "ENABLED" : f.offNote ? `OFF · ${f.offNote}` : "OFF"}
              </Badge>
            </div>
          );
        })}
      </div>
    </>
  );
}
