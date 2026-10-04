import type { Metadata } from "next";
import Link from "next/link";
import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { CopyAddressChip } from "../components/site/CopyAddressChip";
import { readIndictedStats } from "@/lib/data/wanted";
import { cdnUrl } from "@/lib/config/cdn";
import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.wanted.title,
  description: SEO_ROUTES.wanted.description,
  keywords: [...SEO_ROUTES.wanted.keywords],
  alternates: { canonical: "/wanted" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/wanted`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.wanted.title,
    description: SEO_ROUTES.wanted.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.wanted.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.wanted.title,
    description: SEO_ROUTES.wanted.description,
    images: ["/brand/og-default.jpg"],
  },
};

export const revalidate = 300;


export default async function WantedPage() {
  const { deployers, indictedCount: indicted, webCounts } = await readIndictedStats();


  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/chase-wanted-bg.webp")}
            alt="Wanted Board Background"
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-90"
          />
          {/* Gentle vignette to blend the image and keep text readable */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.75) 20%, rgba(10,10,10,0.75) 80%, #0A0A0A 100%)",
            }}
          />
        </div>

        {/* Film grain noise */}
        <div
          className="pointer-events-none fixed inset-0 z-[1] opacity-[0.055]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'240\' height=\'240\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
            backgroundRepeat: "repeat",
          }}
        />

        {/* Content Layer */}
        <div className="relative z-10">
          <PageHeader
            title="THE WANTED BOARD"
            subline="The ones who ran. Remembered."
          >
            <p className="mt-2 max-w-2xl text-xs text-[#8a8a8a]">
              Tokens on Robinhood Chain whose liquidity was pulled, and the wallets that deployed them, with the evidence for each.
            </p>
            {/* the page's single lime element: the MOST WANTED count numeral */}
            <div className="mt-8 inline-flex items-baseline gap-4 border border-[#2a2a2a] bg-[#141414] px-6 py-4">
              <span className="font-cinzel text-5xl font-black" style={{ color: "#ccff00" }}>
                {indicted}
              </span>
              <span className="text-xs tracking-[0.24em] text-[#8a8a8a]">
                WALLETS INDICTED
              </span>
            </div>
          </PageHeader>

          {/* methodology bar */}
          <section className="mx-auto max-w-5xl px-4 sm:px-6">
            <div className="border border-[#2a2a2a] bg-[#1c1c1c] px-5 py-3 text-xs text-[#8a8a8a]">
              What counts as a rug? Our criteria are public and machine-checkable:
              every row on this board carries its evidence bundle. Precision over
              recall: nothing is listed until the criteria confirm it.
            </div>
          </section>

          <section className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
            {deployers.length === 0 ? (
              <div className="border border-[#2a2a2a] bg-[#141414] px-6 py-20 text-center">
                <p className="font-cinzel text-xl tracking-[0.1em] text-[#ededea]">
                  NO INDICTMENTS YET.
                </p>
                <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[#8a8a8a]">
                  The board ingests nothing until a wallet meets the published rug
                  criteria with a machine-checkable evidence bundle. When the first
                  one runs, it will be remembered here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#2a2a2a] text-[10px] tracking-[0.2em] text-[#8a8a8a]">
                      <th className="px-5 py-3 font-medium">DEPLOYER</th>
                      <th className="px-5 py-3 font-medium">CONFIRMED RUGS</th>
                      <th className="px-5 py-3 font-medium">TOOK</th>
                      <th className="px-5 py-3 font-medium">LAST SEEN</th>
                      <th className="px-5 py-3 font-medium">DEAD LAUNCHES</th>
                      <th className="px-5 py-3 font-medium">THE WEB</th>
                      <th className="px-5 py-3 font-medium">FAMILY TREE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployers.map((d) => (
                      <tr
                        key={d.id}
                        className="border-b border-[#2a2a2a] transition-colors last:border-0 hover:bg-[#1c1c1c]"
                      >
                        {/* Full address + copy + explorer, not a truncated
                            link: this board makes a public accusation, so the
                            one thing a reader must be able to do is take the
                            address away and check it themselves. */}
                        <td className="px-5 py-4 font-mono text-[#ededea]">
                          {/* Fixed width with the address wrapping to two
                              lines — a 42-char address on one line pushes the
                              7-column table into horizontal scroll on a normal
                              desktop, and a truncated address defeats the
                              point of showing it. */}
                          <CopyAddressChip
                            address={d.address}
                            className="w-[15rem]"
                          />
                          {/* L177: shown only when a shared funder links this wallet to another indicted one. */}
                          {d.operator_rugs.length > 0 && (
                            <div className="mt-3 w-[15rem] border border-[#3a2a2a] bg-[#1a1414] px-3 py-2">
                              <p className="text-[10px] tracking-[0.16em] text-[#d08a8a]">
                                SAME OPERATOR · {d.operator_rugs.length} OTHER RUG{d.operator_rugs.length === 1 ? "" : "S"}
                              </p>
                              <ul className="mt-2 flex flex-col gap-2">
                                {d.operator_rugs.map((o) => (
                                  <li key={`${o.deployer}-${o.token_address ?? "none"}`} className="flex flex-col gap-1">
                                    <span className="text-[11px] text-[#ededea]">{o.token_symbol ?? "Unnamed token"}</span>
                                    {o.token_address && <CopyAddressChip address={o.token_address} compact />}
                                    <Link
                                      href={`/wanted/${o.deployer}`}
                                      className="text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:text-[#ededea]"
                                    >
                                      VIEW THAT RUG →
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4 font-mono">{d.confirmed_rugs}</td>
                        <td className="px-5 py-4 font-mono">
                          {d.taken_usd != null && Number.isFinite(d.taken_usd)
                            ? `${d.taken_is_ceiling ? "up to " : ""}$${d.taken_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : "—"}
                        </td>
                        <td className="px-5 py-4 font-mono text-[#8a8a8a]">
                          {d.last_seen_block ? `block ${d.last_seen_block.toLocaleString("en-US")}` : "—"}
                        </td>
                        <td className="px-5 py-4 font-mono text-[#8a8a8a]">{d.launches_dead}</td>
                        <td className="px-5 py-4">
                          {webCounts.get(d.address.toLowerCase()) ? (
                            <span className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1 font-mono text-[10px] tracking-[0.12em] text-[#ededea]">
                              {webCounts.get(d.address.toLowerCase())} LINKED
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-[#3d3d3d]">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <Link
                            href={`/wanted/${d.address}`}
                            className="font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a] hover:text-[#ededea]"
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
          </section>
        </div>
      </div>
    </NoirShell>
  );
}
