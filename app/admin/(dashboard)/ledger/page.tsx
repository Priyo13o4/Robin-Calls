import Link from "next/link";
import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, type Tone } from "../../components/ui";
import { queryAdminLedgerVerdicts } from "@/lib/data/ledger";

export const dynamic = "force-dynamic";

const short = (h: string, n = 10) =>
  h.length > n + 6 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;

const TIER_TONE: Record<string, Tone> = {
  CLEAR: "success",
  CAUTION: "warning",
  DANGER: "danger",
  CRITICAL: "danger",
};

interface Row {
  id: number;
  token_symbol: string | null;
  token_address: string;
  score: number;
  tier: string;
  score_version: string;
  entry_hash: string;
  anchor_tx: string | null;
  created_at: string;
}

export default async function AdminLedger({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; before?: string }>;
}) {
  const { token, before } = await searchParams;
  const parsed = Number.parseInt(before ?? "", 10);
  const cursor = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  const rows: Row[] = await queryAdminLedgerVerdicts(token, cursor);
  const href = (b: number | null) => {
    const p = new URLSearchParams();
    if (token) p.set("token", token);
    if (b) p.set("before", String(b));
    const qs = p.toString();
    return qs ? `/admin/ledger?${qs}` : "/admin/ledger";
  };


  return (
    <>
      <AdminHeading title="The Ledger" sub="Every Verdict issued, newest first, 100 per page." />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <form className="flex gap-2" method="get">
          <input
            name="token"
            defaultValue={token ?? ""}
            placeholder="filter by token address"
            className="w-64 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] focus:border-[#ccff00] focus:outline-none"
          />
          <button className="border border-[#2a2a2a] px-4 py-2 text-[11px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ededea] hover:text-[#ededea]">
            FILTER
          </button>
          {token && (
            <Link
              href="/admin/ledger"
              className="flex items-center px-2 text-[11px] tracking-[0.14em] text-[#8a8a8a] hover:text-[#ededea]"
            >
              CLEAR
            </Link>
          )}
        </form>
        <div className="flex items-center gap-2 font-mono text-[10px] text-[#8a8a8a]">
          <span className="text-[#4a4a4a]">TIERS:</span>
          <Badge tone="success">CLEAR ≥85</Badge>
          <Badge tone="warning">CAUTION 60–84</Badge>
          <Badge tone="danger">DANGER 35–59</Badge>
          <Badge tone="danger">CRITICAL &lt;35</Badge>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState>
          {token ? "No verdicts match that address." : "No verdicts issued yet."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-[10px] tracking-[0.2em] text-[#8a8a8a]">
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">TOKEN</th>
                <th className="px-4 py-3 font-medium">SCORE</th>
                <th className="px-4 py-3 font-medium">TIER</th>
                <th className="px-4 py-3 font-medium">HASH</th>
                <th className="px-4 py-3 font-medium">ANCHOR</th>
                <th className="px-4 py-3 font-medium">WHEN (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[#2a2a2a] font-mono text-xs last:border-0">
                  <td className="px-4 py-3 text-[#8a8a8a]">{r.id}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/scan/${r.token_address}`}
                      className="text-[#ededea] hover:underline"
                    >
                      {r.token_symbol ?? "—"}{" "}
                      <span className="text-[#8a8a8a]">{short(r.token_address)}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-base font-bold text-[#ededea]">{r.score}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TIER_TONE[r.tier] ?? "neutral"}>{r.tier}</Badge>
                  </td>
                  <td className="px-4 py-3 text-[#8a8a8a]" title={r.entry_hash}>
                    {short(r.entry_hash, 12)}
                  </td>
                  <td className="px-4 py-3 text-[#8a8a8a]">
                    {r.anchor_tx ? short(r.anchor_tx) : "—"}
                  </td>
                  <td className="px-4 py-3 text-[#3d3d3d]">
                    {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(cursor || rows.length === 100) && (
        <div className="mt-4 flex gap-3 font-mono text-xs">
          {cursor && (
            <Link href={href(null)} className="border border-[#2a2a2a] px-3 py-1.5 text-[#8a8a8a] hover:text-[#ccff00]">
              ← NEWEST
            </Link>
          )}
          {rows.length === 100 && (
            <Link href={href(rows[rows.length - 1].id)} className="border border-[#2a2a2a] px-3 py-1.5 text-[#8a8a8a] hover:text-[#ccff00]">
              OLDER →
            </Link>
          )}
        </div>
      )}
    </>
  );
}
