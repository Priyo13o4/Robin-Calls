import type { Metadata } from "next";
import Link from "next/link";
import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { phaseLabel } from "@/lib/config/phases";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.compare.title,
  description: SEO_ROUTES.compare.description,
  keywords: [...SEO_ROUTES.compare.keywords],
  alternates: { canonical: "/compare" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/compare`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.compare.title,
    description: SEO_ROUTES.compare.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.compare.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.compare.title,
    description: SEO_ROUTES.compare.description,
    images: ["/brand/og-default.jpg"],
  },
};

/** PRD §5 — never names the competitor. */
const ROWS: {
  capability: string;
  stateless: string | null; // null = dash
  robincalls: string;
  limeCheck?: boolean; // the single lime check on the page
}[] = [
  { capability: "Instant forensic scan", stateless: "✔", robincalls: "✔" },
  {
    capability: "Sell simulation",
    stateless: "✔ contract-context",
    robincalls: "✔ as an arbitrary real wallet (state-override)",
  },
  {
    capability: "Score yesterday's claim, verifiably",
    stateless: null,
    robincalls: "✔ hash-chained + anchored",
    limeCheck: true,
  },
  {
    capability: "Named rug database with evidence bundles",
    stateless: null,
    robincalls: "✔ The Wanted Board",
  },
  {
    capability: "Deployer memory across sessions",
    stateless: null,
    robincalls: "✔ persistent DB",
  },
  {
    capability: "Published, versioned scoring formula",
    stateless: "opaque",
    robincalls: "✔ /methodology",
  },
  {
    // Was "Phase 1.5 Tracker" — a route that was never built. The capability
    // shipped as /night-market, so this now points at something that exists.
    capability: "Forward-looking launch intelligence",
    stateless: null,
    robincalls: "\u2714 /night-market",
  },
  {
    // Was one row reading "Phase 2", which was wrong in both directions: the
    // analyst is live, and machine access is a later phase than the label
    // implied. Split so each half states its real status.
    capability: "Conversational analyst over the record",
    stateless: null,
    robincalls: "\u2714 /robin-knight",
  },
  {
    capability: "Agent / MCP + API access",
    stateless: null,
    robincalls: phaseLabel("access"),
  },
];

export default function ComparePage() {
  return (
    <NoirShell>
      <PageHeader
        title="READING VS. REMEMBERING."
        subline="Instant forensics are table stakes. A record is the product."
      />

      <section className="mx-auto max-w-4xl px-4 pb-12 sm:px-6">
        <div className="overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#2a2a2a]">
                <th className="px-5 py-4 text-[10px] font-medium tracking-[0.2em] text-[#8a8a8a]">
                  CAPABILITY
                </th>
                <th className="px-5 py-4 font-cinzel text-sm font-semibold tracking-[0.12em] text-[#8a8a8a]">
                  STATELESS SCANNERS
                </th>
                <th className="px-5 py-4 font-cinzel text-sm font-semibold tracking-[0.12em] text-[#ededea]">
                  ROBINCALLS
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.capability} className="border-b border-[#2a2a2a] last:border-0">
                  <td className="px-5 py-4 text-[#ededea]">{r.capability}</td>
                  <td className="px-5 py-4 text-[#8a8a8a]">{r.stateless ?? "—"}</td>
                  <td
                    className="px-5 py-4"
                    style={{ color: r.limeCheck ? "#ccff00" : "#ededea" }}
                  >
                    {r.robincalls}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* honesty note — deliberate credibility beat (PRD §5) */}
        <div className="mt-8 border border-[#2a2a2a] bg-[#1c1c1c] px-6 py-5 text-sm leading-relaxed text-[#8a8a8a]">
          <p>Client-side scanners have a real advantage: nothing to trust but your own browser.</p>
          <p className="mt-2">We answer it the only honest way: the methodology is published, every score is re-derivable by anyone, and the record is anchored on-chain.</p>
          <p className="mt-2">Verify us. That&apos;s what the Ledger is for.</p>
        </div>

        <div className="mt-10 flex flex-wrap gap-4">
          <Link
            href="/methodology"
            className="border border-[#2a2a2a] px-6 py-3 text-xs tracking-[0.2em] text-[#ededea] transition-colors hover:border-[#8a8a8a]"
          >
            SEE THE METHODOLOGY
          </Link>
          <Link
            href="/ledger"
            className="border border-[#2a2a2a] px-6 py-3 text-xs tracking-[0.2em] text-[#ededea] transition-colors hover:border-[#8a8a8a]"
          >
            SEE THE RECEIPTS
          </Link>
        </div>
      </section>
    </NoirShell>
  );
}
