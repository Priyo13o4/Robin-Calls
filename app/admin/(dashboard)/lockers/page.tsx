import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, InfoPanel, SectionLabel } from "../../components/ui";
import { ConfirmButton } from "../../components/ConfirmButton";
import { readTrustedLockers } from "@/lib/data/admin-trust";
import { addLockerAction, deleteLockerAction, toggleLockerAction } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";

interface LockerRow {
  address: string;
  label: string;
  kind: "permanent" | "timelock";
  enabled: boolean;
  notes: string | null;
  added_by: string | null;
  created_at: string;
}

const explorerUrl = (addr: string) =>
  `${process.env.EXPLORER_WEB_URL ?? "https://robinhoodchain.blockscout.com"}/address/${addr}`;

export default async function LockersPage() {
  const rows = await readTrustedLockers();


  return (
    <>
      <AdminHeading
        title="Scanner · Trusted Lockers"
        sub="Contracts here are exempt from the LP-whale scan — their stake scores the pool LOCKED. Scans pick up changes within a minute; no deploy needed."
      />

      <InfoPanel title="HOW TO VERIFY A LOCKER BEFORE ADDING IT">
        <p>
          <span className="text-[#ededea]">Permanent</span> — the contract&apos;s verified source
          must have NO withdraw path: no <code>transferFrom</code>, <code>safeTransferFrom</code>,{" "}
          <code>decreaseLiquidity</code>, or <code>withdraw</code> on the locked position. Only
          fee-collection functions may move funds out.
        </p>
        <p>
          <span className="text-[#ededea]">Time-lock</span> — the source must show a real unlock
          schedule (a timestamp or block check gating the withdraw path), not just a name that
          says "locker".
        </p>
        <p className="text-[#4a4a4a]">
          Adding an address here changes scoring: contracts on this list stop being scanned as a
          possible whale. Get it wrong and a real rug vector reads as safe.
        </p>
      </InfoPanel>

      {/* add form */}
      <ActionForm
        action={addLockerAction}
        className="mb-8 flex flex-col gap-3 border border-[#2a2a2a] bg-[#141414] p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            name="address"
            required
            pattern="0x[0-9a-fA-F]{40}"
            placeholder="0x… locker contract address"
            className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
          />
          <input
            name="label"
            required
            minLength={3}
            placeholder="Label, e.g. StoxesFun V3 Locker"
            className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
          />
          <select
            name="kind"
            className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] outline-none focus:border-[#ccff00]"
          >
            <option value="permanent">PERMANENT</option>
            <option value="timelock">TIME-LOCK</option>
          </select>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            name="notes"
            placeholder="Notes: how it was verified (source path checks, platform, lock terms)…"
            className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
          />
          <button className="whitespace-nowrap border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
            ADD LOCKER
          </button>
        </div>
      </ActionForm>

      <SectionLabel count={rows.length}>REGISTERED</SectionLabel>
      {rows.length === 0 ? (
        <EmptyState>
          No trusted lockers registered. Every contract custodian will read as an
          unclassified whale (WARN) until one is.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.address}
              className={`border border-[#2a2a2a] bg-[#141414] p-4 ${r.enabled ? "" : "opacity-50"}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={r.kind === "permanent" ? "accent" : "neutral"}>
                  {r.kind === "permanent" ? "PERMANENT" : "TIME-LOCK"}
                </Badge>
                <span className="text-sm text-[#ededea]">{r.label}</span>
                <a
                  href={explorerUrl(r.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#8a8a8a] hover:text-[#ccff00] hover:underline"
                >
                  {r.address}
                </a>
                {!r.enabled && (
                  <span className="font-mono text-[10px] tracking-[0.14em] text-[#3d3d3d]">
                    DISABLED
                  </span>
                )}
              </div>
              {r.notes && <p className="mt-2 text-xs text-[#8a8a8a]">{r.notes}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10px] text-[#3d3d3d]">
                  added {r.created_at.slice(0, 10)} · {r.added_by ?? "unknown"}
                </span>
                <ActionForm action={toggleLockerAction}>
                  <input type="hidden" name="address" value={r.address} />
                  <input type="hidden" name="enable" value={String(!r.enabled)} />
                  <button className="border border-[#2a2a2a] px-3 py-1 text-[10px] tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
                    {r.enabled ? "DISABLE" : "ENABLE"}
                  </button>
                </ActionForm>
                <ActionForm action={deleteLockerAction}>
                  <input type="hidden" name="address" value={r.address} />
                  <ConfirmButton
                    confirmText={`Remove "${r.label}" from trusted lockers? Any pool it holds will go back to being scanned as a possible whale.`}
                    className="border border-[#2a2a2a] px-3 py-1 text-[10px] tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#8a3a30] hover:text-[#e0897a]"
                  >
                    DELETE
                  </ConfirmButton>
                </ActionForm>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
