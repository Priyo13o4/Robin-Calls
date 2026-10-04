import type { Metadata } from "next";
import Link from "next/link";
import { NoirShell } from "../components/site/NoirShell";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.story.title,
  description: SEO_ROUTES.story.description,
  keywords: [...SEO_ROUTES.story.keywords],
  alternates: { canonical: "/story" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/story`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.story.title,
    description: SEO_ROUTES.story.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.story.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.story.title,
    description: SEO_ROUTES.story.description,
    images: ["/brand/og-default.jpg"],
  },
};

/**
 * /story — the manifesto long-read (Prompt 8). Single centered column, noir
 * broadsheet. Lime budget: one numeral (94). All copy is original brand voice.
 */
export default function StoryPage() {
  return (
    <NoirShell>
      <article className="mx-auto max-w-[680px] px-5 pb-28 pt-16 sm:pt-24">
        <p className="mb-6 text-[11px] font-medium tracking-[0.3em] text-[#8a8a8a]">
          THE MANIFESTO
        </p>

        <h1 className="font-cinzel text-4xl font-black leading-tight sm:text-5xl">
          Every forest has its outlaws.
        </h1>

        <div className="mt-10 space-y-6 text-[17px] leading-relaxed text-[#ededea]/90">
          <p>
            <span className="float-left mr-3 mt-1 font-cinzel text-6xl font-black leading-none text-[#ededea]">
              T
            </span>
            he chain is new. The hunters are not. They move in the first block,
            drain in the last, and vanish before the screenshots load. They count
            on one thing: that nobody keeps the record.
          </p>
          <p>
            Scanners read the chain and forget it. They tell you what a token
            looks like <em>right now</em>, then wipe the slate. That amnesia is a
            gift to the people who rug. A serial deployer is only dangerous if
            no one remembers the last four times.
          </p>

          <p className="border-l-2 border-[#2a2a2a] pl-6 font-cinzel text-2xl leading-snug text-[#ededea]">
            Robin doesn&apos;t take your money. Robin takes their edge.
          </p>

          <p>
            We keep the record. Every Verdict is hash-chained to the one before
            it and anchored on Robinhood Chain itself. Nobody can edit the past,
            including us. That&apos;s not a feature. That&apos;s the whole point.
          </p>
          <p>
            The score isn&apos;t a vibe. It&apos;s a number anyone can re-derive
            from a formula we publish in full. When we say a token is a honeypot,
            we sell as <em>you</em> (an arbitrary real wallet), not as a
            contract that was always going to be let through.
          </p>
        </div>

        {/* paired numerals — the page's one lime element */}
        <div className="my-14 flex items-end justify-center gap-16">
          <div className="text-center">
            <div className="font-cinzel text-7xl font-black leading-none" style={{ color: "#ccff00" }}>
              94
            </div>
            <div className="mt-2 text-xs tracking-[0.2em] text-[#8a8a8a]">
              ACT ACCORDINGLY.
            </div>
          </div>
          <div className="text-center">
            <div className="font-cinzel text-7xl font-black leading-none text-[#ededea]">
              12
            </div>
            <div className="mt-2 text-xs tracking-[0.2em] text-[#8a8a8a]">
              WALK AWAY.
            </div>
          </div>
        </div>

        <div className="space-y-6 text-[17px] leading-relaxed text-[#ededea]/90">
          <p>
            We&apos;re writing the counter-playbook in real time, and every score
            we publish is a receipt, not a guess. Read-and-forget is how the
            forest stays dangerous. We keep the record.
          </p>
        </div>

        <p className="mt-16 text-center font-cinzel text-4xl font-bold tracking-wide text-[#ededea]">
          ANSWER THE CALL.
        </p>

        <div className="mt-8 flex justify-center">
          <Link
            href="/ledger"
            className="border border-[#2a2a2a] px-8 py-3 text-xs tracking-[0.2em] text-[#ededea] transition-colors hover:border-[#8a8a8a]"
          >
            SEE THE PROOF
          </Link>
        </div>
      </article>
    </NoirShell>
  );
}
