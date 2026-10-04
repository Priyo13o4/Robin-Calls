import Link from "next/link";
import { AdminHeading } from "../../components/AdminShell";
import { EmptyState, InfoBox, SectionLabel } from "../../components/ui";
import { readIndictedDeployers } from "@/lib/data/wanted";
import { flags } from "@/lib/config/flags";

export const dynamic = "force-dynamic";

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

export default async function AdminWanted() {
  const rows = await readIndictedDeployers(200);


  return (
    <>
      <AdminHeading title="The Wanted Board" sub="Indicted deployer wallets." />

      {!flags.wantedIngestion && (
        <InfoBox tone="warning">
          Auto-indictment is <span className="font-semibold">off</span>. No wallet
          is added to this board right now — even when a scan proves a rug — because
          the rug-detection rules are still being finalized. Turn it on by setting{" "}
          <span className="font-mono">ENABLE_WANTED_INGESTION=true</span>{" "}
          once the criteria are locked. Until then scans still run and get recorded;
          this board just stays empty.
        </InfoBox>
      )}

      <SectionLabel count={rows.length}>INDICTMENTS</SectionLabel>
      {rows.length === 0 ? (
        <EmptyState>No indictments on record.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-[10px] tracking-[0.2em] text-[#8a8a8a]">
                <th className="px-4 py-3 font-medium">DEPLOYER</th>
                <th className="px-4 py-3 font-medium">RUGS</th>
                <th className="px-4 py-3 font-medium">DEAD LAUNCHES</th>
                <th className="px-4 py-3 font-medium">TOOK</th>
                <th className="px-4 py-3 font-medium">FUNDING LINEAGE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#2a2a2a] font-mono text-xs last:border-0">
                  <td className="px-4 py-3 text-[#ededea]">{short(r.address)}</td>
                  <td className="px-4 py-3">{r.confirmed_rugs}</td>
                  <td className="px-4 py-3 text-[#8a8a8a]">{r.launches_dead}</td>
                  <td className="px-4 py-3">
                    {r.taken_usd != null && Number.isFinite(r.taken_usd)
                      ? `${r.taken_is_ceiling ? "up to " : ""}$${r.taken_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/wanted/${r.address}`}
                      className="text-[#8a8a8a] hover:text-[#ededea]"
                    >
                      VIEW →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
