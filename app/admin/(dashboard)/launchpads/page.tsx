import { ActionForm } from "@/app/admin/components/ActionForm";
import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState } from "../../components/ui";
import { ConfirmButton } from "../../components/ConfirmButton";
import { PAD_FAMILIES, type ProbeResult } from "@/lib/launches/probe";
import { readAllLaunchpadsAdmin, countTokensByLaunchpad } from "@/lib/data/launchpads";
import {
  addLaunchpad,
  deleteLaunchpad,
  reprobeLaunchpad,
  setLaunchpadEnabled,
} from "./actions";

export const dynamic = "force-dynamic";

/** Probe check ids, translated for a first-time admin reading a pass/fail list. */
const CHECK_LABEL: Record<string, string> = {
  contract: "Contract deployed",
  "launch-events": "Launch events seen recently",
};

interface Row {
  id: number;
  slug: string;
  name: string;
  curve_address: string;
  adapter: string;
  config: Record<string, unknown>;
  enabled: boolean;
  notes: string | null;
  last_probe: ProbeResult | null;
  created_at: string;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

const inputCls =
  "w-full border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] focus:border-[#ccff00] focus:outline-none";
const btnCls =
  "border border-[#2a2a2a] px-3 py-1.5 text-[10px] font-medium tracking-[0.14em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]";

export default async function LaunchpadsPage() {
  let pads: Row[] = [];
  const tokenCounts = new Map<number, number>();

  const rawPads = await readAllLaunchpadsAdmin();

  pads = rawPads.map((p) => ({
    id: Number(p.id),
      slug: p.slug,
      name: p.name,
      curve_address: p.curveAddress,
      adapter: p.adapter,
      config: (p.config as Record<string, unknown>) ?? {},
      enabled: p.enabled,
      notes: p.notes,
      last_probe: (p.lastProbe as ProbeResult | null) ?? null,
      created_at: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    }));

    await Promise.all(
      pads.map(async (p) => {
        const count = await countTokensByLaunchpad(p.id);
        tokenCounts.set(p.id, count);
      })
    );


  return (
    <>
      <AdminHeading
        title="Launchpads"
        sub="Launchers the registry indexes. Leave the family on auto-detect and it tests every family against recent launch events, and only starts the pad enabled when every check passes. A pad with recorded launches cannot be deleted; disable it instead."
      />

      {/* ── add form ── */}
      <ActionForm
        action={addLaunchpad}
        className="mb-10 grid gap-3 border border-[#2a2a2a] bg-[#141414] p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] text-[#4a4a4a]">
          NAME
          <input name="name" placeholder="e.g. flap.sh" required className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] text-[#4a4a4a]">
          SLUG
          <input
            name="slug"
            placeholder="e.g. flapsh"
            required
            pattern="[a-z0-9-]+"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] text-[#4a4a4a]">
          CURVE CONTRACT
          <input
            name="curve_address"
            placeholder="0x…"
            required
            pattern="0x[0-9a-fA-F]{40}"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] text-[#4a4a4a]">
          FAMILY
          <select name="adapter" className={inputCls} defaultValue="auto">
            <option value="auto">auto-detect (test every family)</option>
            {PAD_FAMILIES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] text-[#4a4a4a]">
          GRADUATION TARGET OVERRIDE (WEI, OPTIONAL)
          <input name="target_wei_override" placeholder="optional" className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] tracking-[0.12em] text-[#4a4a4a]">
          NOTES (OPTIONAL)
          <input name="notes" placeholder="provenance, source, etc." className={inputCls} />
        </label>
        <button className="self-end border border-[#ccff00] px-4 py-2 text-[11px] font-medium tracking-[0.18em] text-[#ccff00] transition-colors hover:bg-[#ccff00] hover:text-[#0a0a0a] sm:col-span-2 lg:col-span-1">
          PROBE &amp; REGISTER
        </button>
      </ActionForm>

      {/* ── registry ── */}
      {pads.length === 0 ? (
        <EmptyState>No launchpads registered.</EmptyState>
      ) : (
        <div className="space-y-3">
          {pads.map((p) => (
            <div key={p.id} className="border border-[#2a2a2a] bg-[#141414] p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-base font-semibold text-[#ededea]">{p.name}</span>
                    <Badge>{p.adapter}</Badge>
                    {p.last_probe?.kind && (
                      <Badge>{p.last_probe.kind === "direct" ? "DIRECT LAUNCHER" : "BONDING CURVE"}</Badge>
                    )}
                    <Badge tone={p.enabled ? "success" : "neutral"}>
                      {p.enabled ? "INDEXING" : "DISABLED"}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-xs text-[#8a8a8a]">
                    {short(p.curve_address)} · {tokenCounts.get(p.id) ?? 0} launches recorded
                  </p>
                  {p.notes && <p className="mt-1 max-w-2xl text-xs text-[#8a8a8a]">{p.notes}</p>}

                  {p.last_probe && (
                    <div className="mt-2 space-y-0.5">
                      {p.last_probe.checks.map((c) => (
                        <p key={c.id} className="font-mono text-[10px] text-[#8a8a8a]">
                          <span className={c.ok ? "text-[#8fbf6a]" : "text-[#e0897a]"}>
                            {c.ok ? "✓" : "✗"}
                          </span>{" "}
                          {CHECK_LABEL[c.id] ?? c.id}: {c.detail}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <ActionForm action={setLaunchpadEnabled}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="enabled" value={String(!p.enabled)} />
                    <button className={btnCls}>{p.enabled ? "DISABLE" : "ENABLE"}</button>
                  </ActionForm>
                  <ActionForm action={reprobeLaunchpad}>
                    <input type="hidden" name="id" value={p.id} />
                    <button className={btnCls}>RE-PROBE</button>
                  </ActionForm>
                  <ActionForm action={deleteLaunchpad}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmButton
                      confirmText={`Delete "${p.name}"? Only possible while it has no recorded launches.`}
                      className="border border-[#8a3a30] px-3 py-1.5 text-[10px] font-medium tracking-[0.14em] text-[#e0897a] transition-colors hover:bg-[#8a3a30] hover:text-[#ededea]"
                    >
                      DELETE
                    </ConfirmButton>
                  </ActionForm>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
