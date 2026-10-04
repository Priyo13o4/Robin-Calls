import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseOverviewDocument,
  slugifyHeading,
  type OverviewDoc,
} from "../lib/content/overview";
import {
  ACTIVE_OFFSET_PX,
  activeAnchorFor,
  anchorsFor,
  outlineFor,
  partFillFor,
} from "../app/overview/outline";

/**
 * The /overview page and the branded PDF both render from ONE parsed AST of
 * `content/investor-overview.md` (app/overview/page.tsx and
 * scripts/build-overview.ts). The navigation outline is derived from that same
 * AST, so the methodology failure mode — an outline listing a section the prose
 * never renders (§8 #10) — cannot happen by drift between two lists. What CAN
 * happen is the master drifting out of the parser's contract, or a surface
 * silently not rendering a block kind. This file pins both:
 *
 *   - the real master parses, and its structure is what both emitters assume;
 *   - the load-bearing claims (the ones a reader can check against prod) are
 *     present in the text, so an edit cannot quietly delete them;
 *   - the scroll-spy arithmetic stays correct (it is pure here for exactly
 *     this reason — a headless pane cannot exercise it).
 */

const MD = readFileSync(
  join(import.meta.dirname, "..", "content", "investor-overview.md"),
  "utf8"
);

const doc: OverviewDoc = parseOverviewDocument(MD);

const allSections = doc.parts.flatMap((p) => p.sections);

test("overview master: front-matter is complete", () => {
  assert.equal(doc.meta.title, "RobinCalls");
  assert.equal(doc.meta.subtitle, "Project Overview");
  assert.match(doc.meta.version, /^\d+\.\d+$/);
  assert.ok(doc.meta.date.length > 0);
  assert.ok(doc.meta.tagline.length > 0);
  assert.ok(doc.meta.strapline.length > 0);
});

test("overview master: 7 parts, numbered sections count from 1 with no gaps", () => {
  assert.equal(doc.parts.length, 7);
  const numbered = allSections.filter((s) => s.number !== null);
  assert.deepEqual(
    numbered.map((s) => s.number),
    Array.from({ length: numbered.length }, (_, i) => i + 1),
    "section numbers must be 1..n in document order with no gaps"
  );
  // The two unnumbered kinds, matching the printed document.
  assert.ok(allSections.some((s) => s.title === "Important Notice" && s.number === null));
  assert.ok(allSections.filter((s) => s.title.startsWith("Appendix")).every((s) => s.number === null));
});

test("overview master: every section carries content", () => {
  for (const s of allSections) {
    assert.ok(
      s.blocks.length + s.subsections.length > 0,
      `section "${s.title}" parsed empty — the parser dropped it or the md is malformed`
    );
    for (const sub of s.subsections) {
      assert.ok(sub.blocks.length > 0, `subsection "${sub.title}" parsed empty`);
    }
  }
});

test("overview master: load-bearing claims are present", () => {
  const everything = JSON.stringify(doc.parts);

  // The threshold story: design target vs the currently-pinned value.
  assert.match(everything, /50% of curve progress/);
  assert.match(everything, /currently 5% of curve progress/);
  // The dispute channel and the adversarial-adaptation risk.
  assert.match(everything, /Telegram community/);
  assert.match(everything, /Adversarial adaptation/);
  // The score bands must match lib/config/formula.ts (CLEAR >=85, CAUTION >=60,
  // DANGER >=35, CRITICAL below 35).
  assert.match(everything, /85–100/);
  assert.match(everything, /Below 35/);
  // The RobinBets fee caps, matching BetFactory.sol.
  assert.match(everything, /up to 0.001 ETH/);
});

test("overview master: no duplicated headings (slug collisions)", () => {
  const ids = allSections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("overview outline: anchors are exactly part ids plus section ids, in order", () => {
  const parts = outlineFor(doc);
  const anchors = anchorsFor(parts);
  assert.equal(anchors.length, doc.parts.length + allSections.length);
  assert.equal(anchors[0], doc.parts[0].id);
});

test("overview scroll-spy: picks the last anchor above the reading line", () => {
  const anchors = ["a", "b", "c"];
  // All below the line -> first anchor.
  assert.equal(activeAnchorFor(anchors, [500, 600, 700], false), "a");
  // b crossed the line, c has not -> b.
  assert.equal(activeAnchorFor(anchors, [-50, ACTIVE_OFFSET_PX - 1, 900], false), "b");
  // Missing measurements are skipped, not treated as passed.
  assert.equal(activeAnchorFor(anchors, [null, -50, null], false), "b");
  // Bottom of document -> last anchor even if its top is below the line.
  assert.equal(activeAnchorFor(anchors, [-400, -300, 200], true), "c");
  assert.throws(() => activeAnchorFor([], [], false));
});

test("overview part fill: clamps to 0..1 and handles unsettled layout", () => {
  const fills = partFillFor([100, 400, 900], 1200);
  assert.equal(fills.length, 3);
  for (const f of fills) {
    assert.ok(Number.isFinite(f), "fill must be finite");
    assert.ok(f >= 0 && f <= 1, "fill must clamp to 0..1");
  }
  // Inverted span (layout not settled): the guard exists to keep the number
  // finite and in range, not to be semantically exact — assert exactly that.
  for (const f of partFillFor([400, 100], 1200)) {
    assert.ok(Number.isFinite(f) && f >= 0 && f <= 1);
  }
});

test("overview slugify: stable anchors", () => {
  assert.equal(slugifyHeading("Watchlist & Aggregated Launchpad"), "watchlist-aggregated-launchpad");
  assert.equal(slugifyHeading("Risk Factors & Mitigations"), "risk-factors-mitigations");
});

test("overview wiring: the page renders the parsed AST (not a private copy)", () => {
  // The one direction the type system cannot see: the page must render from
  // parseOverviewDocument's output. If someone pastes a static copy of the
  // document into the page, the PDF and the page drift silently.
  const page = readFileSync(
    join(import.meta.dirname, "..", "app", "overview", "page.tsx"),
    "utf8"
  );
  assert.match(page, /parseOverviewDocument/);
  assert.match(page, /readOverviewDoc/);
  assert.match(page, /outlineFor\(doc\)/);
  assert.match(page, /"investor-overview\.md"/);
});
