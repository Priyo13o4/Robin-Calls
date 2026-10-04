"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { scrollToElement } from "../lenis";

type Stage = "static" | "armed" | "open";

interface RevealApi {
  stage: Stage;
  open: () => void;
  /** The grid's whole section. Approaching it opens the grid; clicking scrolls here. */
  sectionRef: RefObject<HTMLElement | null>;
  cardsRef: RefObject<HTMLDivElement | null>;
}

const RevealContext = createContext<RevealApi | null>(null);

function useReveal(): RevealApi {
  const api = useContext(RevealContext);
  if (!api) throw new Error("ProductsReveal parts must render inside ProductsRevealProvider");
  return api;
}

/**
 * The scroll reveal shared by the hero and the product grid.
 *
 * The trigger lives at the foot of the hero and the cards it reveals live in
 * the next section, so the state has to span both. A provider rather than a
 * custom event: the stage also drives CSS through one `data-products`
 * attribute, and that needs a single element above both halves.
 *
 * Stages: `static` is the SERVER stage and paints everything, trigger included.
 * The trigger belongs to the hero and arrives with it, so it is only ever
 * hidden by `open`, once it has done its job. On mount the client either stays
 * `static` (no animation) or runs `armed` → `open`, which hide and then stagger
 * in the GRID, never the button.
 *
 * The cards must never start hidden. JS off, reduced motion, no
 * IntersectionObserver, or a deep link landing inside the grid all leave them
 * painted, so the failure direction is "no animation" rather than "no content"
 * — this page shipped a blank hero once by hiding first and revealing in an
 * effect.
 *
 * No rAF: three observers flip one attribute and globals.css runs the motion on
 * the compositor, which a busy main thread cannot stall.
 */
export function ProductsRevealProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>("static");
  const sectionRef = useRef<HTMLElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage>("static");
  stageRef.current = stage;

  const open = useCallback(() => {
    setStage("open");
    // The SECTION, not the cards. Scrolling to the cards puts their top under
    // the nav with the heading already above the fold, which reads as landing
    // halfway into something.
    // 96 matches the section's own `scroll-mt-24`. The two paths must agree:
    // Lenis uses this offset, the no-Lenis fallback uses scroll-margin, and a
    // reader should not get a different landing depending on their pointer.
    if (sectionRef.current) scrollToElement(sectionRef.current, -96);
  }, []);

  useEffect(() => {
    // Every bail-out lands on `static`: the trigger is a real control once JS
    // is running, so a reader who gets no animation still gets the button.
    if (typeof IntersectionObserver === "undefined") return setStage("static");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStage("static");

    const section = sectionRef.current;
    const cards = cardsRef.current;
    if (!section || !cards) return setStage("static");

    // Only hide what the reader cannot already see.
    if (cards.getBoundingClientRect().top < window.innerHeight) return setStage("static");
    setStage("armed");

    /**
     * Fires when the grid's section reaches the MIDDLE of the viewport, which
     * on this layout is the hero half scrolled.
     *
     * Both neighbouring values are wrong and were tried. Anchoring to the
     * hero's last pixel meant nothing moved until the heading was already on
     * screen, so the reader watched an empty band. A small bottom margin fired
     * at scroll 162, retiring the button before the reader had really moved.
     * -50% is the one rule that is also describable: the section has to be
     * half way up before it counts as arrived.
     */
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setStage("open");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -50% 0px" }
    );
    observer.observe(section);

    return () => observer.disconnect();
  }, []);

  const api = useMemo<RevealApi>(
    () => ({ stage, open, sectionRef, cardsRef }),
    [stage, open]
  );

  return (
    <RevealContext.Provider value={api}>
      <div data-products={stage}>{children}</div>
    </RevealContext.Provider>
  );
}

/**
 * The lime box and the scroll hint, seated at the foot of the hero.
 *
 * `absolute` inside the hero's own `relative` box, so it pins to the section's
 * end rather than to the viewport: a `fixed` version would still be on screen
 * three sections later.
 */
export function HeroRevealTrigger({ label }: { label: string }) {
  const { stage, open } = useReveal();

  return (
    <>

      {/* IN FLOW, not absolute. It used to be `absolute bottom-7`, which takes no
          layout space, so the hero reserved 48px of padding for a 104px block:
          measured at 390x664 the sale block ended at y=606 and this started at
          y=561, a 45px overlap straight through the copy. On a tall viewport
          `justify-center` left enough slack below the content to hide it, which
          is why the page looked different on different phones.
          Reserving a fixed pixel budget instead would put a literal where a
          measurement belongs (CLAUDE.md §8 #11) — this block's height is
          content-derived. Occupying real space costs nothing and cannot drift.
          `mt-auto` keeps it pinned to the hero's foot when there IS slack.
          Two elements on purpose: Tailwind v4 centres with the standalone
          `translate` property, and the stage rules animate `transform`. On one
          element the two compose and the box lands half a width off. */}
      <div className="relative z-20 mt-auto flex shrink-0 justify-center pt-5 sm:pt-10">
        <div className="pg-trigger-slot flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={open}
            // A button, not a link: it controls content on this page. The cards
            // are in the DOM the whole time, so a reader on assistive tech or
            // with the animation stood down never depends on this firing.
            aria-expanded={stage === "open"}
            aria-controls="product-cards"
            className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light inline-flex items-center gap-2 whitespace-nowrap border-[#ccff00] bg-[#ccff00] px-6 py-3.5 font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a]"
          >
            {label} →
          </button>

          <span className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.2em] text-[#8a8a8a] [text-shadow:0_1px_6px_#0a0a0a]">
            <svg aria-hidden width="11" height="15" viewBox="0 0 12 16" fill="none" className="pg-hint">
              <path
                d="M6 1v11m0 0L1.8 7.9M6 12l4.2-4.1"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Scroll to explore
          </span>
        </div>
      </div>
    </>
  );
}

/** The grid's own half: the cards the stage staggers in. */
export function ProductsRevealStage({ children }: { children: ReactNode }) {
  const { cardsRef } = useReveal();
  return (
    <div ref={cardsRef} id="product-cards">
      {children}
    </div>
  );
}

/**
 * The `<section>` the reveal watches and scrolls to.
 *
 * A component rather than an exported ref hook: ProductGrid is a SERVER
 * component, and a server component cannot call a client hook at all. Owning
 * the element here keeps the ref on the client where it belongs and leaves the
 * grid's own children server-rendered.
 */
export function ProductsRevealSection({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const { sectionRef } = useReveal();
  return (
    <section ref={sectionRef} className={className}>
      {children}
    </section>
  );
}
