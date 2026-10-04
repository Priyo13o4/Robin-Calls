import Link from "next/link";
import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState } from "../../components/ui";
import { readScanUncertaintiesData } from "@/lib/data/observability";
import { resolveUncertaintyAction, trustAsLockerAction } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";

/** Internal code slugs, translated for a first-time admin reading the queue. */
const CODE_LABEL: Record<string, string> = {
  "contract-custodian-unclassified": "Possible locker — unverified",
  "custody-unknown": "Custody unreadable",
  "materiality-unmeasured": "Pool sizes unmeasured",
  "deepest-pool-market-disagreement": "Deepest pool unread — market disagreement",
  "transfer-probe-inconclusive": "Transfer probe inconclusive",
  "check-skipped": "Check skipped",
};
const CHECK_LABEL: Record<string, string> = {
  lp_custody: "LP Custody",
  honeypot: "Honeypot",
};

interface UncertaintyRow {
  id: number;
  token_address: string;
  check_id: string;
  code: string;
  subject: string;
  summary: string;
  detail: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  last_verdict_id: number | null;
  times_seen: number;
  reviewed_at: string | null;
  reviewed_by: string | null;
  resolution: string | null;
}

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;
const explorerUrl = (addr: string) =>
  `${process.env.EXPLORER_WEB_URL ?? "https://robinhoodchain.blockscout.com"}/address/${addr}`;
/** A V4 poolId is a bytes32 PoolKey hash, not an address — never link it as one. */
const isAddress = (s: string) => /^0x[0-9a-f]{40}$/i.test(s);

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { show } = await searchParams;
  const showAll = show === "all";

  const rows = await readScanUncertaintiesData(showAll, 200);


  return (
    <>
      <AdminHeading
        title="Scanner · Review Queue"
        sub="Every place a scan was indefinite — a SKIPped check, an UNKNOWN custody read, a contract custodian that might be a locker. Verify manually, then resolve with a note. Contract custodians can be trusted as lockers in one stroke."
      />

      <div className="mb-4 flex gap-2">
        <Link
          href="/admin/review"
          className={`border px-3 py-1 font-mono text-[10px] tracking-[0.14em] ${!showAll ? "border-[#ccff00] text-[#ccff00]" : "border-[#2a2a2a] text-[#8a8a8a]"}`}
        >
          OPEN
        </Link>
        <Link
          href="/admin/review?show=all"
          className={`border px-3 py-1 font-mono text-[10px] tracking-[0.14em] ${showAll ? "border-[#ccff00] text-[#ccff00]" : "border-[#2a2a2a] text-[#8a8a8a]"}`}
        >
          ALL
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          {showAll ? "Nothing logged yet." : "Queue clear — no open uncertainties."}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              className={`border border-[#2a2a2a] bg-[#141414] p-4 ${r.reviewed_at ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={r.reviewed_at ? "neutral" : "warning"}>
                  {CODE_LABEL[r.code] ?? r.code}
                </Badge>
                <span className="font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
                  {CHECK_LABEL[r.check_id] ?? r.check_id.toUpperCase()}
                </span>
                <Link
                  href={`/scan/${r.token_address}`}
                  className="font-mono text-xs text-[#ededea] hover:underline"
                >
                  {short(r.token_address)}
                </Link>
                <span className="font-mono text-[10px] text-[#3d3d3d]">
                  seen ×{r.times_seen} · last {r.last_seen_at.slice(0, 10)}
                  {r.last_verdict_id ? ` · verdict #${r.last_verdict_id}` : ""}
                </span>
              </div>

              <p className="mt-2 text-xs text-[#8a8a8a]">{r.summary}</p>
              {r.subject && (
                <p className="mt-1 font-mono text-[11px] text-[#8a8a8a]">
                  {isAddress(r.subject) ? (
                    <>
                      subject:{" "}
                      <a
                        href={explorerUrl(r.subject)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#ededea] hover:text-[#ccff00] hover:underline"
                      >
                        {r.subject}
                      </a>
                    </>
                  ) : (
                    <>
                      pool ID (V4, not an address):{" "}
                      <span className="text-[#ededea]">{r.subject}</span>
                    </>
                  )}
                </p>
              )}

              {r.reviewed_at ? (
                <p className="mt-2 font-mono text-[10px] text-[#3d3d3d]">
                  RESOLVED {r.reviewed_at.slice(0, 10)} · {r.reviewed_by ?? "admin"} —{" "}
                  {r.resolution}
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {/* trust-as-locker shortcut, only where the subject is a candidate locker */}
                  {r.code === "contract-custodian-unclassified" && r.subject && (
                    <ActionForm
                      action={trustAsLockerAction}
                      className="flex flex-col gap-2 sm:flex-row"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="address" value={r.subject} />
                      <input
                        name="label"
                        required
                        minLength={3}
                        placeholder="Locker label, e.g. StoxesFun V3 Locker"
                        className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
                      />
                      <select
                        name="kind"
                        className="border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] outline-none focus:border-[#ccff00]"
                      >
                        <option value="permanent">PERMANENT</option>
                        <option value="timelock">TIME-LOCK</option>
                      </select>
                      <button className="whitespace-nowrap border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
                        TRUST AS LOCKER
                      </button>
                    </ActionForm>
                  )}
                  <ActionForm action={resolveUncertaintyAction} className="flex flex-col gap-2 sm:flex-row">
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      name="resolution"
                      required
                      minLength={4}
                      placeholder="Resolution note: verified as…, benign, known limitation…"
                      className="flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
                    />
                    <button className="whitespace-nowrap border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
                      RESOLVE
                    </button>
                  </ActionForm>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
