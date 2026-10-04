"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSmoothScroll } from "../components/site/lenis";
import {
  DOC_ANCHORS,
  DOC_PARTS,
  activeAnchorFor,
  partFillFor,
  type DocPart,
} from "./outline";

/**
 * Documentation chrome for the methodology whitepaper: the part navigation on
 * the left, the "on this page" rail on the right, and — on anything narrower
 * than `xl` — a sticky bar carrying a segmented fill for the eight parts.
 *
 * Split out as the only client component on this page so the document body —
 * every weight, mechanism and changelog entry, which is the bulk of the bytes —
 * stays server-rendered and never ships `lib/config/formula.ts` to the browser.
 *
 * ## Two left rails is deliberate
 *
 * `NoirShell` already owns a left sidebar, so at `xl` the reader sees the app
 * rail, then this document's rail, then the prose. That is the documentation-site
 * shape (and the shape asked for), and the two are answering different questions:
 * the app rail is *where in RobinCalls am I*, this one is *where in this document
 * am I*. It appears only at `xl`, where there is width for both.
 *
 * ## The rails are sized to their content, not to the viewport
 *
 * `h-screen` here was a bug with two heads. It made each rail a full-viewport
 * scroll container even when its list was short, so a wheel over the empty lower
 * half of the rail was swallowed by a scrollport with nothing to scroll instead
 * of moving the page — the "page is fixed and the inside scrolls" feeling. And a
 * rail taller than its content pins a large dead block to the screen.
 *
 * `h-max` + `max-h` gives the correct behaviour on both counts: the rail is as
 * tall as its list, scrolls internally only if that list genuinely overflows,
 * and otherwise passes the wheel straight through to the page.
 */

/**
 * Combined height of whatever chrome is currently pinned to the top.
 *
 * Measured per call rather than stored, because which bars are sticky depends
 * on the breakpoint: below `lg` both the app bar and the doc bar are pinned,
 * from `lg` only the doc bar, from `xl` neither. A hidden or statically
 * positioned bar contributes nothing, so one loop covers all three cases
 * without knowing the breakpoints.
 *
 * The `scroll-mt-24` on the headings is the no-JS fallback for the same job and
 * is deliberately kept — but it is a single fixed 96px, which is too much on a
 * desktop with no bars and too little on a phone with two. This is the number
 * that is actually right.
 */
function stickyTopOffset(): number {
  let total = 0;
  for (const selector of ["[data-app-bar]", "[data-doc-bar]"]) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const style = getComputedStyle(el);
    if (style.display === "none") continue;
    if (style.position !== "sticky" && style.position !== "fixed") continue;
    /**
     * Measure the bar's PINNED header, not the whole sticky box.
     *
     * The doc bar's expanded contents panel lives inside that box, so measuring
     * the box while the panel is open returned 611px instead of 70 — and a jump
     * launched from the panel (the only way to open it) would have landed the
     * heading roughly half a screen too low, every time. The panel is dismissed
     * on the same click, so what stays pinned is the header alone.
     */
    const pinned = el.querySelector("[data-bar-height]") ?? el;
    total += pinned.getBoundingClientRect().height;
  }
  return total;
}

/** Breathing room between the pinned chrome and the heading it reveals. */
const SCROLL_GAP_PX = 28;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MethodologyChrome({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<string>(DOC_ANCHORS[0]);
  const [fills, setFills] = useState<number[]>(() => DOC_PARTS.map(() => 0));
  const [filter, setFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [appBarHeight, setAppBarHeight] = useState(0);
  const frame = useRef<number | null>(null);
  const article = useRef<HTMLDivElement | null>(null);
  /**
   * Same smooth scrolling as the landing page — an eight-part document is the
   * surface that benefits from it most, and a reader moving between the two
   * should not feel the scrolling change under them.
   *
   * Null under `prefers-reduced-motion`, and every jump below falls back to the
   * native path when it is.
   */
  const lenis = useSmoothScroll();

  /**
   * The active anchor and the per-part fills are both pure functions of scroll
   * position, so one coalesced listener measures the DOM once and hands the
   * numbers to `activeAnchorFor` / `partFillFor`.
   *
   * A scroll handler rather than an IntersectionObserver: the question here is
   * "which heading did I last pass", which is an ordering over all anchors, not
   * a per-element visibility fact. Expressed with an observer it becomes a
   * threshold-and-rootMargin puzzle that answers wrong for any section shorter
   * than the margin — and the changelog has several.
   */
  const measure = useCallback(() => {
    frame.current = null;

    const tops = DOC_ANCHORS.map((id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().top : null;
    });
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    setActive(activeAnchorFor(tops, scrollable > 0 && window.scrollY >= scrollable - 2));

    const partTops = DOC_PARTS.map((p) => {
      const el = document.getElementById(p.id);
      return el ? el.getBoundingClientRect().top : null;
    });
    const end = article.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    setFills(partFillFor(partTops, end));
  }, []);

  useEffect(() => {
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };
    // Deferred rather than called inline: the first measurement wants a settled
    // layout, and setting state straight out of an effect body is what
    // `react-hooks/set-state-in-effect` exists to stop.
    frame.current = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [measure]);

  /**
   * The doc bar sticks directly below `SiteNav`'s app bar, so it needs that
   * bar's height — measured, never assumed.
   *
   * A literal alone was the obvious first pass and is wrong twice: the bar is
   * 86px (16 padding + a 53px button group + 16 + a 1px rule), not the 65px this
   * codebase guesses for it elsewhere, so the doc bar stuck 21px *underneath*
   * it; and the number is not constant, since the bar is `lg:hidden` and
   * collapses to nothing from `lg` up.
   *
   * Measuring covers both — a hidden element reports 0, which is exactly the
   * offset wanted up there. But the classes below still carry the same values as
   * a fallback, because `ResizeObserver` delivers on the rendering steps: a
   * browser that is not producing frames (a backgrounded tab, an automated pane)
   * never gets the callback, and the bar would stick at 0 and slide under the
   * app bar. The measurement overrides the fallback only once it has a real
   * number, so the two can never disagree in the wrong direction.
   */
  useEffect(() => {
    const bar = document.querySelector("[data-app-bar]");
    if (!bar) return;
    const observer = new ResizeObserver(() =>
      setAppBarHeight(bar.getBoundingClientRect().height)
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  /**
   * In-page jumps, for every anchor on this page — both rails, the mobile
   * panel, and any link inside the prose.
   *
   * Delegated at the container rather than bound per link: the anchors are
   * spread across four different renderers here, and a handler attached to each
   * is a handler somebody forgets on the fifth.
   *
   * It replaces the native jump for two reasons. The browser lands the heading
   * under the pinned bars, because the only offset it knows is the static
   * `scroll-mt-24`; and a jump that teleports gives the reader no sense of how
   * far they moved in an eight-part document, which is exactly what a
   * whitepaper's navigation should convey.
   */
  const jumpTo = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (!target) return;

    const top =
      target.getBoundingClientRect().top +
      window.scrollY -
      stickyTopOffset() -
      SCROLL_GAP_PX;

    if (lenis.current) {
      // Through Lenis, not `window.scrollTo` — both animate the same scroll
      // position, and run together they fight and stutter. `offset` is applied
      // to the target's own position, so it is the chrome allowance negated.
      lenis.current.scrollTo(target, {
        offset: -(stickyTopOffset() + SCROLL_GAP_PX),
      });
    } else {
      window.scrollTo({
        top: Math.max(0, top),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }

    // Keep the URL citable without stacking a history entry per click — this is
    // a document people link into, and Back should leave the document.
    window.history.replaceState(null, "", `#${id}`);

    // Restart the highlight even if the same heading is picked twice: removing
    // the class and forcing a reflow before re-adding is what makes the
    // animation replay, since re-adding alone is a no-op to the engine.
    target.classList.remove("rc-doc-target");
    void target.offsetWidth;
    target.classList.add("rc-doc-target");
    target.addEventListener(
      "animationend",
      () => target.classList.remove("rc-doc-target"),
      { once: true }
    );
  }, [lenis]);

  const onAnchorClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Let the browser handle anything it should: new tabs, downloads, modified
      // clicks. Only a plain left-click on a same-page anchor is ours.
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement).closest?.("a");
      const href = link?.getAttribute("href");
      if (!href || !href.startsWith("#")) return;
      e.preventDefault();
      jumpTo(href.slice(1));
    },
    [jumpTo]
  );

  /**
   * A deep link lands via the browser's own jump, which knows only the static
   * `scroll-mt` and therefore parks the heading under the pinned bars. Redo it
   * once on mount with the measured offset.
   */
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const timer = window.setTimeout(() => jumpTo(id), 0);
    return () => window.clearTimeout(timer);
  }, [jumpTo]);

  /** Which part contains the active anchor — drives the nav and the bar label. */
  const activePart = useMemo(
    () =>
      DOC_PARTS.find((p) => p.id === active || p.sections.some((s) => s.id === active)) ??
      DOC_PARTS[0],
    [active]
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return DOC_PARTS;
    return DOC_PARTS.map((p) => {
      const partHit = p.title.toLowerCase().includes(q);
      const sections = p.sections.filter((s) => s.title.toLowerCase().includes(q));
      // A part whose own title matches keeps all its sections — the reader
      // searched for the part, not for a subset of it.
      return partHit ? p : { ...p, sections };
    }).filter((p) => p.title.toLowerCase().includes(q) || p.sections.length > 0);
  }, [filter]);

  return (
    <div
      className="mx-auto w-full max-w-[1500px] px-4 sm:px-6"
      onClick={onAnchorClick}
    >
      {/* ── Narrow screens: sticky bar with the segmented fill ──────────── */}
      {/* Offset measured above, so this clears SiteNav's app bar on phones and
          sits flush at the top from `lg` (where that bar is hidden and the app
          sidebar takes over). z-30 keeps it under the app bar and under the
          Robin Knight dock, both of which must outrank it. */}
      <div
        className="sticky top-[86px] z-30 -mx-4 border-b border-[#2a2a2a] bg-[#0a0a0a]/85 backdrop-blur-md sm:-mx-6 lg:top-0 xl:hidden"
        /* The contents panel below is an OVERLAY, absolutely positioned against
           this element — `position: sticky` already establishes a containing
           block, so no `relative` is needed (and adding one would just be two
           position utilities fighting over the same property).

           In flow, the panel pushed the whole document down by its own height
           while open. Since the only way to reach a link in it is to open it,
           every jump launched from the panel was computed against a layout that
           ceased to exist the moment the panel closed — overshooting by ~490px.
           An overlay changes no geometry, so the measurement holds. */
        style={appBarHeight > 0 ? { top: appBarHeight } : undefined}
        data-doc-bar
      >
        <div
          data-bar-height
          className="relative flex items-center justify-between gap-3 px-4 py-3 sm:px-6"
        >
          <p className="min-w-0 truncate font-cinzel text-xs font-bold tracking-[0.1em] text-[#ededea]">
            <span className="mr-2 font-mono text-[10px] font-normal text-[#8a8a8a]">
              {activePart.numeral}
            </span>
            {activePart.title.toUpperCase()}
          </p>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="doc-contents-panel"
            className="flex flex-none items-center gap-2 border border-[#2a2a2a] px-2.5 py-1.5 font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a] transition-colors hover:border-[#3d3d3d] hover:text-[#ededea]"
          >
            CONTENTS
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
              className={`transition-transform duration-200 motion-reduce:transition-none ${
                menuOpen ? "rotate-180" : ""
              }`}
            >
              <path
                d="M3 6l5 5 5-5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* The fill: one segment per part, on the HEADER's bottom edge — it
              belongs to the bar, so it must not ride down to the bottom of the
              expanded panel. Absolute, so it adds no height to the measurement
              above. */}
          <div
            className="absolute inset-x-0 bottom-0 flex h-[3px] gap-[2px]"
            role="presentation"
          >
            {DOC_PARTS.map((part, i) => (
              <div key={part.id} className="flex-1 bg-[#2a2a2a]">
                <div
                  className="h-full bg-[#ccff00] transition-[width] duration-150 ease-out motion-reduce:transition-none"
                  style={{ width: `${(fills[i] ?? 0) * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {menuOpen && (
          <div
            id="doc-contents-panel"
            data-lenis-prevent
            className="absolute inset-x-0 top-full z-40 max-h-[60vh] overflow-y-auto overscroll-contain border-b border-t border-[#2a2a2a] bg-[#0a0a0a] px-4 py-4 shadow-[0_16px_32px_rgba(0,0,0,0.6)] sm:px-6"
          >
            <ol className="flex flex-col gap-5">
              {DOC_PARTS.map((part) => (
                <li key={part.id}>
                  <a
                    href={`#${part.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-baseline gap-2.5"
                  >
                    <span
                      className={`font-mono text-[10px] ${
                        part.id === activePart.id ? "text-[#ccff00]" : "text-[#3d3d3d]"
                      }`}
                    >
                      {part.numeral}
                    </span>
                    <span className="font-cinzel text-[13px] font-bold leading-snug tracking-[0.06em] text-[#ededea]">
                      {part.title}
                    </span>
                  </a>
                  <ul className="mt-1.5 flex flex-col border-l border-[#2a2a2a] pl-0">
                    {part.sections.map((s) => (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          onClick={() => setMenuOpen(false)}
                          aria-current={active === s.id ? "true" : undefined}
                          className={`-ml-px block border-l py-1 pl-3.5 text-xs leading-snug ${
                            active === s.id
                              ? "border-l-[#ccff00] text-[#ededea]"
                              : "border-l-transparent text-[#8a8a8a]"
                          }`}
                        >
                          {s.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      <div className="grid gap-x-10 xl:grid-cols-[236px_minmax(0,1fr)] 2xl:grid-cols-[236px_minmax(0,1fr)_200px]">
        {/* ── Left: parts ─────────────────────────────────────────────── */}
        <nav
          aria-label="Document contents"
          data-lenis-prevent
          className="sticky top-14 hidden h-max max-h-[calc(100vh-7rem)] flex-col overflow-y-auto py-14 pr-2 [scrollbar-width:none] xl:flex [&::-webkit-scrollbar]:hidden"
        >
          <label className="mb-5 block">
            <span className="sr-only">Filter sections</span>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="FILTER SECTIONS"
              className="w-full border border-[#2a2a2a] bg-[#141414] px-3 py-2 font-mono text-[10px] tracking-[0.16em] text-[#ededea] placeholder:text-[#3d3d3d] focus:border-[#3d3d3d] focus:outline-none"
            />
          </label>

          {filtered.length === 0 && (
            <p className="font-mono text-[10px] tracking-[0.16em] text-[#3d3d3d]">
              NO SECTION MATCHES
            </p>
          )}

          <ul className="flex flex-col gap-6">
            {filtered.map((part) => (
              <PartNavGroup
                key={part.id}
                part={part}
                active={active}
                expanded={filter.trim().length > 0 || part.id === activePart.id}
              />
            ))}
          </ul>
        </nav>

        {/* ── Centre: the document ────────────────────────────────────── */}
        <div className="min-w-0" ref={article}>
          {children}
        </div>

        {/* ── Right: on this page ─────────────────────────────────────── */}
        <aside
          aria-label="On this page"
          data-lenis-prevent
          className="sticky top-14 hidden h-max max-h-[calc(100vh-7rem)] flex-col overflow-y-auto py-14 [scrollbar-width:none] 2xl:flex [&::-webkit-scrollbar]:hidden"
        >
          <p className="mb-4 font-mono text-[10px] tracking-[0.24em] text-[#3d3d3d]">
            ON THIS PAGE
          </p>
          <p className="mb-4 font-cinzel text-xs font-bold tracking-[0.1em] text-[#8a8a8a]">
            {activePart.numeral}. {activePart.title.toUpperCase()}
          </p>
          <ul className="flex flex-col">
            {activePart.sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={active === s.id ? "true" : undefined}
                  className={`block border-l-2 py-1.5 pl-3 text-xs leading-snug transition-colors ${
                    active === s.id
                      ? "border-l-[#ccff00] text-[#ededea]"
                      : "border-l-[#2a2a2a] text-[#8a8a8a] hover:text-[#ededea]"
                  }`}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

function PartNavGroup({
  part,
  active,
  expanded,
}: {
  part: DocPart;
  active: string;
  expanded: boolean;
}) {
  const isActivePart = part.id === active || part.sections.some((s) => s.id === active);

  return (
    <li>
      <a
        href={`#${part.id}`}
        className={`flex items-baseline gap-2.5 transition-colors ${
          isActivePart ? "text-[#ededea]" : "text-[#8a8a8a] hover:text-[#ededea]"
        }`}
      >
        <span
          className={`font-mono text-[10px] ${
            isActivePart ? "text-[#ccff00]" : "text-[#3d3d3d]"
          }`}
        >
          {part.numeral}
        </span>
        <span className="font-cinzel text-[13px] font-bold leading-snug tracking-[0.06em]">
          {part.title}
        </span>
      </a>

      {expanded && (
        <ul className="mt-2 flex flex-col border-l border-[#2a2a2a] pl-0">
          {part.sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
                className={`-ml-px block border-l py-1 pl-3.5 text-xs leading-snug transition-colors ${
                  active === s.id
                    ? "border-l-[#ccff00] text-[#ededea]"
                    : "border-l-transparent text-[#8a8a8a] hover:text-[#ededea]"
                }`}
              >
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
