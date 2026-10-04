import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOC_PARTS } from "../app/methodology/outline";

const PAGE_SOURCE = readFileSync(
  join(import.meta.dirname, "..", "app", "methodology", "page.tsx"),
  "utf8"
);

test("swap part exists in DOC_PARTS and comes before history", () => {
  const swapIndex = DOC_PARTS.findIndex((p) => p.id === "swap");
  const historyIndex = DOC_PARTS.findIndex((p) => p.id === "history");
  assert.notEqual(swapIndex, -1, "DOC_PARTS must contain a part with id 'swap'");
  assert.notEqual(historyIndex, -1, "DOC_PARTS must contain a part with id 'history'");
  assert.ok(
    swapIndex < historyIndex,
    `swap (index ${swapIndex}) must come before history (index ${historyIndex})`
  );
});

test("page.tsx renders <Part id=\"swap\" />", () => {
  assert.ok(
    PAGE_SOURCE.includes('<Part id="swap"'),
    "page.tsx must render <Part id=\"swap\" />"
  );
});

test("every swap section declared in the outline is rendered in page.tsx", () => {
  const swapPart = DOC_PARTS.find((p) => p.id === "swap");
  assert.ok(swapPart, "swap part must exist in DOC_PARTS");
  const sectionIds = swapPart.sections.map((s) => s.id);
  assert.ok(
    sectionIds.length > 0,
    "swap part must declare at least one section"
  );
  for (const id of sectionIds) {
    assert.ok(
      PAGE_SOURCE.includes(`<Section id="${id}"`),
      `swap section "${id}" is declared in the outline but never rendered in page.tsx`
    );
  }
});

test("no em dash character in the swap part copy", () => {
  const swapStart = PAGE_SOURCE.indexOf('<Part id="swap"');
  assert.ok(swapStart !== -1, "swap part must appear in page.tsx");

  // Find the next <Part id= after the swap part to delimit the slice.
  const afterSwap = PAGE_SOURCE.indexOf("<Part id=", swapStart + 1);
  assert.ok(afterSwap > swapStart, "there must be a part after swap to delimit the slice");

  const swapSlice = PAGE_SOURCE.slice(swapStart, afterSwap);
  assert.ok(swapSlice.length > 0, "swap slice must be non-empty");
  assert.equal(
    swapSlice.includes("\u2014"),
    false,
    "swap part copy must not contain an em dash (\u2014)"
  );
});
