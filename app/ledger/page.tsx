import type { Metadata } from "next";
import Link from "next/link";
import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { LedgerFeed } from "../components/site/LedgerFeed";
import { verdictRowById, queryLedgerFeed, latestTradeGatesForTokens, ledgerPoolsForEntries } from "@/lib/data/ledger";
import { tradeableTokens } from "@/lib/swap/ledger-gate";
import { launchIconsForTokens } from "@/lib/data/launches";
import { isTradingOpen, readSwapConfig } from "@/lib/swap/config";
import { addresses, explorerWebUrl, isAddressConfigured } from "@/lib/config/chain";
import type { VerdictRow } from "@/lib/types";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.ledger.title,
  description: SEO_ROUTES.ledger.description,
  keywords: [...SEO_ROUTES.ledger.keywords],
  alternates: { canonical: "/ledger" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/ledger`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.ledger.title,
    description: SEO_ROUTES.ledger.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.ledger.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.ledger.title,
    description: SEO_ROUTES.ledger.description,
    images: ["/brand/og-default.jpg"],
  },
};

export const revalidate = 60;

const short = (h: string, n = 8) =>
  h.length > n + 6 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; v?: string }>;
}) {
  const query = await searchParams;
  const token = /^0x[0-9a-fA-F]{40}$/.test(query.token ?? "")
    ? query.token!.toLowerCase()
    : null;
  const verdictId = /^\d+$/.test(query.v ?? "") ? Number(query.v) : null;

  let entries: VerdictRow[] = [];
  let nextCursor: number | null = null;

  if (verdictId !== null) {
    /**
     * Deep link from a record stamp. This used to render `[data]` and nothing
     * else, which answered "show me this receipt" but broke the only thing the
     * page exists to demonstrate: a receipt's neighbours are what make it a
     * CHAIN. The feed is ordered id-desc and its cursor is exclusive (`id <
     * cursor`), so `verdictId + 1` opens the ledger AT that row with every
     * older entry behind it and pagination intact. The row itself is then
     * highlighted client-side rather than isolated.
     */
    const feed = await queryLedgerFeed({ token, cursor: verdictId + 1, limit: 20 });
    entries = feed.entries;
    nextCursor = feed.nextCursor;
    // Cursor paging cannot return a row that was deleted or filtered out; fall
    // back to the direct read so a valid ?v= never renders an empty ledger.
    if (!entries.some((e) => e.id === verdictId)) {
      const data = await verdictRowById(verdictId);
      if (data) entries = [data, ...entries];
    }
  } else {
    const feed = await queryLedgerFeed({ token, limit: 20 });
    entries = feed.entries;
    nextCursor = feed.nextCursor;
  }


  const anchorAddress = process.env.ROBIN_ANCHOR_ADDRESS || null;
  const [tradeEnabled, gates, pools, icons] = await Promise.all([
    readSwapConfig().then(isTradingOpen),
    latestTradeGatesForTokens(entries.map((e) => e.token_address)).catch(() => new Map()),
    ledgerPoolsForEntries(entries).catch(() => ({})),
    launchIconsForTokens(entries.map((e) => e.token_address)).catch(() => ({})),
  ]);

  return (
    <NoirShell>
      <PageHeader
        title="THE LEDGER"
        subline={
          token
            ? `The record for ${short(token)}: newest receipt first.`
            : verdictId !== null
              ? `Opened at verdict #${verdictId}, in the chain around it.`
              : "Every call. Hash-chained. Anchored on-chain. We can't edit our past. That's the point."
        }
      >
        <p className="mt-2 max-w-2xl text-xs text-[#8a8a8a]">
          Every token verdict RobinCalls has published on Robinhood Chain, each one chained to the one before it.
        </p>
      </PageHeader>

      {/* filtered view — a deep link (?v= or ?token=) only ever shows a
          slice of the ledger; give the reader an explicit way back out
          instead of leaving them stuck on one entry or one token. */}
      {(token || verdictId !== null) && (
        <div className="mx-auto -mt-4 mb-10 flex max-w-5xl justify-center px-4 sm:px-6">
          <Link
            href="/ledger"
            className="border border-[#2a2a2a] bg-[#1c1c1c] px-4 py-2 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ededea]"
          >
            ← VIEW THE FULL LEDGER
          </Link>
        </div>
      )}

      {/* explainer strip */}
      <section className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
        <ol className="grid gap-4 border border-[#2a2a2a] bg-[#141414] p-6 sm:grid-cols-3">
          {[
            "Each verdict's hash includes the hash before it. Change one entry and every hash after it breaks.",
            "The chain head is periodically committed in a transaction from the Robin wallet, a public timestamp nobody can backdate.",
            "Take any row, rebuild its canonical payload, hash it with the previous entry. If it matches, the record held.",
          ].map((line, i) => (
            <li key={i} className="text-xs leading-relaxed text-[#8a8a8a]">
              <span className="font-cinzel text-lg text-[#ededea]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="mt-2">{line}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
        {/* Robin identity card — the hand that writes the record, up top. */}
        <aside className="mb-10 flex items-center gap-5 border border-[#2a2a2a] bg-[#141414] px-6 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo-sm.webp"
            alt=""
            className="h-10 w-10 object-contain opacity-70 grayscale"
          />
          <div>
            <p className="font-cinzel text-sm tracking-[0.16em] text-[#ededea]">ROBIN</p>
            <p className="font-mono text-[11px] text-[#8a8a8a]">
              {anchorAddress || "anchor wallet (to be announced)"}
            </p>
            <p className="mt-1 text-[11px] italic text-[#8a8a8a]">
              The hand that writes the record.
            </p>
          </div>
        </aside>

        {/* chained entries — paginated feed with search + load more */}
        <LedgerFeed
          initialEntries={entries}
          initialCursor={nextCursor}
          token={token}
          explorerWebUrl={explorerWebUrl}
          highlightId={verdictId}
          tradeEnabled={tradeEnabled}
          initialTradeable={tradeableTokens(gates)}
          initialPools={pools}
          initialIcons={icons}
          stateView={isAddressConfigured(addresses.v4StateView) ? addresses.v4StateView : null}
        />
      </section>
    </NoirShell>
  );
}
