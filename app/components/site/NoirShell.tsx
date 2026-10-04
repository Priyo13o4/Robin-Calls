import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { SiteNav } from "./SiteNav";
import { SiteFooter } from "./SiteFooter";

/**
 * Shared noir chrome for all interior pages (/scan, /ledger, /wanted,
 * /compare, /methodology). The landing page (app/page.tsx) has its own
 * chrome and is owned by the design workstream — do not reuse this there.
 *
 * Two navigations, split by width and never both visible:
 *   - `lg` and up — `AppSidebar`, a persistent left rail, open by default.
 *   - below `lg` — `SiteNav` in its `app` variant: a top bar and a drawer.
 *
 * The sidebar is in the flex flow, not `fixed`, so the content column reflows
 * from its width alone and nothing needs to know how wide it is.
 *
 * It also carries a z-index, and that is not decoration. Six pages under this
 * shell paint a full-bleed backdrop as `pointer-events-none fixed inset-0 z-0`
 * plus a grain layer at `z-[1]` (scan, scan/[address], wanted, directory, and
 * both RWA clients). `fixed` escapes the flex flow, so those span the viewport
 * — sidebar included — and a positioned element with an explicit z-index paints
 * over a `sticky` sibling whose z-index is `auto`, whatever the DOM order. The
 * sidebar rendered underneath the courtroom plate: invisible, but still
 * clickable, because the backdrop takes no pointer events.
 *
 * Fixing it on the sidebar rather than on the six pages is deliberate — the
 * backdrop pattern is copied into every new page of this kind, so a per-page
 * fix would be re-broken by the next one. `z-30` sits under SiteNav (z-50) and
 * the Robin Knight dock (z-40), both of which are meant to outrank it.
 *
 * `min-w-0` on the content column is load-bearing: a flex child defaults to
 * `min-width: auto`, so one wide table (the ledger, the methodology weights)
 * would push the column out instead of scrolling inside it, and take the
 * sidebar off-screen with it.
 *
 * Design system: DESIGN.md — near-black canvas, Paper text, lime is scarce.
 * The sidebar spends its own budget (see AppSidebar); pages still place theirs.
 */
export function NoirShell({
  children,
  showFooter = true,
}: {
  children: ReactNode;
  showFooter?: boolean;
}) {
  return (
    <div className="min-h-screen w-full bg-[#0a0a0a] text-[#ededea]">
      <SiteNav variant="app" />

      <div className="flex w-full items-start">
        <AppSidebar />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col overflow-x-clip">
          <main className="flex-1">{children}</main>
          {showFooter && <SiteFooter />}
        </div>
      </div>
    </div>
  );
}

/** Shared page header block: eyebrow + Cinzel display title + subline. */
export function PageHeader({
  eyebrow,
  title,
  titleIcon,
  subline,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  /** Optional adornment rendered inline to the left of the title (e.g. a token logo). */
  titleIcon?: ReactNode;
  subline?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mx-auto max-w-5xl px-4 pb-10 pt-16 sm:px-6 sm:pt-24">
      {eyebrow && (
        <p className="mb-4 text-[11px] font-medium tracking-[0.3em] text-[#8a8a8a]">
          {eyebrow}
        </p>
      )}
      <div className="flex items-center gap-4">
        {titleIcon}
        <h1 className="font-cinzel text-4xl font-black leading-tight tracking-wide sm:text-6xl">
          {title}
        </h1>
      </div>
      {subline && (
        <p className="mt-4 max-w-2xl font-serif italic text-[#8a8a8a]">{subline}</p>
      )}
      {children}
    </header>
  );
}

/** Status word rendering per the design prompts — grayscale, FAIL striped. */
export function StatusWord({ status }: { status: string }) {
  if (status === "PASS")
    return <span className="text-xs font-bold tracking-[0.2em] text-[#ccff00]">PASS</span>;
  if (status === "WARN")
    return <span className="text-xs tracking-[0.2em] text-[#8a8a8a]">WARN</span>;
  if (status === "SKIP")
    return <span className="text-xs tracking-[0.2em] text-[#3d3d3d]">SKIP</span>;
  
  // FAIL or CRITICAL
  return (
    <span
      className="px-2 py-0.5 text-xs font-bold tracking-[0.2em] text-[#ff3333]"
      style={{
        background:
          "repeating-linear-gradient(135deg, #1a0505, #1a0505 6px, #2a0a0a 6px, #2a0a0a 12px)",
        border: "1px solid #3a0b0b",
      }}
    >
      {status}
    </span>
  );
}
