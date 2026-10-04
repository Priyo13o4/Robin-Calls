import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { RobinKnightDock } from "../../components/agent/RobinKnightDock";
import { NoirShell, PageHeader } from "../../components/site/NoirShell";
import { ScanForm } from "../../components/site/ScanForm";
import { VerdictView } from "../../components/site/VerdictView";
import { cdnUrl } from "@/lib/config/cdn";
import { SITE_URL } from "@/lib/config/site";
import { verdictJsonLd, verdictSummarySentence } from "@/lib/config/seo";
import { verdictRowById, latestVerdictRowForToken } from "@/lib/data/ledger";
import { readTokenRecord } from "@/lib/scanner/record";
import { ledgerFromRow, verdictFromRow } from "@/lib/scan-control/serve";
import { parseScanSlug, buildScanSlug } from "@/lib/scan-slug";
import { isTradingOpen, readSwapConfig } from "@/lib/swap/config";
import { TradeLink } from "../../components/site/TradeLink";
import { TOKEN_ADDRESS, TOKEN_NAME, TOKEN_SYMBOL, isOwnToken } from "@/lib/sale/token";
import { OwnTokenScan } from "./OwnTokenScan";

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ v?: string; rescan?: string }>;
}): Promise<Metadata> {
  const { address: rawSlug } = await params;
  const query = await searchParams;

  const address = parseScanSlug(rawSlug);
  if (!address) {
    return {
      title: "Verdict · RobinCalls",
      robots: { index: false, follow: true },
    };
  }
  if (isOwnToken(address)) return ownTokenMetadata();

  // A shared verdict link carries `?v=<id>`, and /api/og/[id] renders that
  // exact receipt. When no ?v= is given, fetch the latest published verdict.
  const verdictId = /^\d+$/.test(query.v ?? "") ? Number(query.v) : null;
  const row =
    verdictId !== null
      ? await verdictRowById(verdictId, address)
      : query.rescan === "1"
        ? null
        : await latestVerdictRowForToken(address);

  // Same rule as the redirect below: the ticker slug is only canonical when a
  // row actually named the symbol. With no row we do not know it, so the page
  // self-canonicalises (and is noindex anyway) rather than pointing at a URL
  // whose identity we inferred from an empty read.
  const canonicalSlug = row ? buildScanSlug(address, row.token_symbol) : rawSlug;
  const canonicalUrl = `${SITE_URL}/scan/${canonicalSlug}`;

  const title = row
    ? `Is ${row.token_symbol ?? "Token"} Safe? Score ${row.score}/100 | RobinCalls`
    : `Check Token Safety: ${address.slice(0, 8)}… | RobinCalls`;
  const description = row
    ? `Safety check and rug pull verdict for ${row.token_symbol ?? address} on Robinhood Chain. Evidence-backed contract audit, LP lock, and honeypot analysis.`
    : `Check token ${address} on Robinhood Chain for honeypots, rug pull risks and liquidity locks with RobinCalls.`;

  return {
    title,
    description,
    keywords: [
      `is ${row?.token_symbol ?? "token"} safe`,
      `${row?.token_symbol ?? "token"} robinhood chain`,
      "robinhood chain token safety check",
      "check a token on robinhood chain",
      "robinhood chain rug checker",
      "robinhood chain honeypot checker",
      "chain 4663 token safety",
    ],
    alternates: {
      canonical: canonicalUrl,
    },
    // Noindex on three shapes, all of which are the SAME token as the canonical
    // URL: a `?v=` deep link (one of many receipts), `?rescan=1` (the live-scan
    // action), and a page with no published verdict at all — that last one is
    // the guardrail, because indexing every pasted address would fill the index
    // with thin pages and get the whole /scan directory discounted.
    ...(verdictId !== null || query.rescan === "1" || !row
      ? { robots: { index: false, follow: true } }
      : {}),
    openGraph: {
      title,
      description,
      ...(row
        ? {
            images: [
              { url: `/api/og/${row.id}`, width: 1200, height: 630, alt: title },
            ],
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(row ? { images: [`/api/og/${row.id}`] } : {}),
    },
  };
}

/**
 * Reads one archived verdict straight from the DB, scoped to this address —
 * no scan pipeline, no coordination, no rate limit (a single indexed PK read).
 */
export async function readArchivedVerdict(
  address: string,
  verdictId: number
) {
  const row = await verdictRowById(verdictId, address);
  if (!row) return null;
  const record = await readTokenRecord(row.token_address);
  return { verdict: verdictFromRow(row), ledger: ledgerFromRow(row), record };
}

/**
 * Reads the latest published verdict for an address straight from the DB.
 */
export async function readLatestVerdict(address: string) {
  const row = await latestVerdictRowForToken(address);
  if (!row) return null;
  const record = await readTokenRecord(row.token_address);
  return { verdict: verdictFromRow(row), ledger: ledgerFromRow(row), record };
}

export default async function ScanAddressPage({
  params,
  searchParams,
}: {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ v?: string; rescan?: string }>;
}) {
  const { address: rawSlug } = await params;
  const query = await searchParams;

  const address = parseScanSlug(rawSlug);
  if (!address) notFound();

  const tradeEnabled = isTradingOpen(await readSwapConfig());
  const own = isOwnToken(address);

  const verdictId = /^\d+$/.test(query.v ?? "") ? Number(query.v) : null;
  // `?rescan=1` is the explicit "I want current, not the record" action. It
  // renders the live form (which auto-runs on mount) instead of the stored
  // receipt, and is noindex — it is the same token as the canonical URL.
  const rescan = query.rescan === "1";
  const archived =
    verdictId !== null ? await readArchivedVerdict(address, verdictId) : null;
  // Our own token always renders from a stored row; its rescan is a button on the page.
  const latest =
    verdictId === null && (!rescan || own) ? await readLatestVerdict(address) : null;

  const symbol = archived?.verdict.tokenSymbol ?? latest?.verdict.tokenSymbol ?? null;
  const canonicalSlug = buildScanSlug(address, symbol);

  // Upgrade a bare-address or stale-ticker URL to the canonical slug — but ONLY
  // when a row actually told us the symbol. `readLatestVerdict` degrades to null
  // (§1: reads return an empty value rather than throwing), and a null symbol
  // canonicalises to the BARE address. Redirecting on that would mean a DB blip
  // permanently sends `pepe-0x…` → `0x…` in every visitor's browser cache, and
  // the recovered DB then sends it back — a 308 loop nobody can clear. A
  // redirect is forever; it may only be computed from a fact we actually have.
  if (symbol !== null && rawSlug !== canonicalSlug) {
    const qs = verdictId !== null ? `?v=${verdictId}` : rescan ? "?rescan=1" : "";
    permanentRedirect(`/scan/${canonicalSlug}${qs}`);
  }

  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/court-verdict-bg.webp")}
            alt="Verdict Background"
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
          {own ? (
            <>
              <PageHeader
                eyebrow="ROBINHOOD CHAIN · ID 4663 · OUR OWN TOKEN"
                title={TOKEN_NAME}
                titleIcon={
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src="/brand/logo.png" alt="" width={64} height={64} className="h-12 w-12 rounded-full sm:h-16 sm:w-16" />
                }
                subline={
                  <span className="not-italic text-white">
                    ${TOKEN_SYMBOL}. What the contract can do, where the supply sits, and every vesting lock.
                  </span>
                }
              />
              <OwnTokenScan
                verdict={(archived ?? latest)?.verdict ?? null}
                ledger={(archived ?? latest)?.ledger ?? null}
              />
            </>
          ) : archived ? (
            <>
              <PageHeader
                eyebrow="ROBINHOOD CHAIN · ID 4663"
                title="THE VERDICT"
                subline={`Archived verdict #${archived.ledger.id}, read from the record, not a live rescan.`}
              >
                <VerdictSummary verdict={archived.verdict} ledger={archived.ledger} url={`${SITE_URL}/scan/${canonicalSlug}`} />
              </PageHeader>
              <ArchivedVerdictBar verdictId={archived.ledger.id} slug={canonicalSlug} />
              <VerdictView
                verdict={archived.verdict}
                ledger={archived.ledger}
                record={archived.record}
                scanMeta={null}
                traders={null}
              />
            </>
          ) : latest ? (
            <>
              <PageHeader
                eyebrow="ROBINHOOD CHAIN · ID 4663"
                title="THE VERDICT"
                subline="The last receipt on record for this token, not a live scan."
              >
                <VerdictSummary verdict={latest.verdict} ledger={latest.ledger} url={`${SITE_URL}/scan/${canonicalSlug}`} />
              </PageHeader>
              <LatestVerdictBar
                slug={canonicalSlug}
                verdictId={latest.ledger.id}
                createdAt={latest.ledger.createdAt}
              />
              {tradeEnabled && (
                <TradeLink
                  token={address}
                  variant="inline"
                  signal={{ kind: "verdict", tier: latest.verdict.tier }}
                />
              )}
              <VerdictView
                verdict={latest.verdict}
                ledger={latest.ledger}
                record={latest.record}
                scanMeta={null}
                traders={null}
              />
            </>
          ) : (
            <>
              <PageHeader
                eyebrow="ROBINHOOD CHAIN · ID 4663"
                title="THE VERDICT"
                subline="Reading the chain. Simulating the exit. Writing the receipt."
              />
              <ScanForm initialAddress={address} />
            </>
          )}
        </div>

        {/* The narrator sits beside the verdict, never inside it. It is given
            only the address: it reads the record itself, through the same
            public tools anyone else can call. */}
        <RobinKnightDock address={address} />
      </div>
    </NoirShell>
  );
}

/** No score in the title, no /api/og receipt image and no verdict JSON-LD: all three print the score. */
function ownTokenMetadata(): Metadata {
  const title = `${TOKEN_NAME} (${TOKEN_SYMBOL}): contract facts and vesting locks | RobinCalls`;
  const description = `What the ${TOKEN_SYMBOL} contract can do, where its supply sits, and its PinkLock vesting locks. RobinCalls issued this token, so it is not scored.`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/scan/${buildScanSlug(TOKEN_ADDRESS, TOKEN_SYMBOL)}` },
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

/** Plain, dated sentence plus matching JSON-LD: what an answer engine quotes for "is X safe". */
function VerdictSummary({
  verdict,
  ledger,
  url,
}: {
  verdict: Parameters<typeof verdictSummarySentence>[0];
  ledger: { id: number; createdAt: string };
  url: string;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(verdictJsonLd(verdict, ledger, url)) }}
      />
      <p className="mt-3 max-w-2xl text-sm text-[#c7c7c2]">{verdictSummarySentence(verdict, ledger)}</p>
    </>
  );
}

const barClass =
  "mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-2 px-4 pb-6 text-center font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a] sm:px-6";

/**
 * How old this receipt is, in the reader's own words. A token's state can turn
 * over inside an hour — DOOM was scanned and rugged 23 minutes apart — so the
 * age is not decoration: a stored verdict shown without it reads as current,
 * and that is a claim about the chain we have not earned (§4).
 */
function receiptAge(createdAt: string | null | undefined): string {
  if (!createdAt) return "date unknown";
  const then = new Date(createdAt).getTime();
  if (!Number.isFinite(then)) return "date unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

/** Sits above an archived verdict so the reader knows it's a record read, not fresh work, and can escape to either the ledger entry or a live rescan. */
function ArchivedVerdictBar({ verdictId, slug }: { verdictId: number; slug: string }) {
  return (
    <div className={barClass}>
      <Link href={`/ledger?v=${verdictId}#v${verdictId}`} className="underline hover:text-[#ededea]">
        BACK TO THE LEDGER
      </Link>
      <span className="text-[#3d3d3d]">·</span>
      <Link href={`/scan/${slug}`} className="underline hover:text-[#ededea]">
        LATEST RECORD
      </Link>
      <span className="text-[#3d3d3d]">·</span>
      <Link href={`/scan/${slug}?rescan=1`} className="underline hover:text-[#ededea]">
        RUN A FRESH SCAN
      </Link>
    </div>
  );
}

/**
 * Sits above the stored verdict. Says WHEN it was written and offers the live
 * scan — the two things that separate "the record" from "the current answer".
 * Landing here used to auto-run a live scan; SSR-ing the receipt is what makes
 * the page indexable, so the scan became a click, and the age stamp plus this
 * bar are what keep that honest rather than silent.
 */
function LatestVerdictBar({
  slug,
  verdictId,
  createdAt,
}: {
  slug: string;
  verdictId: number;
  createdAt?: string | null;
}) {
  return (
    <div className={barClass}>
      <span className="text-[#a08b5b]">SCANNED {receiptAge(createdAt).toUpperCase()}</span>
      <span className="text-[#3d3d3d]">·</span>
      <Link href={`/scan/${slug}?rescan=1`} className="underline hover:text-[#ededea]">
        RUN A FRESH SCAN
      </Link>
      <span className="text-[#3d3d3d]">·</span>
      <Link href={`/ledger?v=${verdictId}#v${verdictId}`} className="underline hover:text-[#ededea]">
        SEE THE LEDGER
      </Link>
    </div>
  );
}
