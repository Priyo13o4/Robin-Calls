"use client";

import { useState } from "react";
import { TOKENOMICS } from "@/lib/sale/tokenomics";
import { AllocationCity } from "./AllocationCity";
import { AllocationTable } from "./AllocationTable";

/**
 * Section 01 — the city and the split, side by side above `lg`, stacked below.
 *
 * Owns the one piece of state the two share: which allocation the reader is
 * pointing at. Held here rather than in either child, so the link works in
 * both directions and there is never a second answer to the same question.
 *
 * SIZING. The city keeps its own aspect ratio (the renderer decides it) and
 * the table column is the one that flexes, because a table that has to match
 * an image's height either scrolls or stretches its rows, and both look
 * broken. `minmax(0, …)` on both tracks is load-bearing, since a grid column
 * defaults to `min-content` and one long row label would push the city out of
 * its own column.
 *
 * The city cell STRETCHES and centres its picture rather than hugging it.
 * Hugging it (`items-start`) left the grid's own divider colour showing as a
 * wide slab under the town wherever the table ran longer, which reads as a
 * hole rather than as space. The render is square for the same reason: the
 * town's footprint is square from that camera, so a wider frame both wastes
 * ground left and right AND ends far short of the table.
 */
export function AllocationSection() {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="grid gap-px border border-[#2a2a2a] bg-[#2a2a2a] lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)]">
      <div className="flex items-center justify-center bg-[#0f0f0f]">
        <AllocationCity active={active} onActive={setActive} />
      </div>
      <div className="bg-[#141414]">
        <AllocationTable
          rows={TOKENOMICS}
          active={active}
          onActive={setActive}
          compact
        />
      </div>
    </div>
  );
}
