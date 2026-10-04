import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, SectionLabel } from "../../components/ui";
import { queryDirectoryPlatformsByStatus } from "@/lib/data/registry";
import type { DirectoryPlatform } from "@/lib/types";
import { approveListing, rejectListing, unpublishListing } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";

/** Flatten category_details (+ the two flag columns) for the review card. */
function detailLines(r: DirectoryPlatform): Array<[string, string]> {

  const lines: Array<[string, string]> = [];
  if (r.has_mcp) lines.push(["mcp", "yes"]);
  if (r.has_agent) lines.push(["agent api", "yes"]);
  for (const [k, v] of Object.entries(r.category_details ?? {})) {
    lines.push([k.replaceAll("_", " "), Array.isArray(v) ? v.join(", ") : String(v)]);
  }
  return lines;
}

export default async function ListingsPage() {
  const [pending, published] = await Promise.all([
    queryDirectoryPlatformsByStatus("pending"),
    queryDirectoryPlatformsByStatus("published"),
  ]);


  return (
    <>
      <AdminHeading
        title="Directory Listings"
        sub="Submissions land as pending. Approve to publish; reject to hide."
      />

      <SectionLabel count={pending.length}>PENDING</SectionLabel>
      {pending.length === 0 ? (
        <div className="mb-10">
          <EmptyState>Nothing awaiting review.</EmptyState>
        </div>
      ) : (
        <div className="mb-10 space-y-3">
          {pending.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-3 border border-[#2a2a2a] bg-[#141414] p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-base font-semibold text-[#ededea]">{r.name}</span>
                  <Badge>{r.category}</Badge>
                </div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-[#8a8a8a] hover:text-[#ededea]"
                >
                  {r.url}
                </a>
                {r.description && (
                  <p className="mt-1 text-xs text-[#8a8a8a]">{r.description}</p>
                )}
                {detailLines(r).length > 0 && (
                  <dl className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                    {detailLines(r).map(([k, v]) => (
                      <div key={k} className="flex gap-2 font-mono text-[10px]">
                        <dt className="shrink-0 uppercase tracking-[0.1em] text-[#3d3d3d]">
                          {k}
                        </dt>
                        <dd className="min-w-0 break-words text-[#8a8a8a]">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {r.contact && (
                  <p className="mt-1 font-mono text-[10px] text-[#3d3d3d]">
                    contact: {r.contact}
                  </p>
                )}
                {r.banner_url && (
                  <a
                    href={r.banner_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block font-mono text-[10px] text-[#3d3d3d] hover:text-[#8a8a8a]"
                  >
                    banner: {r.banner_url}
                  </a>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <ActionForm action={approveListing}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]">
                    APPROVE
                  </button>
                </ActionForm>
                <ActionForm action={rejectListing}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="border border-[#2a2a2a] px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-[#8a8a8a] transition-colors hover:text-[#ededea]">
                    REJECT
                  </button>
                </ActionForm>
              </div>
            </div>
          ))}
        </div>
      )}

      <SectionLabel count={published.length}>PUBLISHED</SectionLabel>
      {published.length === 0 ? (
        <EmptyState>Nothing published yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a] text-[10px] tracking-[0.2em] text-[#8a8a8a]">
                <th className="px-4 py-3 font-medium">NAME</th>
                <th className="px-4 py-3 font-medium">CATEGORY</th>
                <th className="px-4 py-3 font-medium">URL</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {published.map((r) => (
                <tr key={r.id} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-4 py-3">{r.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[#8a8a8a]">
                    {r.category}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-[#8a8a8a] hover:text-[#ededea]"
                    >
                      {r.url}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ActionForm action={unpublishListing}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="font-mono text-[10px] tracking-[0.14em] text-[#3d3d3d] hover:text-[#ededea]">
                        UNPUBLISH
                      </button>
                    </ActionForm>
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
