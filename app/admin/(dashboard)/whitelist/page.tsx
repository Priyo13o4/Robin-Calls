import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, SectionLabel } from "../../components/ui";
import { whitelistMembersForAdmin } from "@/lib/data/whitelist";

export const dynamic = "force-dynamic";

interface WhitelistRow {
  wallet_address: string;
  whitelist_status: string;
  eligible: boolean | null;
  step_1_status: string;
  step_2_status: string;
  step_3_status: string;
  twitter_username: string | null;
  twitter_connected_at: string | null;
  telegram_username: string | null;
  telegram_connected_at: string | null;
  telegram_chat_member: boolean;
  created_at: string;
  approved_at: string | null;
}

const explorerUrl = (addr: string) =>
  `${process.env.EXPLORER_WEB_URL ?? "https://robinhoodchain.blockscout.com"}/address/${addr}`;

function SocialCell({
  connected,
  username,
}: {
  connected: boolean;
  username: string | null;
}) {
  return (
    <Badge tone={connected ? "success" : "neutral"}>
      {connected ? (username ? `@${username}` : "CONNECTED") : "NOT CONNECTED"}
    </Badge>
  );
}

export default async function WhitelistPage() {
  const rows = (await whitelistMembersForAdmin()) as WhitelistRow[];

  return (
    <>
      <AdminHeading
        title="Whitelist"
        sub="Every wallet that has entered onboarding, and whether its social identities are actually connected — not just whether the record says approved."
      />

      <SectionLabel count={rows.length}>MEMBERS</SectionLabel>
      {rows.length === 0 ? (
        <EmptyState>No whitelist signups yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-[#2a2a2a]">
          <table className="w-full min-w-[900px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#2a2a2a] bg-[#141414] text-[10px] tracking-[0.14em] text-[#8a8a8a]">
                <th className="px-3 py-2.5 font-medium">WALLET</th>
                <th className="px-3 py-2.5 font-medium">STATUS</th>
                <th className="px-3 py-2.5 font-medium">ELIGIBLE</th>
                <th className="px-3 py-2.5 font-medium">X</th>
                <th className="px-3 py-2.5 font-medium">TELEGRAM</th>
                <th className="px-3 py-2.5 font-medium">STEPS</th>
                <th className="px-3 py-2.5 font-medium">JOINED</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.wallet_address} className="border-b border-[#1c1c1c] last:border-0">
                  <td className="px-3 py-2.5">
                    <a
                      href={explorerUrl(r.wallet_address)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-[#8a8a8a] hover:text-[#ccff00] hover:underline"
                    >
                      {r.wallet_address}
                    </a>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.whitelist_status === "approved" ? "success" : "warning"}>
                      {r.whitelist_status.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.eligible ? "accent" : "neutral"}>
                      {r.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <SocialCell connected={Boolean(r.twitter_connected_at)} username={r.twitter_username} />
                  </td>
                  <td className="px-3 py-2.5">
                    <SocialCell connected={Boolean(r.telegram_connected_at)} username={r.telegram_username} />
                    {r.telegram_username && !r.telegram_chat_member && (
                      <span className="ml-1.5 font-mono text-[9px] text-[#3d3d3d]">left group</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-[#8a8a8a]">
                    {[r.step_1_status, r.step_2_status, r.step_3_status]
                      .map((s) => (s === "completed" ? "✓" : "·"))
                      .join(" ")}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-[#3d3d3d]">
                    {r.created_at.slice(0, 10)}
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
