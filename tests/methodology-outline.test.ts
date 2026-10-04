import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_OFFSET_PX,
  DOC_ANCHORS,
  DOC_PARTS,
  activeAnchorFor,
  partFillFor,
} from "../app/methodology/outline";

/**
 * The methodology page navigates itself from `outline.ts`: the left part rail,
 * the "on this page" rail and the mobile contents list are all built from that
 * one array, and the prose renders its headings through `Part`/`Section`, which
 * look their titles up in it.
 *
 * That coupling is only real in one direction. `Part`/`Section` throw on an id
 * the outline does not know, so prose cannot invent a section — but nothing
 * stops the outline from listing a section the prose never renders. The result
 * would be a table of contents with a live link that scrolls nowhere, and it
 * would typecheck, lint and render without complaint.
 *
 * This is the same shape as CLAUDE.md §8 #10 — a loader with no callers, where
 * every layer read as correct. So assert the WIRING: every id in the outline has
 * to appear in the page as an anchor. Reading the source is crude, and
 * deliberately so; the alternative is rendering the tree, which would need a
 * React renderer this suite does not have and would not catch any more than
 * this does.
 */

const PAGE_SOURCE = readFileSync(
  join(import.meta.dirname, "..", "app", "methodology", "page.tsx"),
  "utf8"
);

test("methodology: every outline part is rendered by the page", () => {
  for (const part of DOC_PARTS) {
    assert.ok(
      PAGE_SOURCE.includes(`<Part id="${part.id}"`),
      `outline lists part "${part.id}" but page.tsx never renders it — the nav would link to nothing`
    );
  }
});

test("methodology: every outline section is rendered by the page", () => {
  for (const part of DOC_PARTS) {
    for (const section of part.sections) {
      assert.ok(
        PAGE_SOURCE.includes(`<Section id="${section.id}"`),
        `outline lists section "${section.id}" but page.tsx never renders it — the nav would link to nothing`
      );
    }
  }
});

test("methodology: anchors are unique and ordered as the document reads", () => {
  assert.equal(
    new Set(DOC_ANCHORS).size,
    DOC_ANCHORS.length,
    "duplicate anchor id — deep links and the scroll-spy would both resolve to the wrong section"
  );

  // The scroll-spy walks DOC_ANCHORS in order and takes the last heading above
  // the fold, so the flat list has to match the rendered order. Verify against
  // where each anchor actually appears in the source.
  const positions = DOC_ANCHORS.map((id) => {
    const partAt = PAGE_SOURCE.indexOf(`<Part id="${id}"`);
    const at = partAt === -1 ? PAGE_SOURCE.indexOf(`<Section id="${id}"`) : partAt;
    assert.notEqual(at, -1, `anchor "${id}" is not rendered at all`);
    return at;
  });

  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i] > positions[i - 1],
      `"${DOC_ANCHORS[i]}" is rendered before "${DOC_ANCHORS[i - 1]}" but listed after it — ` +
        "the active-section highlight would jump backwards while scrolling"
    );
  }
});

/**
 * The scroll-spy's arithmetic.
 *
 * Tested here rather than in the browser because `requestAnimationFrame` — which
 * coalesces the scroll handler — does not fire while a tab is backgrounded, so
 * an automated pane can scroll the document and observe nothing change. That is
 * an environment limit, not a defect, but it means the logic would otherwise
 * ship on inspection alone.
 *
 * `tops` are viewport-relative heading positions in DOC_ANCHORS order: negative
 * once scrolled past, positive while still below the fold.
 */
const ABOVE = ACTIVE_OFFSET_PX - 1;
const BELOW = ACTIVE_OFFSET_PX + 1;

/** n anchors passed, the rest still below the line. */
function tops(passed: number): (number | null)[] {
  return DOC_ANCHORS.map((_, i) => (i < passed ? ABOVE - (passed - i) * 100 : BELOW + i * 100));
}

test("scroll-spy: at the top of the document the first anchor is active", () => {
  assert.equal(activeAnchorFor(tops(1), false), DOC_ANCHORS[0]);
});

test("scroll-spy: the last heading passed is the active one", () => {
  assert.equal(activeAnchorFor(tops(5), false), DOC_ANCHORS[4]);
  assert.equal(activeAnchorFor(tops(12), false), DOC_ANCHORS[11]);
});

test("scroll-spy: a heading exactly on the line counts as passed", () => {
  const t: (number | null)[] = DOC_ANCHORS.map((_, i) => (i === 0 ? ACTIVE_OFFSET_PX : BELOW));
  assert.equal(activeAnchorFor(t, false), DOC_ANCHORS[0]);
});

test("scroll-spy: an anchor missing from the DOM is skipped, not treated as passed", () => {
  // A null must not end the walk either — the anchors after it are still real.
  const t = tops(6);
  t[3] = null;
  assert.equal(activeAnchorFor(t, false), DOC_ANCHORS[5]);
});

test("scroll-spy: at the bottom the LAST anchor wins even if it sits below the line", () => {
  // The tail of a document is shorter than a viewport, so its final headings
  // never cross the line. Without this the highlight stops short of the end and
  // the reader is told they are somewhere they have already scrolled past.
  const t: (number | null)[] = DOC_ANCHORS.map((_, i) =>
    i < DOC_ANCHORS.length - 3 ? -1000 : BELOW
  );
  assert.equal(
    activeAnchorFor(t, true),
    DOC_ANCHORS[DOC_ANCHORS.length - 1],
    "the last section must be reachable by scrolling to the bottom"
  );
});

test("scroll-spy: every anchor is reachable as an active section", () => {
  // If some anchor can never be returned, its entry in the rail is decoration.
  const reachable = new Set<string>();
  for (let i = 1; i <= DOC_ANCHORS.length; i++) {
    reachable.add(activeAnchorFor(tops(i), false));
  }
  reachable.add(activeAnchorFor(tops(DOC_ANCHORS.length), true));
  assert.equal(reachable.size, DOC_ANCHORS.length);
});

/**
 * The segmented fill bar shown below `xl`.
 *
 * Same reason as the scroll-spy: it is driven from a `requestAnimationFrame`
 * callback and so cannot be observed in a backgrounded automated browser.
 *
 * `partTops` are viewport-relative part-heading positions; `docEndTop` closes
 * the last part, which has no following heading to measure against.
 */
const PART_COUNT = DOC_PARTS.length;

/** Every part 400px tall, with `passed` of them fully above the reading line. */
function partLayout(passed: number): number[] {
  return DOC_PARTS.map((_, i) => ACTIVE_OFFSET_PX - passed * 400 + i * 400);
}

test("fill: nothing read yet — the first part is empty and so is everything after", () => {
  const fills = partFillFor(partLayout(0), 99999);
  assert.equal(fills.length, PART_COUNT);
  assert.deepEqual(fills, DOC_PARTS.map(() => 0));
});

test("fill: parts already read are full, later parts empty, current one fractional", () => {
  // Three parts fully behind, then 200px into a 400px part four.
  const tops = partLayout(3).map((t) => t - 200);
  const fills = partFillFor(tops, 99999);
  assert.deepEqual(fills.slice(0, 3), [1, 1, 1], "read parts must be full");
  assert.equal(fills[3], 0.5, "the part being read must be half full");
  assert.deepEqual(fills.slice(4), DOC_PARTS.slice(4).map(() => 0), "unread parts stay empty");
});

test("fill: the last part is closed by the document end, not left unfillable", () => {
  // Every part behind us; the final one spans from its heading to the doc end.
  const tops = DOC_PARTS.map((_, i) => -10000 + i * 400);
  const half = partFillFor(tops, tops[PART_COUNT - 1] + 2 * (ACTIVE_OFFSET_PX - tops[PART_COUNT - 1]));
  assert.equal(half[PART_COUNT - 1], 0.5, "docEndTop must act as the closing boundary");

  const done = partFillFor(tops, ACTIVE_OFFSET_PX - 1);
  assert.equal(done[PART_COUNT - 1], 1, "reaching the end must fill the last segment");
});

test("fill: every value stays within 0..1", () => {
  for (const passed of [-2, 0, 1, 4, PART_COUNT, PART_COUNT + 5]) {
    for (const v of partFillFor(partLayout(passed), 99999)) {
      assert.ok(v >= 0 && v <= 1, `fill ${v} escaped 0..1 at passed=${passed}`);
    }
  }
});

test("fill: a collapsed span does not divide by zero", () => {
  // Two headings measured at the same position — a mid-relayout reading.
  const tops = DOC_PARTS.map(() => ACTIVE_OFFSET_PX - 50);
  for (const v of partFillFor(tops, ACTIVE_OFFSET_PX - 50)) {
    assert.ok(Number.isFinite(v), "fill must stay finite when a span collapses");
  }
});

test("fill: an unmeasurable heading yields empty, not NaN", () => {
  const tops: (number | null)[] = partLayout(2);
  tops[1] = null;
  for (const v of partFillFor(tops, 99999)) {
    assert.ok(Number.isFinite(v), "a null heading must not poison the row");
  }
});
