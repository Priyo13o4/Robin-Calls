import Link from "next/link";
import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, SectionLabel } from "../../components/ui";
import { readAllTokenMarks } from "@/lib/data/marks";
import { liftMarkAction } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";

interface MarkRow {
  token_address: string;
  kind: string;
  fired_count: number;
  source_verdict_id: number | null;
  liquidity_usd_at_mark: number | null;
  created_at: string;
  lifted_at: string | null;
  lifted_reason: string | null;
  lifted_by: string | null;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

export default async function MarksPage() {
  const rows = await readAllTokenMarks();
  const active = rows.filter((r) => !r.lifted_at);
  const lifted = rows.filter((r) => r.lifted_at);


  return (
    <>
      <AdminHeading
        title="The Record · Marks"
        sub="Permanent honeypot marks cap a token at DANGER. Lift only for verified false positives; the reason is public and the mark re-arms if the trap fires again."
      />

      <SectionLabel count={active.length}>ACTIVE</SectionLabel>
      {active.length === 0 ? (
        <div className="mb-10">
          <EmptyState>No active marks. Clean record.</EmptyState>
        </div>
      ) : (
        <div className="mb-10 space-y-3">
          {active.map((r) => (
            <div key={r.token_address} className="border border-[#2a2a2a] bg-[#141414] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <Badge tone="danger">{r.kind.toUpperCase()}</Badge>
                    <Link
                      href={`/scan/${r.token_address}`}
                      className="font-mono text-sm text-[#ededea] hover:underline"
                    >
                      {short(r.token_address)}
                    </Link>
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-[#8a8a8a]">
                    marked {r.created_at.slice(0, 10)} · re-triggered {r.fired_count}×
                    {r.liquidity_usd_at_mark != null &&
                      ` · $${Math.round(r.liquidity_usd_at_mark).toLocaleString("en-US")} liquidity at mark`}
                    {r.source_verdict_id ? ` · verdict #${r.source_verdict_id}` : ""}
                  </p>
                </div>
              </div>
              {/* pardon form — reason mandatory */}
              <ActionForm action={liftMarkAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input type="hidden" name="token" value={r.token_address} />
                <input
                  name="reason"
                  required
                  minLength={8}
                  placeholder="Reason (public): audited by…, community-verified false positive, link to report…"
                  className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
                />
                <button className="whitespace-nowrap border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
                  LIFT MARK
                </button>
              </ActionForm>
            </div>
          ))}
        </div>
      )}

      <SectionLabel count={lifted.length}>LIFTED</SectionLabel>
      {lifted.length === 0 ? (
        <EmptyState>No marks have been lifted.</EmptyState>
      ) : (
        <div className="space-y-3">
          {lifted.map((r) => (
            <div key={r.token_address} className="border border-[#2a2a2a] bg-[#141414] p-4">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-[#8a8a8a] line-through">
                  {short(r.token_address)}
                </span>
                <span className="font-mono text-[10px] tracking-[0.14em] text-[#3d3d3d]">
                  LIFTED {r.lifted_at?.slice(0, 10)} · {r.lifted_by ?? "admin"}
                </span>
              </div>
              <p className="mt-2 text-xs text-[#8a8a8a]">{r.lifted_reason}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
