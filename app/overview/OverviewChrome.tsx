"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSmoothScroll } from "../components/site/lenis";
import {
  activeAnchorFor,
  partFillFor,
  type OverviewNavPart,
} from "./outline";

/** Breathing room between the pinned chrome and the heading it reveals. */
const SCROLL_GAP_PX = 28;

const THEME_KEY = "overview-theme";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Combined height of whatever chrome is pinned to the top (app bar + doc bar).
 * Measured per call; hidden or static bars contribute nothing. Same contract as
 * the methodology chrome — see its commentary for the measurement traps.
 */
function stickyTopOffset(): number {
  let total = 0;
  for (const selector of ["[data-app-bar]", "[data-doc-bar]"]) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const style = getComputedStyle(el);
    if (style.display === "none") continue;
    if (style.position !== "sticky" && style.position !== "fixed") continue;
    const pinned = el.querySelector("[data-bar-height]") ?? el;
    total += pinned.getBoundingClientRect().height;
  }
  return total;
}

/**
 * Documentation chrome for /overview: the part rail on the left (desktop), the
 * sticky contents bar with a segmented part fill (mobile), the back-to-top
 * button, and this page's light/dark toggle.
 *
 * Same shape as the methodology's chrome — one smooth-scroll document pattern
 * per site — with the filter and the right-hand "on this page" rail left off,
 * matching the Fusionlayer reference: one sidebar, one column.
 *
 * ## The theme is page-scoped on purpose
 *
 * The site is noir everywhere; this document is the one route with a paper
 * edition. `dark` is the default and the toggle persists per browser, but it
 * flips `data-theme` on THIS wrapper only — never on `<html>` — so the app
 * rail, footer and every other route stay noir regardless.
 *
 * The only client component on the page, so the document body stays
 * server-rendered.
 */
export function OverviewChrome({
  parts,
  children,
}: {
  parts: OverviewNavPart[];
  children: React.ReactNode;
}) {
  const anchors = useMemo(
    () => parts.flatMap((p) => [p.id, ...p.sections.map((s) => s.id)]),
    [parts]
  );
  const [active, setActive] = useState<string>(anchors[0]);
  const [fills, setFills] = useState<number[]>(() => parts.map(() => 0));
  const [menuOpen, setMenuOpen] = useState(false);
  const [appBarHeight, setAppBarHeight] = useState(0);
  const [showTop, setShowTop] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const frame = useRef<number | null>(null);
  const article = useRef<HTMLDivElement | null>(null);
  const lenis = useSmoothScroll();

  // Restore the reader's persisted choice after mount (SSR renders dark; a
  // light reader sees one dark frame, which is the site default anyway).
  useEffect(() => {
    try {
      if (localStorage.getItem(THEME_KEY) === "light") setTheme("light");
    } catch {
      // Storage can be denied (private mode); dark default stands.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Persisting is best-effort; the toggle still works this visit.
      }
      return next;
    });
  }, []);

  const measure = useCallback(() => {
    frame.current = null;
    const tops = anchors.map((id) => {
      const el = document.getElementById(id);
      return el ? el.getBoundingClientRect().top : null;
    });
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    setActive(activeAnchorFor(anchors, tops, scrollable > 0 && window.scrollY >= scrollable - 2));
    const partTops = parts.map((p) => {
      const el = document.getElementById(p.id);
      return el ? el.getBoundingClientRect().top : null;
    });
    const end = article.current?.getBoundingClientRect().bottom ?? window.innerHeight;
    setFills(partFillFor(partTops, end));
    setShowTop(window.scrollY > 300);
  }, [anchors, parts]);

  useEffect(() => {
    const onScroll = () => {
      if (frame.current === null) frame.current = requestAnimationFrame(measure);
    };
    frame.current = requestAnimationFrame(measure);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [measure]);

  useEffect(() => {
    const bar = document.querySelector("[data-app-bar]");
    if (!bar) return;
    const observer = new ResizeObserver(() =>
      setAppBarHeight(bar.getBoundingClientRect().height)
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const jumpTo = useCallback(
    (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;
      const offset = stickyTopOffset() + SCROLL_GAP_PX;
      if (lenis.current) {
        lenis.current.scrollTo(target, { offset: -offset });
      } else {
        const top = target.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: prefersReducedMotion() ? "auto" : "smooth" });
      }
      window.history.replaceState(null, "", `#${id}`);
      target.classList.remove("rc-doc-target");
      void target.offsetWidth;
      target.classList.add("rc-doc-target");
      target.addEventListener(
        "animationend",
        () => target.classList.remove("rc-doc-target"),
        { once: true }
      );
    },
    [lenis]
  );

  const onAnchorClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as HTMLElement).closest?.("a");
      const href = link?.getAttribute("href");
      if (!href || !href.startsWith("#")) return;
      e.preventDefault();
      jumpTo(href.slice(1));
    },
    [jumpTo]
  );

  // A deep link lands via the browser's own jump, which knows only the static
  // scroll-mt; redo it once on mount with the measured offset.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const timer = window.setTimeout(() => jumpTo(id), 0);
    return () => window.clearTimeout(timer);
  }, [jumpTo]);

  const activePart = useMemo(
    () => parts.find((p) => p.id === active || p.sections.some((s) => s.id === active)) ?? parts[0],
    [active, parts]
  );

  const themeToggle = (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light reading mode" : "Switch to dark reading mode"}
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      className="flex h-7 w-7 flex-none items-center justify-center border border-[var(--ov-border)] text-[var(--ov-muted)] transition-colors hover:border-[var(--ov-faint)] hover:text-[var(--ov-fg)]"
    >
      {theme === "dark" ? (
        // Sun — what clicking offers (light mode).
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M8 1.2v1.8M8 13v1.8M1.2 8H3M13 8h1.8M3.2 3.2l1.3 1.3M11.5 11.5l1.3 1.3M12.8 3.2l-1.3 1.3M4.5 11.5l-1.3 1.3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ) : (
        // Moon — what clicking offers (dark mode).
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M13.4 9.7A5.8 5.8 0 0 1 6.3 2.6a5.8 5.8 0 1 0 7.1 7.1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );

  return (
    <div className="ov-page min-w-0" data-theme={theme} onClick={onAnchorClick}>
      <div className="mx-auto w-full max-w-[1500px] px-4 sm:px-6">
        {/* ── Narrow screens: sticky contents bar with segmented part fill ── */}
        <div
          className="sticky top-[86px] z-30 -mx-4 border-b border-[var(--ov-border)] bg-[var(--ov-bar-bg)] backdrop-blur-md sm:-mx-6 lg:top-0 xl:hidden"
          style={appBarHeight > 0 ? { top: appBarHeight } : undefined}
          data-doc-bar
        >
          <div data-bar-height className="relative flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="min-w-0 truncate font-cinzel text-xs font-bold tracking-[0.1em] text-[var(--ov-fg)]">
              <span className="mr-2 font-mono text-[10px] font-normal text-[var(--ov-muted)]">{activePart?.numeral}</span>
              {activePart?.title.toUpperCase()}
            </p>
            <div className="flex flex-none items-center gap-2">
              {themeToggle}
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-controls="overview-contents-panel"
                className="flex items-center gap-2 border border-[var(--ov-border)] px-2.5 py-1.5 font-mono text-[10px] tracking-[0.16em] text-[var(--ov-muted)] transition-colors hover:border-[var(--ov-faint)] hover:text-[var(--ov-fg)]"
              >
                CONTENTS
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className={`transition-transform duration-200 motion-reduce:transition-none ${menuOpen ? "rotate-180" : ""}`}
                >
                  <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>

            {/* One segment per part; fills as the reader passes through them. */}
            <div className="absolute inset-x-0 bottom-0 flex h-[3px] gap-[2px]" role="presentation">
              {parts.map((part, i) => (
                <div key={part.id} className="flex-1 bg-[var(--ov-border)]">
                  <div
                    className="h-full bg-[var(--ov-accent)] transition-[width] duration-150 ease-out motion-reduce:transition-none"
                    style={{ width: `${(fills[i] ?? 0) * 100}%` }}
                  />
                </div>
              ))}
            </div>
          </div>

          {menuOpen && (
            <div
              id="overview-contents-panel"
              data-lenis-prevent
              className="absolute inset-x-0 top-full z-40 max-h-[60vh] overflow-y-auto overscroll-contain border-b border-t border-[var(--ov-border)] bg-[var(--ov-bg)] px-4 py-4 shadow-[0_16px_32px_rgba(0,0,0,0.35)] sm:px-6"
            >
              <ol className="flex flex-col gap-5">
                {parts.map((part) => (
                  <li key={part.id}>
                    <a href={`#${part.id}`} onClick={() => setMenuOpen(false)} className="flex items-baseline gap-2.5">
                      <span
                        className={`font-mono text-[10px] ${
                          part.id === activePart?.id ? "text-[var(--ov-accent-text)]" : "text-[var(--ov-faint)]"
                        }`}
                      >
                        {part.numeral}
                      </span>
                      <span className="font-cinzel text-[13px] font-bold leading-snug tracking-[0.06em] text-[var(--ov-fg)]">
                        {part.title}
                      </span>
                    </a>
                    <ul className="mt-1.5 flex flex-col border-l border-[var(--ov-border)] pl-0">
                      {part.sections.map((s) => (
                        <li key={s.id}>
                          <a
                            href={`#${s.id}`}
                            onClick={() => setMenuOpen(false)}
                            aria-current={active === s.id ? "true" : undefined}
                            className={`-ml-px block border-l py-1 pl-3.5 text-xs leading-snug ${
                              active === s.id
                                ? "border-l-[var(--ov-accent)] text-[var(--ov-fg)]"
                                : "border-l-transparent text-[var(--ov-muted)]"
                            }`}
                          >
                            {s.number !== null ? `${s.number}. ` : ""}
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

        <div className="grid gap-x-10 xl:grid-cols-[236px_minmax(0,1fr)]">
          {/* ── Left: part rail (desktop) ───────────────────────────────── */}
          <nav
            aria-label="Document contents"
            data-lenis-prevent
            className="sticky top-14 hidden h-max max-h-[calc(100vh-7rem)] flex-col overflow-y-auto py-14 pr-2 [scrollbar-width:none] xl:flex [&::-webkit-scrollbar]:hidden"
          >
            <div className="mb-6 flex items-center justify-between">
              <p className="font-mono text-[10px] tracking-[0.24em] text-[var(--ov-faint)]">CONTENTS</p>
              {themeToggle}
            </div>
            <ul className="flex flex-col gap-6">
              {parts.map((part) => {
                const isActivePart = part.id === active || part.sections.some((s) => s.id === active);
                return (
                  <li key={part.id}>
                    <a
                      href={`#${part.id}`}
                      className={`flex items-baseline gap-2.5 transition-colors ${
                        isActivePart ? "text-[var(--ov-fg)]" : "text-[var(--ov-muted)] hover:text-[var(--ov-fg)]"
                      }`}
                    >
                      <span className={`font-mono text-[10px] ${isActivePart ? "text-[var(--ov-accent-text)]" : "text-[var(--ov-faint)]"}`}>
                        {part.numeral}
                      </span>
                      <span className="font-cinzel text-[13px] font-bold leading-snug tracking-[0.06em]">
                        {part.title}
                      </span>
                    </a>
                    <ul className="mt-2 flex flex-col border-l border-[var(--ov-border)] pl-0">
                      {part.sections.map((s) => (
                        <li key={s.id}>
                          <a
                            href={`#${s.id}`}
                            aria-current={active === s.id ? "true" : undefined}
                            className={`-ml-px block border-l py-1 pl-3.5 text-xs leading-snug transition-colors ${
                              active === s.id
                                ? "border-l-[var(--ov-accent)] text-[var(--ov-fg)]"
                                : "border-l-transparent text-[var(--ov-muted)] hover:text-[var(--ov-fg)]"
                            }`}
                          >
                            {s.number !== null ? `${s.number}. ` : ""}
                            {s.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* ── Centre: the document ────────────────────────────────────── */}
          <div className="min-w-0" ref={article}>
            {children}
          </div>
        </div>
      </div>

      {/* ── Back to top ─────────────────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Back to top"
        onClick={() => {
          if (lenis.current) lenis.current.scrollTo(0);
          else window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
        }}
        className={`fixed bottom-8 right-8 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ov-fg)] text-[var(--ov-bg)] shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition-all duration-300 ${
          showTop ? "opacity-100" : "pointer-events-none opacity-0"
        } motion-safe:hover:bg-[var(--ov-accent)] motion-safe:hover:text-[#141414]`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}
