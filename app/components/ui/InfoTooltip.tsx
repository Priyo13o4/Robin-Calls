"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";

/**
 * Universal hover/focus tooltip. One "i" trigger, styled like the hero's
 * black-and-white brutalist button (near-black fill, Paper border), revealing a
 * Surface-2 panel of explanatory copy on hover, keyboard focus, or tap.
 *
 * Text is passed in by the caller — on the scan page it comes straight from the
 * methodology config (lib/config/formula.ts) so the tooltip and /methodology
 * can never drift apart. Renders nothing when there is no text.
 */
/** Breathing room kept between the panel and the edge of its clipping box. */
const GUTTER = 8;

export function InfoTooltip({
  text,
  label = "What this checks",
  align = "left",
}: {
  text?: string | null;
  /** Accessible name for the trigger; also the tooltip's eyebrow heading. */
  label?: string;
  /**
   * Which edge of the trigger the panel anchors to. `"auto"` measures on open
   * and opens INWARD — toward the middle of whichever ancestor would clip it.
   *
   * Needed because the panel is a fixed 280px against triggers that can sit in
   * a much narrower cell: in the persona strip it always overhangs its own
   * card, and the chat column is `overflow-x-hidden`, which clips rather than
   * scrolls. A caller cannot pick the side itself when the grid is responsive
   * (2/3/5 columns) — the flat index does not say which column a card is in.
   */
  align?: "left" | "right" | "auto";
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLSpanElement | null>(null);
  /** Auto only: px offset from the trigger's left edge, once measured. */
  const [offset, setOffset] = useState<number | null>(null);
  const tipId = useId();

  /**
   * Auto placement, measured before paint.
   *
   * Anchoring to an edge is not enough on a narrow rail: the panel is wider
   * than half its container there, so BOTH `left-0` and `right-0` overhang
   * (measured on the 375px persona rail: 50px clipped either way). So centre
   * the panel on the trigger and then CLAMP it inside the box that would clip
   * it. On a wide strip that lands it where an edge anchor would; on a narrow
   * one it slides along the container instead of disappearing into it.
   */
  useLayoutEffect(() => {
    if (!open || align !== "auto") return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    // The ancestor that would actually clip us — not the viewport, which is
    // usually wider than the box the panel really has to live inside.
    let box: HTMLElement | null = trigger.parentElement;
    while (box) {
      const cs = getComputedStyle(box);
      if (/hidden|auto|scroll/.test(`${cs.overflowX} ${cs.overflowY}`)) break;
      box = box.parentElement;
    }
    const bounds = box?.getBoundingClientRect();
    const min = (bounds?.left ?? 0) + GUTTER;
    const max = (bounds?.right ?? window.innerWidth) - GUTTER - panel.offsetWidth;

    const t = trigger.getBoundingClientRect();
    const centred = t.left + t.width / 2 - panel.offsetWidth / 2;
    // `max < min` means the container cannot hold the panel at all; pin to the
    // left edge rather than letting the clamp invert and push it off-screen.
    const placed = max < min ? min : Math.min(Math.max(centred, min), max);
    setOffset(placed - t.left);
  }, [open, align]);

  // A stale offset from the previous open would place the panel before the
  // effect above re-measures it.
  useLayoutEffect(() => {
    if (!open) setOffset(null);
  }, [open]);

  if (!text) return null;

  // A small close delay lets the pointer travel from the icon onto the panel
  // (so the copy stays selectable) without it flickering shut.
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 90);
  };

  return (
    <span
      /*
        z-50 only while OPEN, and on the TRIGGER's own box rather than the
        panel's. The panel's z-50 is scoped to whatever stacking context
        encloses it, so in a grid of equally-stacked cells the cards after this
        one paint straight over the panel. Raising the trigger lifts the whole
        subtree above its siblings; dropping it again when closed keeps the
        badge from sitting over a neighbour's tooltip.
      */
      className={`relative inline-flex ${open ? "z-50" : ""}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        aria-expanded={open}
        onFocus={show}
        onBlur={hide}
        onClick={() => setOpen((v) => !v)}
        ref={triggerRef}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[#ededea] bg-[#0a0a0a] font-mono text-[10px] font-bold leading-none text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] focus:outline-none focus-visible:border-[#ccff00] focus-visible:text-[#ccff00] cursor-pointer"
      >
        i
      </button>

      {open && (
        <span
          ref={panelRef}
          id={tipId}
          role="tooltip"
          className={`absolute top-full z-50 mt-2 w-[min(280px,70vw)] border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-2.5 text-left shadow-[4px_4px_0px_0px_#0a0a0a] ${
            align === "auto" ? "left-0" : align === "right" ? "right-0" : "left-0"
          }`}
          // Auto starts at left-0 for one layout pass so it can be measured,
          // then this overrides it. useLayoutEffect, so neither is painted.
          style={align === "auto" && offset !== null ? { left: `${offset}px` } : undefined}
        >
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-[0.18em] text-[#8a8a8a]">
            {label}
          </span>
          <span className="block text-[12px] leading-relaxed text-[#c4c4c4]">
            {text}
          </span>
        </span>
      )}
    </span>
  );
}

export default InfoTooltip;
