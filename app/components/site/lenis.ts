"use client";

import { useEffect, useRef } from "react";
import Lenis from "lenis";

/**
 * Shared smooth-scroll configuration and lifecycle.
 *
 * The landing page has run Lenis since before this module existed; these are
 * its numbers, lifted out so a second page cannot drift from the first. The
 * whole reason to extend smooth scrolling beyond the landing page is that the
 * two should feel identical — two independently tuned easings would defeat it.
 *
 * ## Lenis captures the wheel for the whole document
 *
 * This is the part that bites. Lenis binds a global wheel listener and
 * translates it into its own scroll animation, so **any element with its own
 * scrollbar stops responding to the wheel** unless it is opted out with
 * `data-lenis-prevent`. That is not a nicety: the site drawer's list is taller
 * than a short viewport, and on the landing page its last items were simply
 * unreachable — the wheel scrolled the page behind it instead.
 *
 * Anything scrollable that can appear over a Lenis page needs the attribute.
 * Today that is `SiteNav`'s drawer, `WhitelistModal`'s body, and the
 * methodology rails and contents panel.
 *
 * Note that a programmatic `element.scrollTop = n` still works regardless — so
 * it cannot be used to check this. Verify with a real wheel over the element.
 */
export const LENIS_OPTIONS = {
  duration: 1.15,
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
} as const;

/**
 * Run Lenis for the lifetime of a page, driven by its own rAF loop.
 *
 * For pages with no GSAP timeline of their own. The landing page deliberately
 * does NOT use this — it drives `lenis.raf` from the GSAP ticker so that
 * ScrollTrigger and Lenis share one clock, and it must not start until the
 * loading screen's timeline has finished with the ticker.
 *
 * Returns a ref to the instance so callers can `scrollTo` through it. Anything
 * that scrolls the page itself must go through Lenis rather than
 * `window.scrollTo`, or the two animate the same scroll position against each
 * other and the result stutters.
 *
 * Returns `null` under `prefers-reduced-motion`: smooth scrolling is the exact
 * thing that setting asks to be spared, and Lenis does not check it itself.
 *
 * Also skipped on a coarse pointer (touch). Lenis's global wheel/touch capture
 * is a main-thread scroll emulation running every frame for the life of the
 * page — a desktop trades that for a nicer wheel feel, but a touch device
 * already has a compositor-driven native scroll, so the trade there is pure
 * cost: worse jank on exactly the hardware least able to absorb it, for a feel
 * nobody asked for (nothing about "smooth scroll" reads as a request for
 * hijacked touch physics). `pointer: coarse` is the touch signal, not viewport
 * width — a touch laptop at a wide breakpoint should get the same pass.
 */
/**
 * The mounted instance, or null when Lenis stood down (reduced motion, touch).
 *
 * Module scope rather than context: Lenis OWNS the scroll position, writing it
 * every frame, so a native `scrollTo` issued while it runs is overwritten on
 * the next tick. Anything that scrolls programmatically has to ask Lenis, and
 * threading a ref through the tree for that is more plumbing than one page's
 * worth of callers justify.
 */
let active: Lenis | null = null;

/** Scroll to an element through whichever scroller is actually in charge. */
export function scrollToElement(el: HTMLElement, offset = -72): void {
  if (active) {
    active.scrollTo(el, { offset });
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function useSmoothScroll() {
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    const lenis = new Lenis(LENIS_OPTIONS);
    lenisRef.current = lenis;
    active = lenis;

    let frame = requestAnimationFrame(function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      lenisRef.current = null;
      active = null;
    };
  }, []);

  return lenisRef;
}
