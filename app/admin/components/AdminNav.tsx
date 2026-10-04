"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Grouped nav (replaces the old flat 12-item list with no visual hierarchy
 * and no way to tell which page you're on). Groups mirror how the pages are
 * actually used day to day: Directory is the public-listing pipeline,
 * Trust & Safety is the "needs a human decision" cluster, System is
 * operability. `badges` carries live counts (open review items, active
 * marks, unresolved errors) computed once in layout.tsx.
 */
export interface NavItem {
  href: string;
  label: string;
}
export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { title: null, items: [{ href: "/admin", label: "Overview" }] },
  {
    title: "Directory",
    items: [
      { href: "/admin/listings", label: "Listings" },
      { href: "/admin/launchpads", label: "Launchpads" },
      { href: "/admin/ledger", label: "Ledger" },
    ],
  },
  {
    title: "Trust & Safety",
    items: [
      { href: "/admin/review", label: "Review Queue" },
      { href: "/admin/marks", label: "Marks" },
      { href: "/admin/wanted", label: "Wanted" },
      { href: "/admin/web", label: "The Web" },
      { href: "/admin/trusted", label: "Trusted Registry" },
    ],
  },
  {
    title: "Growth",
    items: [
      { href: "/admin/whitelist", label: "Whitelist" },
      { href: "/admin/token-sale", label: "Token Sale" },
      { href: "/admin/payouts", label: "Referral Payouts" },
    ],
  },
  {
    title: "System",
    items: [
      { href: "/admin/analytics", label: "Analytics" },
      { href: "/admin/logs", label: "Logs" },
      { href: "/admin/capacity", label: "Capacity" },
      { href: "/admin/sequencer", label: "Sequencer" },
      { href: "/admin/rpc", label: "RPC Pool" },
      { href: "/admin/swap", label: "Swap router" },
      { href: "/admin/settings", label: "Settings" },
    ],
  },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function NavBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto rounded-full bg-[#8a3a30] px-1.5 py-px text-[9px] font-bold leading-tight text-[#ededea]">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Desktop: fixed left sidebar, grouped, with active-route highlighting. */
export function AdminSidebar({ badges }: { badges: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav className="hidden w-52 shrink-0 flex-col gap-6 border-r border-[#2a2a2a] px-3 py-6 sm:flex">
      {NAV_GROUPS.map((g, i) => (
        <div key={i}>
          {g.title && (
            <div className="mb-2 px-2 font-mono text-[10px] tracking-[0.2em] text-[#4a4a4a]">
              {g.title.toUpperCase()}
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-2 border-l-2 px-2.5 py-1.5 text-[13px] transition-colors ${
                    active
                      ? "border-[#ccff00] bg-[#1a1a1a] font-medium text-[#ededea]"
                      : "border-transparent text-[#8a8a8a] hover:border-[#3d3d3d] hover:text-[#ededea]"
                  }`}
                >
                  {item.label}
                  <NavBadge count={badges[item.href]} />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Mobile: flat horizontal scroll strip (groups don't fit narrow screens). */
export function AdminMobileNav({ badges }: { badges: Record<string, number> }) {
  const pathname = usePathname();
  const flat = NAV_GROUPS.flatMap((g) => g.items);
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-[#2a2a2a] px-3 py-2 sm:hidden">
      {flat.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 py-1 text-[12px] transition-colors ${
              active ? "bg-[#1a1a1a] font-medium text-[#ededea]" : "text-[#8a8a8a]"
            }`}
          >
            {item.label}
            <NavBadge count={badges[item.href]} />
          </Link>
        );
      })}
    </nav>
  );
}
