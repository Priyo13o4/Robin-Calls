/**
 * The methodology document's outline.
 *
 * This is the ONE list. The left part-nav, the "on this page" rail, the mobile
 * contents disclosure, and the rendered `<h3>` anchors all read from it — so a
 * section cannot exist in the navigation but not in the prose, or the other way
 * round. Maintaining the tree twice is how a table of contents starts lying.
 *
 * `tests/methodology-outline.test.ts` pins the other half of that: every id here
 * must actually appear as an anchor in `page.tsx`. An outline nobody renders is
 * the same class of defect as a loader nobody calls (CLAUDE.md §8 #10) — the
 * navigation would look complete and scroll to nothing.
 *
 * Prose lives in `page.tsx`; every NUMBER and every mechanism description is
 * read live from `lib/config/formula.ts` at render. Nothing about the formula is
 * transcribed here — a whitepaper that restates its own source drifts from it.
 */

export interface DocSection {
  /** DOM id of the `<h3>`. Stable — these are shareable deep links. */
  id: string;
  title: string;
}

export interface DocPart {
  /** DOM id of the `<h2>`. */
  id: string;
  /** Roman numeral, rendered as the part marker. */
  numeral: string;
  title: string;
  /** One line under the part title in the nav and at the top of the part. */
  summary: string;
  sections: DocSection[];
}

export const DOC_PARTS: DocPart[] = [
  {
    id: "scope",
    numeral: "I",
    title: "Scope",
    summary: "What a verdict asserts, and what it deliberately does not.",
    sections: [
      { id: "scope-document", title: "What this document is" },
      { id: "scope-claims", title: "What a verdict claims" },
      { id: "scope-limits", title: "What a verdict does not claim" },
      { id: "scope-sources", title: "Where the evidence comes from" },
    ],
  },
  {
    id: "model",
    numeral: "II",
    title: "The scoring model",
    summary: "One hundred points, spent down by weighted evidence.",
    sections: [
      { id: "model-deduction", title: "Deduction, not accumulation" },
      { id: "model-bands", title: "The bands" },
      { id: "model-weights", title: "The weighted checks" },
      { id: "model-example", title: "A worked example" },
    ],
  },
  {
    id: "overrides",
    numeral: "III",
    title: "Overrides and caps",
    summary: "Findings that bypass the arithmetic entirely.",
    sections: [
      { id: "overrides-critical", title: "Critical overrides" },
      { id: "overrides-caps", title: "Post-score caps" },
      { id: "overrides-order", title: "Order of operations" },
    ],
  },
  {
    id: "memory",
    numeral: "IV",
    title: "Persistent memory",
    summary: "Scanners read the chain. This one remembers it.",
    sections: [
      { id: "memory-record", title: "The Record — permanent marks" },
      { id: "memory-web", title: "The Web — stained funds" },
      { id: "memory-watch", title: "The Watch — slow rugs" },
    ],
  },
  {
    id: "audit",
    numeral: "V",
    title: "The contract authority audit",
    summary: "Most rugs do not need a bug. They need a button.",
    sections: [
      { id: "audit-inputs", title: "What we read" },
      { id: "audit-powers", title: "The powers we look for" },
      { id: "audit-authority", title: "Who can still reach it" },
      { id: "audit-limits", title: "What we will not pretend to know" },
      { id: "audit-score", title: "How it touches the score" },
    ],
  },
  {
    id: "uncertainty",
    numeral: "VI",
    title: "Uncertainty",
    summary: "The failure mode this engine is built against.",
    sections: [
      { id: "uncertainty-doctrine", title: "Unknown is not a negative" },
      { id: "uncertainty-completeness", title: "Complete and partial scans" },
      { id: "uncertainty-coverage", title: "Coverage before conclusion" },
    ],
  },
  {
    id: "record",
    numeral: "VII",
    title: "The record",
    summary: "Why a past verdict cannot be quietly rewritten.",
    sections: [
      { id: "record-determinism", title: "Deterministic re-derivation" },
      { id: "record-chain", title: "The hash chain" },
      { id: "record-fingerprint", title: "Result fingerprint and receipt reuse" },
      { id: "record-verify", title: "Verifying it yourself" },
    ],
  },
  {
    id: "swap",
    numeral: "VIII",
    title: "Swap",
    summary: "How a trade is routed, tested, and offered.",
    sections: [
      { id: "swap-protections", title: "What the swap adds to a plain DEX trade" },
      { id: "swap-routing", title: "How a route is found" },
      { id: "swap-simulation", title: "How a trade is tested before it is offered" },
      { id: "swap-signing", title: "What you sign" },
      { id: "swap-caveats", title: "What it does not promise" },
    ],
  },
  {
    id: "history",
    numeral: "IX",
    title: "Revision history",
    summary: "Every change to the formula, dated.",
    sections: [{ id: "history-changelog", title: "Formula changelog" }],
  },
];

/** Flat list of every anchor in reading order — what the scroll-spy observes. */
export const DOC_ANCHORS: string[] = DOC_PARTS.flatMap((p) => [
  p.id,
  ...p.sections.map((s) => s.id),
]);

/** Distance below the viewport top at which a heading counts as "current". */
export const ACTIVE_OFFSET_PX = 140;

/**
 * Which anchor is the reader currently in?
 *
 * Pure, and separated from the component on purpose. The only way to exercise
 * this in a browser is to scroll a visible tab and watch a `requestAnimationFrame`
 * callback land — which a headless or backgrounded pane cannot do, because rAF
 * does not fire when `document.visibilityState` is `hidden`. Left inside the
 * scroll handler this would be logic that ships unverified; out here the
 * arithmetic is checked in `tests/methodology-outline.test.ts` and what remains
 * in the component is three lines of listener wiring.
 *
 * @param tops viewport-relative `top` of each anchor, in `DOC_ANCHORS` order.
 *   `null` for an anchor not present in the DOM.
 * @param atBottom the page is scrolled as far as it goes.
 */
export function activeAnchorFor(
  tops: readonly (number | null)[],
  atBottom: boolean
): string {
  // At the very bottom the last few headings can all still sit below the line —
  // there is nothing left to scroll to, so the final anchor is the honest
  // answer. Without this the highlight sticks a section or two short of the end.
  if (atBottom) return DOC_ANCHORS[DOC_ANCHORS.length - 1];

  let current = DOC_ANCHORS[0];
  for (let i = 0; i < DOC_ANCHORS.length; i++) {
    const top = tops[i];
    if (top === null || top === undefined) continue;
    if (top <= ACTIVE_OFFSET_PX) current = DOC_ANCHORS[i];
    // Anchors are in document order, so the first one below the line ends it.
    else break;
  }
  return current;
}

/**
 * How far the reader is through each part, 0–1 — one number per `DOC_PARTS`
 * entry. Drives the segmented fill bar on narrow screens.
 *
 * Deliberately a *fraction* rather than the reference implementation's on/off
 * segment: a binary bar tells you which part you are in, which the label beside
 * it already says. The fraction tells you how much of it is left, which is the
 * thing a reader actually wants from a bar on an eight-part document and is why
 * it can replace both the label and a scroll position.
 *
 * One formula covers all three cases with no branching. A part entirely above
 * the reading line yields a ratio above 1 and clamps to full; one entirely below
 * yields a negative and clamps to empty; the part being read lands in between.
 *
 * @param partTops viewport-relative top of each part heading, in `DOC_PARTS` order.
 * @param docEndTop viewport-relative bottom of the document — the closing
 *   boundary for the last part, which has no successor heading to measure to.
 */
export function partFillFor(
  partTops: readonly (number | null)[],
  docEndTop: number
): number[] {
  return DOC_PARTS.map((_, i) => {
    const start = partTops[i];
    if (start === null || start === undefined) return 0;
    const nextRaw = partTops[i + 1];
    const end = nextRaw === null || nextRaw === undefined ? docEndTop : nextRaw;
    const span = end - start;
    // A zero or inverted span means the layout has not settled (or two headings
    // collapsed). Treat it as passed if the line is already beyond the start,
    // rather than dividing and producing Infinity.
    if (span <= 0) return start <= ACTIVE_OFFSET_PX ? 1 : 0;
    return Math.min(1, Math.max(0, (ACTIVE_OFFSET_PX - start) / span));
  });
}
