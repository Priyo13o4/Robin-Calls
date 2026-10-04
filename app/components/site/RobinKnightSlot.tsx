"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { openingLineFor } from "@/lib/agent/opening-line";
import type { Verdict } from "@/lib/types";
import { announceRobinKnightSlot, onRobinKnightOpenChange, openRobinKnight } from "../agent/RobinKnightDock";
import { RobinKnightPreview } from "./RobinKnightPreview";

/**
 * The verdict column's Robin Knight slot.
 *
 * **Mobile — unchanged toggle.** `RobinKnightPreview`'s teaser (with its own
 * "THE ROBIN KNIGHT" header and suggested-question button) while the sheet is
 * closed; nothing here while it covers the screen.
 *
 * **Desktop — consistently mounted, not toggled.** The panel auto-opens the
 * moment this slot is announced (`RobinKnightDock`'s `inline` effect) and
 * there is no button that opens it, because there is nothing left to open —
 * it is just there, the way the score is just there. What survives from the
 * teaser is a slim, HEADER-LESS strip: the verdict-specific line and its
 * suggested question, with no "THE ROBIN KNIGHT" of its own, because the panel
 * immediately below already carries that header — repeating it here is
 * exactly the two-headers problem this redesign exists to avoid.
 *
 * The strip is `flex-none` and the portal target is `flex-1` inside an
 * `h-full` column (the same pattern `VerdictShare` already relied on to match
 * this column's height to the flags column beside it) — so the panel is not
 * given an arbitrary height of its own, it fills whatever height the grid row
 * already decided from the flags column's content.
 */
export function RobinKnightSlot({ verdict }: { verdict: Verdict }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const line = useMemo(() => openingLineFor(verdict), [verdict]);

  useEffect(() => onRobinKnightOpenChange(setOpen), []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Re-announced whenever `wide` flips, not just on mount: the mobile and
  // desktop branches below render two DIFFERENT DOM nodes onto the same
  // `ref`, so crossing the breakpoint swaps which node `ref.current` is —
  // and `RobinKnightDock` needs to hear about that swap, not just the first
  // node it ever saw.
  useEffect(() => {
    announceRobinKnightSlot(ref.current);
    return () => announceRobinKnightSlot(null);
  }, [wide]);

  if (!wide) {
    // No height reservation here, at any `open` state: below `xl`, `inline` in
    // `RobinKnightDock` (`wide && slot !== null`) is never true, so nothing is
    // EVER portaled into this ref — the actual chat is `RobinKnightDock`'s own
    // fixed bottom sheet, entirely separate from this column. Reserving height
    // for a portal that can't land here left a blank ~680px gap in the page
    // every time the sheet opened on a phone or tablet.
    return <div ref={ref} className="w-full">{!open && <RobinKnightPreview verdict={verdict} />}</div>;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3">
      <div className="flex-none border-l-2 border-[#ccff00] bg-[#1a1a1a] px-4 py-3">
        <p className="text-[13px] leading-relaxed text-[#dadada]">{line.text}</p>
        <p className="mt-2 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-[#6a6a6a]">
          DRAWN FROM THIS VERDICT&rsquo;S CHECKS — NOT A MODEL ANSWER
        </p>
        <button
          type="button"
          onClick={() => openRobinKnight(line.prompt)}
          className="mt-3 w-full border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-2 text-left text-[12px] leading-relaxed text-[#dadada] transition-colors hover:border-[#ccff00] hover:text-[#ededea]"
        >
          {line.prompt}
        </button>
      </div>
      {/*
        Only claims flex space while something is actually going to fill it —
        the panel auto-opens almost immediately, but if a reader manually
        collapses it (the header's own close control still works), an empty
        `flex-1` box would leave a tall blank gap under the strip above.
      */}
      <div ref={ref} className={open ? "min-h-0 flex-1" : ""} />
    </div>
  );
}
