"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ROBIN_KNIGHT_LINK,
  NAV_GROUPS,
  SCAN_LINK,
  SWAP_LINK,
  isActive,
  type NavLink,
} from "./nav-links";
import { SidebarWalletAction } from "./AppSidebar";
import { NavIcon } from "./nav-icons";
import { useWhitelistStatusContext } from "./WhitelistStatusContext";
import { flags } from "@/lib/config/flags";

/**
 * Interior-site navigation: a wordmark, the SCAN action, and a drawer.
 *
 * The inline desktop link row is gone. It carried nine items plus the SCAN
 * button, and it broke: once the Robin Knight rail displaced `<main>`, the bar's
 * own breakpoints still saw a wide viewport, so all nine kept rendering and
 * collided with the wordmark at 1440 (RobinKnightDock:130-141 records the
 * sighting). Adding a tenth product would have broken it again. One drawer,
 * every breakpoint, grouped — see nav-links.ts for why the groups are what they
 * are.
 *
 * SCAN stays in the bar rather than moving into the drawer. It is the primary
 * action on the site and burying it one click deeper to tidy up the chrome
 * would be the wrong trade; the drawer holds the nine things you *browse*.
 *
 * Accessibility is hand-built (no shadcn/Radix, to avoid a components.json +
 * globals.css theme rewrite that would collide with the Tailwind v4 noir
 * tokens): aria-expanded/controls, Escape to close, body scroll-lock, focus
 * into the panel on open and back to the trigger on close, a click-anywhere
 * scrim, and auto-close on route change.
 *
 * Lime discipline (DESIGN.md): the bar is fully monochrome. The open drawer is
 * its own viewport and spends its single lime on the active item's left edge —
 * which is why SCAN is Paper here and not lime.
 */
export function SiteNav({
  isFixed = false,
  variant = "marketing",
}: {
  isFixed?: boolean;
  /**
   * `marketing` — the landing page. Renders at every width; there is no
   * sidebar there, so this bar is the only navigation.
   *
   * `app` — interior pages. Hidden from `lg` up, where `AppSidebar` takes
   * over. The drawer is a sibling of <nav> and `fixed`, so it needs the same
   * breakpoint applied independently — hiding only the bar would leave an
   * openable drawer with no trigger.
   */
  variant?: "marketing" | "app";
} = {}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  // Same provider AppSidebar reads — the desktop rail's "Connect Wallet" had
  // no phone-view equivalent at all, since this drawer never rendered one.
  const { wallet } = useWhitelistStatusContext();

  const close = useCallback(() => setOpen(false), []);

  // close the drawer whenever the route changes
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  /**
   * Scroll-lock + Escape + focus management while the drawer is open.
   *
   * The lock goes on `document.scrollingElement`, NOT on `<body>`.
   *
   * Locking body is the usual recipe and it did nothing here. Body's overflow is
   * only propagated to the viewport while `<html>` is `overflow: visible`, and
   * this app's `<html>` declares `overflow-x: hidden` — so body kept its own
   * overflow, html stayed the scrolling element, and the page behind this
   * `aria-modal="true"` dialog scrolled freely the whole time. Measured before
   * the fix: 600px of background scroll with the drawer open.
   *
   * Hiding the scrollbar reclaims its width, which would shift the entire page
   * sideways as the drawer opens, so the gutter is measured first and handed
   * back as padding.
   */
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const trigger = triggerRef.current;
    const scroller = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const { overflow, paddingRight } = scroller.style;
    const gutter = window.innerWidth - scroller.clientWidth;
    scroller.style.overflow = "hidden";
    if (gutter > 0) scroller.style.paddingRight = `${gutter}px`;
    firstLinkRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      scroller.style.overflow = overflow;
      scroller.style.paddingRight = paddingRight;
      (previouslyFocused ?? trigger)?.focus?.();
    };
  }, [open]);

  /**
   * Re-navigating to the page you are already on.
   *
   * `/scan` runs its pipeline client-side and swaps its own form out for a
   * verdict, so a <Link> to `/scan` from `/scan/0x…` (or from a completed scan)
   * is a no-op the App Router happily ignores — you click SCAN A TOKEN and
   * nothing happens. A full load is the only way back to an empty form.
   */
  const reload = useCallback((e: React.MouseEvent, href: string) => {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      e.preventDefault();
      window.location.href = href;
    }
  }, [pathname]);

  /** Applied to the bar, the scrim and the panel alike — see `variant`. */
  const breakpoint = variant === "app" ? "lg:hidden" : "";

  return (
    <>
      {/* z-50: navigation outranks every overlay on the site.
          The Robin Knight dock is z-40, and on a phone its peek bar is fixed to
          the bottom of the viewport — which is exactly where this drawer puts
          its own footer. At z-30 the menu lost, and the way out of the page sat
          underneath a chat prompt. Whatever else is on screen, the way out of it
          must be reachable. */}
      {/* `data-app-bar` is a measurement handle, not a styling hook. Anything
          that has to stick BELOW this bar needs its height, and that height is
          content-derived — tallest child plus padding plus the rule — so it
          moves whenever the row's contents change. It was 86px while the scan
          button wrapped to three lines. Measure this element; do not copy a
          number off it (`RobinKnightDock` hardcodes 65px and has been wrong). */}
      <nav
        data-app-bar
        className={`${isFixed ? "fixed w-full" : "sticky"} top-0 z-50 border-b border-[#2a2a2a] bg-[#0a0a0a]/80 backdrop-blur-md ${breakpoint}`}
      >
        <div className="flex items-center justify-between px-4 py-4 sm:px-8">
          {/* `min-w-0` lets this shrink; without it the flex item keeps its
              `min-width: auto` and ROBINCALLS — one unbreakable word — spilled
              8px past its own link box and under the button beside it. */}
          <Link
            href="/"
            className="flex min-w-0 items-center gap-3"
            aria-label="RobinCalls home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-sm.webp" alt="" className="h-7 w-7 flex-none object-contain" />
            <span className="truncate font-cinzel text-sm font-bold tracking-[0.16em] text-[#ededea] sm:tracking-[0.22em]">
              ROBINCALLS
            </span>
          </Link>

          <div className="flex items-center gap-2.5 sm:gap-5">
            {/* Desktop only — the drawer already carries this action (line
                ~290) for every width below `sm`, and the bar has no room for
                both a wallet chip and the SCAN button without wrapping. */}
            {flags.wallet && (
              <div className="hidden sm:block">
                <SidebarWalletAction collapsed={false} wallet={wallet} />
              </div>
            )}

            <Link
              href={SWAP_LINK.href}
              aria-current={isActive(pathname, SWAP_LINK.href) ? "page" : undefined}
              className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light flex items-center gap-1.5 whitespace-nowrap border px-2.5 py-2 font-inter text-[11px] font-bold uppercase tracking-[0.12em] text-[#0a0a0a] sm:px-4 sm:tracking-[0.18em] ${
                isActive(pathname, SWAP_LINK.href) ? "border-[#ededea] bg-[#ffb46e]" : "border-[#ff9a3c] bg-[#ff9a3c]"
              }`}
            >
              <span className="hidden sm:inline-flex">
                <NavIcon name="swap" size={13} />
              </span>
              SWAP
            </Link>

            <Link
              href={SCAN_LINK.href}
              aria-current={isActive(pathname, SCAN_LINK.href) ? "page" : undefined}
              onClick={(e) => reload(e, SCAN_LINK.href)}
              className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light font-inter font-bold text-[11px] tracking-[0.12em] uppercase text-[#0a0a0a] bg-[#ededea] border-[#ededea] px-3 py-2 cursor-pointer whitespace-nowrap sm:px-5 sm:tracking-[0.18em]"
            >
              {/* `whitespace-nowrap` above is the actual fix — a button in a
                  bar must never wrap, because its height sets the bar's height
                  and everything sticky below it is positioned off that. The
                  short label is what makes one line fit at 375px. */}
              <span className="sm:hidden">{SCAN_LINK.short ?? SCAN_LINK.label}</span>
              <span className="hidden sm:inline">{SCAN_LINK.label}</span>
            </Link>

            <button
              ref={triggerRef}
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="site-drawer"
              className="flex h-9 w-9 flex-col items-center justify-center gap-[5px]"
            >
              <span
                className={`block h-[2px] w-6 bg-[#ededea] transition-transform duration-200 motion-reduce:transition-none ${
                  open ? "translate-y-[7px] rotate-45" : ""
                }`}
              />
              <span
                className={`block h-[2px] w-6 bg-[#ededea] transition-opacity duration-200 motion-reduce:transition-none ${
                  open ? "opacity-0" : ""
                }`}
              />
              <span
                className={`block h-[2px] w-6 bg-[#ededea] transition-transform duration-200 motion-reduce:transition-none ${
                  open ? "-translate-y-[7px] -rotate-45" : ""
                }`}
              />
            </button>
          </div>
        </div>
      </nav>

      {/* Scrim and panel are siblings of <nav>, not children, so the nav's
          backdrop-blur doesn't become their containing block — which would
          break a fixed overlay's positioning and opacity.

          Both stay mounted and `open` only drives transforms. Swapping between
          two returns gives an opening animation and no closing one: React
          removes the panel on the same frame the class would have started
          moving it, so it vanishes instead of sliding. Same reasoning as
          RobinKnightDock. `inert` keeps the closed panel out of the tab order
          and the accessibility tree. */}
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={close}
        className={`fixed inset-0 z-40 bg-[#0a0a0a]/70 transition-opacity duration-300 ease-out motion-reduce:transition-none ${breakpoint} ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <div
        id="site-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        data-lenis-prevent
        inert={!open}
        /* `data-lenis-prevent` is load-bearing on the landing page, which runs
           Lenis. Lenis captures the wheel for the whole document and turns it
           into its own page-scroll animation, so without this opt-out the wheel
           over this drawer scrolled the page BEHIND it and the last items were
           unreachable — exactly the "missing the bottom" report. It is inert on
           pages with no Lenis instance, so it is set unconditionally.

           `overscroll-contain`: once the drawer does receive the wheel, reaching
           its end must not hand the remainder to the page underneath.

           `h-dvh` rather than `h-full` because a phone's 100vh includes the
           browser UI, which would put the footer below the fold. */
        className={`fixed right-0 top-0 z-50 flex h-dvh w-full max-w-[380px] flex-col overflow-y-auto overscroll-contain border-l-2 border-[#2a2a2a] bg-[#0a0a0a] px-6 pb-10 pt-5 transition-transform duration-300 ease-out motion-reduce:transition-none ${breakpoint} ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="mb-8 flex items-center justify-end">
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="font-mono text-[11px] tracking-[0.18em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
          >
            CLOSE ✕
          </button>
        </div>

        {/* The two actions, above the groups. */}
        <Link
          ref={firstLinkRef}
          href={SCAN_LINK.href}
          onClick={(e) => {
            reload(e, SCAN_LINK.href);
            close();
          }}
          className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light block text-center font-inter text-[12px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a] bg-[#ededea] border-[#ededea] py-3.5 cursor-pointer"
        >
          {SCAN_LINK.label}
        </Link>
        <Link
          href={ROBIN_KNIGHT_LINK.href}
          onClick={close}
          aria-current={isActive(pathname, ROBIN_KNIGHT_LINK.href) ? "page" : undefined}
          className="brutalist-box brutalist-shadow-light brutalist-pressable halftone-dark mt-3 block text-center font-inter text-[12px] font-bold uppercase tracking-[0.18em] text-[#ededea] bg-[#0a0a0a] border-[#ededea] py-3.5 cursor-pointer"
        >
          {ROBIN_KNIGHT_LINK.label}
        </Link>
        {/* The whitelist drawer action sat here until 2026-09-04. Not refilled
            with TOKENOMICS — REFERENCE below already carries that link. */}

        {/* The one action AppSidebar has and this drawer never did: phone view
            had no way to connect a wallet at all below `lg`. Same component,
            same gate (flags.wallet) as the desktop rail. */}
        {flags.wallet && (
          <div className="mt-3">
            <SidebarWalletAction collapsed={false} wallet={wallet} />
          </div>
        )}

        <div className="mt-10 flex flex-col gap-9">
          {NAV_GROUPS.map((group) => (
            <section key={group.title}>
              <h2 className="mb-1 font-mono text-[10px] font-medium tracking-[0.24em] text-[#3d3d3d]">
                {group.title}
              </h2>
              <div className="flex flex-col">
                {group.links.map((l: NavLink) => {
                  const active = isActive(pathname, l.href);
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      // `last:border-b-0`, not `last:border-0` — the latter zeroes
                      // ALL four sides on the group's last item, and a `:last-child`
                      // pseudo-class beats a plain `.border-l-2` class on specificity
                      // regardless of source order. That silently ate the active-state
                      // left border on ECOSYSTEM (last in "THE RECORD") and would do
                      // the same to RWAs (last in "INTELLIGENCE").
                      className={`border-b border-[#1c1c1c] py-3.5 font-cinzel text-lg font-bold tracking-[0.08em] transition-colors last:border-b-0 ${
                        active
                          ? "border-l-2 border-l-[#ccff00] pl-4 text-[#ededea]"
                          : "text-[#8a8a8a] hover:text-[#ededea]"
                      }`}
                    >
                      {l.label}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <p className="mt-auto pt-12 font-serif text-sm italic text-[#8a8a8a]">
          On-chain. On record. On time.
        </p>
      </div>

      {/* A sibling of #site-drawer, not a child of it — the drawer is
          `translate-x-*` for its slide animation, and a `transform` on an
          ancestor becomes the containing block for any `position: fixed`
          descendant. Nested in there, this modal would translate off-screen
          with the (now-closing) drawer instead of staying fixed to the
          viewport. */}
      {/* Refresh on close, not just after a specific success branch inside the
          modal — cheaper to reason about than threading an onApproved callback
          through every path in there (connect, X, Telegram, change-wallet),
          and a no-op refresh (nothing changed) costs one GET. */}
    </>
  );
}
