import { AdminHeading } from "../../components/AdminShell";
import { EmptyState, InfoPanel, SectionLabel } from "../../components/ui";
import { readActiveStainsAndHubs } from "@/lib/data/lineage";
import { addHubAction, liftStainAction } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";

interface StainRow {
  address: string;
  origin_deployer: string;
  hops: number;
  direction: string;
  created_at: string;
}
interface HubRow {
  address: string;
  label: string | null;
  source: string;
  fanout_count: number | null;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

export default async function WebPage() {
  const { stains, hubs } = await readActiveStainsAndHubs();


  return (
    <>
      <AdminHeading
        title="The Web · Stains & Hubs"
        sub="Funding-lineage tracing: which wallets are tainted by proximity to a confirmed rug."
      />

      <InfoPanel title="WHAT ARE STAINS, HOPS, AND HUBS?">
        <p>
          <span className="text-[#ededea]">Stain</span> — a wallet flagged because it sent or
          received funds within 2 hops of a confirmed rug deployer&apos;s wallet. Being stained is
          a proximity signal, not proof of wrongdoing.
        </p>
        <p>
          <span className="text-[#ededea]">Hop</span> — how many transfers away from the rug
          deployer this wallet is. Hop 1 = funded directly by the deployer (or funded it).
          Hop 2 = one step further out.
        </p>
        <p>
          <span className="text-[#ededea]">Hub</span> — a high-fanout address (exchange, faucet,
          bridge) that would otherwise stain everyone who ever passed through it. Registering one
          here breaks the chain at that point so its unrelated users don&apos;t inherit guilt.
        </p>
      </InfoPanel>

      {/* add-hub form */}
      <ActionForm
        action={addHubAction}
        className="mb-10 flex flex-col gap-2 border border-[#2a2a2a] bg-[#141414] p-4 sm:flex-row"
      >
        <input
          name="address"
          required
          placeholder="0x… hub address (exchange / faucet / bridge)"
          className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
        />
        <input
          name="label"
          placeholder="label (optional)"
          className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00] sm:w-48"
        />
        <button className="whitespace-nowrap border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
          ADD HUB
        </button>
      </ActionForm>

      <SectionLabel count={hubs.length}>HUBS (CHAIN-BREAKERS)</SectionLabel>
      {hubs.length === 0 ? (
        <div className="mb-10">
          <EmptyState>No hubs registered yet.</EmptyState>
        </div>
      ) : (
        <div className="mb-10 space-y-2">
          {hubs.map((h) => (
            <div
              key={h.address}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-2 font-mono text-xs"
            >
              {h.label && <span className="text-[#ededea]">{h.label}</span>}
              <span className="text-[#8a8a8a]">{h.address}</span>
              {h.fanout_count != null && (
                <span className="text-[#8a8a8a]">{h.fanout_count} fundees</span>
              )}
              <span className="ml-auto text-[10px] tracking-[0.14em] text-[#4a4a4a]">
                {h.source.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}

      <SectionLabel count={stains.length}>ACTIVE STAINS</SectionLabel>
      {stains.length === 0 ? (
        <EmptyState>No wallets stained. Run the lineage-trace job once the board has rugs.</EmptyState>
      ) : (
        <div className="space-y-2">
          {stains.map((r) => (
            <div
              key={`${r.address}-${r.origin_deployer}`}
              className="flex flex-col gap-2 border border-[#2a2a2a] bg-[#141414] p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="font-mono text-xs text-[#ededea]">
                {short(r.address)}
                <span className="ml-2 text-[10px] text-[#8a8a8a]">
                  hop {r.hops} · {r.direction} · from {short(r.origin_deployer)}
                </span>
              </div>
              <ActionForm action={liftStainAction} className="flex gap-2">
                <input type="hidden" name="address" value={r.address} />
                <input type="hidden" name="origin" value={r.origin_deployer} />
                <input
                  name="reason"
                  required
                  minLength={8}
                  placeholder="reason to lift (public)"
                  className="w-56 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-1.5 font-mono text-[11px] text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
                />
                <button className="whitespace-nowrap border border-[#2a2a2a] px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:text-[#ededea]">
                  LIFT
                </button>
              </ActionForm>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
