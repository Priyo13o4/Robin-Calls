"use client";

import { useMemo } from "react";

import { openingLineFor } from "@/lib/agent/opening-line";
import type { Verdict } from "@/lib/types";
import { openRobinKnight } from "../agent/RobinKnightDock";

/**
 * The Robin Knight, previewed in the verdict's own column — mobile only.
 *
 * PLAN.md §5.2 replaced a "coming soon" panel here with the thing that is
 * already live one click away. It is a preview, not a second chat: there is one
 * conversation and it lives in the panel — clicking opens the sheet and hands
 * the question over, so nothing said here can diverge from the transcript the
 * reader ends up with.
 *
 * **Desktop no longer uses this component.** The panel there is "consistently
 * mounted" — it auto-opens the moment the verdict's slot is announced and
 * stays open, so there is nothing left to preview or click open;
 * `RobinKnightSlot` renders a slimmer, header-less strip of its own instead
 * (see that file). This one survives for the mobile sheet, which still opens
 * on request rather than covering the score by default — "the verdict is
 * still the product on a phone", the same reasoning `RobinKnightDock` gives
 * for the sheet peaking instead of taking the whole screen.
 *
 * **The opening line is derived, never generated.** §5.2's constraint is that
 * it "must come from the same tool-backed path the rail uses — a hand-written
 * teaser the Robin Knight would not actually say is a fabricated quote from our
 * own product." So it is assembled from `verdict.checks[]`, the same record
 * `get_latest_verdict` hands the model (`lib/agent/opening-line.ts`), and the
 * box says so in as many words rather than dressing it as a spoken answer.
 */
export function RobinKnightPreview({ verdict }: { verdict: Verdict }) {
  const line = useMemo(() => openingLineFor(verdict), [verdict]);

  return (
    <div className="flex flex-1 flex-col border border-[#2a2a2a] bg-[#141414] p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="font-cinzel text-xs font-bold tracking-[0.18em] text-[#ededea]">
          ASK ROBIN KNIGHT
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>

      <div className="border-l-2 border-[#ccff00] bg-[#1a1a1a] px-4 py-3">
        <p className="text-[13px] leading-relaxed text-[#dadada]">{line.text}</p>
      </div>
      <p className="mt-2 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-[#6a6a6a]">
        DRAWN FROM THIS VERDICT&rsquo;S CHECKS — NOT A MODEL ANSWER
      </p>

      <button
        type="button"
        onClick={() => openRobinKnight(line.prompt)}
        className="mt-4 border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-2.5 text-left text-[13px] leading-relaxed text-[#dadada] transition-colors hover:border-[#ccff00] hover:text-[#ededea]"
      >
        {line.prompt}
      </button>

      <p className="mt-4 font-mono text-[10px] leading-relaxed tracking-[0.14em] text-[#6a6a6a]">
        OPENS THE PANEL — THAT IS WHERE YOU TYPE
      </p>
    </div>
  );
}
