import type { OverviewDoc, OverviewPart, OverviewSection } from "@/lib/content/overview";

/**
 * Navigation outline + scroll-spy math for the /overview page.
 *
 * The outline is DERIVED from the parsed document — the same AST the page body
 * renders — so the navigation cannot list a section the prose does not carry,
 * or the other way round. That contract is what `tests/overview-content.test.ts`
 * pins; it is the /overview edition of the methodology's "one list" rule
 * (app/methodology/outline.ts), except here nothing is maintained twice at all.
 *
 * The scroll-spy arithmetic mirrors the methodology's pure functions so the two
 * documents behave identically under scroll; see the commentary there for why
 * this is a scroll handler rather than an IntersectionObserver, and why the
 * bottom-of-document case returns the last anchor.
 */

/** Distance below the viewport top at which a heading counts as "current". */
export const ACTIVE_OFFSET_PX = 140;

export interface OverviewNavSection {
  id: string;
  /** Sequential number, or null for the unnumbered Notice/Appendix sections. */
  number: number | null;
  title: string;
}

export interface OverviewNavPart {
  id: string;
  numeral: string;
  title: string;
  sections: OverviewNavSection[];
}

export function outlineFor(doc: OverviewDoc): OverviewNavPart[] {
  return doc.parts.map((p: OverviewPart) => ({
    id: p.id,
    numeral: p.numeral,
    title: p.title,
    sections: p.sections.map((s: OverviewSection) => ({
      id: s.id,
      number: s.number,
      title: s.title,
    })),
  }));
}

/** Flat anchor list in reading order — what the scroll-spy observes. */
export function anchorsFor(parts: OverviewNavPart[]): string[] {
  return parts.flatMap((p) => [p.id, ...p.sections.map((s) => s.id)]);
}

/**
 * Which anchor is the reader currently in?
 *
 * Pure, and separated from the component on purpose: the only way to exercise
 * it in a browser is to scroll a visible tab and watch a rAF callback land,
 * which headless or backgrounded panes never do. Kept pure so
 * `tests/overview-content.test.ts` can hold the arithmetic.
 *
 * @param tops viewport-relative `top` of each anchor, in `anchors` order.
 * @param atBottom the page is scrolled as far as it goes.
 */
export function activeAnchorFor(
  anchors: readonly string[],
  tops: readonly (number | null)[],
  atBottom: boolean
): string {
  if (anchors.length === 0) throw new Error("activeAnchorFor: no anchors");
  if (atBottom) return anchors[anchors.length - 1];
  let current = anchors[0];
  for (let i = 0; i < anchors.length; i += 1) {
    const top = tops[i];
    if (top === null || top === undefined) continue;
    if (top <= ACTIVE_OFFSET_PX) current = anchors[i];
    else break;
  }
  return current;
}

/**
 * How far the reader is through each part, 0–1 — one number per part. Drives
 * the segmented fill on the mobile bar. A part entirely above the reading line
 * clamps to full; one entirely below clamps to empty; the part being read lands
 * in between. A zero or inverted span means the layout has not settled — treat
 * it as passed if the line is beyond the start rather than dividing into a
 * negative span.
 */
export function partFillFor(
  partTops: readonly (number | null)[],
  docEndTop: number
): number[] {
  return partTops.map((start, i) => {
    if (start === null || start === undefined) return 0;
    const nextRaw = partTops[i + 1];
    const end = nextRaw === null || nextRaw === undefined ? docEndTop : nextRaw;
    const span = end - start;
    if (span <= 0) return start <= ACTIVE_OFFSET_PX ? 1 : 0;
    return Math.min(1, Math.max(0, (ACTIVE_OFFSET_PX - start) / span));
  });
}
