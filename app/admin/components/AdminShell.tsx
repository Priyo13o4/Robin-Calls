import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "./SignOutButton";
import { AdminWalletButton } from "./AdminWalletButton";
import { AdminMobileNav, AdminSidebar } from "./AdminNav";

/**
 * Admin console chrome — noir, utilitarian. Distinct from the public NoirShell
 * (dense, table-first, no marketing polish). Server component; the sign-out
 * control, the wallet island and the nav (for active-route highlighting) are
 * the client islands.
 *
 * Layout: a grouped left sidebar on desktop (see AdminNav) replaces the old
 * flat 12-item top nav — with 12 destinations of very different importance
 * (Settings and the Review queue used to carry equal visual weight), a
 * sidebar with section labels and current-page highlighting reads far faster
 * than a horizontal strip. `badges` (open review count, active marks, etc.)
 * comes from one query in layout.tsx so every page shows the same numbers.
 */
export function AdminShell({
  children,
  username,
  badges = {},
}: {
  children: ReactNode;
  username: string;
  badges?: Record<string, number>;
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-[#ededea]">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-[#2a2a2a] bg-[#0a0a0a] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/admin" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-sm.webp" alt="" className="h-6 w-6 object-contain" />
            <span className="font-cinzel text-xs font-bold tracking-[0.22em]">
              ROBINCALLS
            </span>
            <span className="font-mono text-[10px] tracking-[0.2em] text-[#8a8a8a]">
              / ADMIN
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <AdminWalletButton />
          <Link
            href="/"
            className="flex items-center gap-1.5 border border-[#2a2a2a] px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
          >
            ← BACK TO SITE
          </Link>
          <span className="hidden font-mono text-[11px] text-[#8a8a8a] sm:inline">
            {username}
          </span>
          <SignOutButton />
        </div>
      </header>

      <AdminMobileNav badges={badges} />

      <div className="mx-auto flex max-w-7xl">
        <AdminSidebar badges={badges} />
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Section heading used across admin pages. */
export function AdminHeading({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h1 className="font-cinzel text-2xl font-bold tracking-[0.06em]">{title}</h1>
      {sub && <p className="mt-1 text-sm text-[#8a8a8a]">{sub}</p>}
    </div>
  );
}
