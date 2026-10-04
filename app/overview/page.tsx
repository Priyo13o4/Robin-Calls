import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import { NoirShell } from "../components/site/NoirShell";
import { OverviewChrome } from "./OverviewChrome";
import { outlineFor } from "./outline";
import {
  parseOverviewDocument,
  type Block,
  type InlineRun,
  type OverviewDoc,
  type OverviewSection,
} from "@/lib/content/overview";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.overview.title,
  description: SEO_ROUTES.overview.description,
  keywords: [...SEO_ROUTES.overview.keywords],
  alternates: { canonical: "/overview" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/overview`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.overview.title,
    description: SEO_ROUTES.overview.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.overview.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.overview.title,
    description: SEO_ROUTES.overview.description,
    images: ["/brand/og-default.jpg"],
  },
};

/**
 * The Project Overview page — the web edition of `content/investor-overview.md`.
 *
 * One master, two emitters: this component renders the parsed AST for the web,
 * and `scripts/build-overview.ts` renders the same AST into the branded PDF
 * that the Download button serves from `/downloads/robincalls-overview.pdf`.
 * Editing the md and rebuilding the PDF keeps both surfaces identical; the
 * freshness test in `tests/overview-content.test.ts` fails if the md changes
 * without a PDF rebuild.
 *
 * ## The fs read is build-time only
 *
 * `Dockerfile.prod`'s runtime stage ships only the standalone output, so this
 * file must stay statically prerendered — the read below executes during
 * `next build` in the builder stage (where `content/` exists, via the
 * `!content/investor-overview.md` line in .dockerignore) and its result is
 * baked into the static HTML. Adding `revalidate`, dynamic APIs or anything
 * that opts this route out of prerendering would move the read to request
 * time, where the file does not exist, and the page would 500 in prod. If this
 * route ever needs to go dynamic, the md must move into the image explicitly.
 */

function readOverviewDoc(): OverviewDoc {
  const md = readFileSync(join(process.cwd(), "content", "investor-overview.md"), "utf8");
  return parseOverviewDocument(md);
}

/* ── inline runs ─────────────────────────────────────────────────────────── */

function Runs({ runs }: { runs: InlineRun[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.bold ? (
          <strong key={i} className="font-semibold text-[var(--ov-fg)]">
            {r.text}
          </strong>
        ) : r.italic ? (
          <em key={i}>{r.text}</em>
        ) : (
          r.text
        )
      )}
    </>
  );
}

/* ── blocks ──────────────────────────────────────────────────────────────── */

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "p":
            return (
              <p key={i} className="my-4 max-w-[70ch] text-[15px] leading-[1.8] text-[var(--ov-body)]">
                <Runs runs={b.runs} />
              </p>
            );
          case "ul":
            return (
              <ul key={i} className="my-5 flex max-w-[70ch] flex-col gap-2">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-[15px] leading-[1.7] text-[var(--ov-body)]">
                    <span className="mt-[2px] font-mono text-[10px] text-[var(--ov-accent-text)]">▪</span>
                    <span>
                      <Runs runs={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="my-5 flex max-w-[70ch] flex-col gap-2">
                {b.items.map((item, j) => (
                  <li key={j} className="flex gap-3 text-[15px] leading-[1.7] text-[var(--ov-body)]">
                    <span className="min-w-[1.4em] font-mono text-xs text-[var(--ov-accent-text)]">{j + 1}.</span>
                    <span>
                      <Runs runs={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );
          case "note":
            return (
              <aside
                key={i}
                className="my-5 max-w-[70ch] border-l-2 border-[#ccff00] bg-[var(--ov-notice-bg)] py-3 pl-4 pr-4"
              >
                <p className="text-[13px] leading-[1.7] text-[var(--ov-muted)]">
                  <Runs runs={b.runs} />
                </p>
              </aside>
            );
          case "table":
            return <DocTable key={i} header={b.header} rows={b.rows} />;
        }
      })}
    </>
  );
}

/**
 * 3+ column tables render as tables; 2-column tables render as a grid of
 * boxes (the reference's feature-box look — label/value pairs read better as
 * cards than as a two-cell row).
 */
function DocTable({ header, rows }: { header: string[]; rows: string[][] }) {
  if (header.length === 2) {
    return (
      <div className="my-6">
        <figcaption className="sr-only">
          {header.join(" — ")}
        </figcaption>
        <div className="grid gap-px border border-[var(--ov-border)] bg-[#2a2a2a] sm:grid-cols-2">
          {rows.map((row, i) => (
            <div key={i} className="bg-[var(--ov-surface)] p-5">
              <p className="font-cinzel text-[13px] font-bold tracking-[0.06em] text-[var(--ov-fg)]">{row[0]}</p>
              <p className="mt-1.5 text-[13px] leading-[1.6] text-[var(--ov-muted)]">{row[1]}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="my-6 overflow-x-auto overscroll-contain">
      <table className="w-full min-w-[560px] border-collapse border border-[var(--ov-border)] text-left">
        <thead>
          <tr className="bg-[var(--ov-surface)]">
            {header.map((h, i) => (
              <th
                key={i}
                className="border-b border-[var(--ov-border)] px-4 py-3 font-mono text-[10px] font-normal tracking-[0.18em] text-[var(--ov-accent-text)]"
              >
                {h.toUpperCase()}
                {i < header.length - 1 && <span className="sr-only"> column</span>}
              </th>
            ))}
          </tr>
          <tr className="sr-only">
            <td colSpan={header.length}>{header.join(" — ")}</td>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-[var(--ov-border)] last:border-b-0 align-top">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`px-4 py-3 text-[13px] leading-[1.6] ${
                    j === 0 ? "font-medium text-[var(--ov-fg)]" : "text-[var(--ov-body)]"
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

export default function OverviewPage() {
  const doc = readOverviewDoc();
  const parts = outlineFor(doc);
  const pdfHref = "/downloads/robincalls-overview.pdf";

  return (
    <NoirShell>
      <OverviewChrome parts={parts}>
        <article className="pb-32 pt-10">
          {/* ── Hero ─────────────────────────────────────────────────── */}
          <header>
            <p className="font-mono text-[10px] tracking-[0.3em] text-[var(--ov-muted)]">
              PROJECT OVERVIEW · ROBINHOOD CHAIN · ID 4663
            </p>
            <h1 className="mt-5 font-cinzel text-4xl font-black leading-[1.05] tracking-wide text-[var(--ov-fg)] sm:text-6xl">
              PROJECT OVERVIEW
            </h1>
            <p className="mt-4 font-mono text-[11px] tracking-[0.22em] text-[var(--ov-muted)]">
              {doc.meta.strapline.toUpperCase()}
            </p>
            <p className="mt-6 max-w-[62ch] font-serif text-lg italic leading-relaxed text-[var(--ov-body)]">
              {doc.meta.tagline}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a
                href={pdfHref}
                download
                className="inline-flex items-center gap-2.5 bg-[var(--ov-accent)] px-5 py-3 font-mono text-[11px] font-bold tracking-[0.18em] text-[#0a0a0a] transition-colors hover:opacity-90"
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 2v8m0 0l-3.5-3.5M8 10l3.5-3.5M2.5 13.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                DOWNLOAD PDF · V{doc.meta.version.toUpperCase()}
              </a>
              <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--ov-faint)]">
                {doc.meta.date.toUpperCase()} · ROBINCALLS.COM
              </span>
            </div>
          </header>

          {/* ── Parts and sections ───────────────────────────────────── */}
          {doc.parts.map((part) => (
            <section key={part.id}>
              <div className="mt-16 scroll-mt-28" id={part.id}>
                <div className="flex items-baseline gap-3 border-t-2 border-[#ccff00] pt-5">
                  <span className="font-mono text-sm text-[var(--ov-accent-text)]">{part.numeral}.</span>
                  <h2 className="font-cinzel text-xl font-bold tracking-[0.08em] text-[var(--ov-fg)] sm:text-2xl">
                    {part.title.toUpperCase()}
                  </h2>
                </div>
              </div>

              {part.sections.map((s) => (
                <OverviewSectionBlock key={s.id} section={s} />
              ))}
            </section>
          ))}

          {/* ── Closing download ─────────────────────────────────────── */}
          <div className="mt-20 border border-[var(--ov-border)] bg-[var(--ov-surface)] p-6 sm:p-8">
            <p className="font-cinzel text-lg font-bold tracking-wide text-[var(--ov-fg)]">
              Take the document with you
            </p>
            <p className="mt-2 max-w-[60ch] text-[13px] leading-[1.7] text-[var(--ov-muted)]">
              The same overview as a print-ready PDF, typeset in the RobinCalls brand.
            </p>
            <a
              href={pdfHref}
              download
              className="mt-5 inline-flex items-center gap-2.5 bg-[var(--ov-accent)] px-5 py-3 font-mono text-[11px] font-bold tracking-[0.18em] text-[#0a0a0a] transition-colors hover:opacity-90"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 2v8m0 0l-3.5-3.5M8 10l3.5-3.5M2.5 13.5h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              DOWNLOAD PDF · V{doc.meta.version.toUpperCase()}
            </a>
          </div>
        </article>
      </OverviewChrome>
    </NoirShell>
  );
}

function OverviewSectionBlock({ section }: { section: OverviewSection }) {
  const isNotice = section.id === "important-notice";
  return (
    <div>
      <h3
        id={section.id}
        className={`scroll-mt-28 border-b border-[var(--ov-border)] pb-3 pt-14 font-cinzel text-2xl font-bold tracking-wide text-[var(--ov-fg)] sm:text-[28px] ${
          isNotice ? "border-[var(--ov-accent-text)]/40" : ""
        }`}
      >
        {section.number !== null && (
          <span className="mr-3 align-middle font-mono text-sm font-normal text-[var(--ov-accent-text)]">
            {String(section.number).padStart(2, "0")}
          </span>
        )}
        {section.title}
      </h3>

      {isNotice ? (
        <div className="mt-6 border border-[var(--ov-border)] bg-[var(--ov-notice-bg)] p-5 sm:p-6">
          <Blocks blocks={section.blocks} />
        </div>
      ) : (
        <Blocks blocks={section.blocks} />
      )}

      {section.subsections.map((sub) => (
        <div key={sub.id}>
          {sub.level === 3 ? (
            <h4
              id={sub.id}
              className="scroll-mt-28 pt-10 font-cinzel text-[17px] font-bold tracking-[0.04em] text-[var(--ov-fg)]"
            >
              {sub.title}
            </h4>
          ) : (
            <h5
              id={sub.id}
              className="scroll-mt-28 pt-8 font-mono text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--ov-fg)]"
            >
              {sub.title}
            </h5>
          )}
          <Blocks blocks={sub.blocks} />
        </div>
      ))}
    </div>
  );
}
