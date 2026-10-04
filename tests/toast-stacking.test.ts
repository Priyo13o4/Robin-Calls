import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dismissAllToasts, toast, toastSnapshot } from "../components/ui/use-toast";

test("an identical repeat counts up and moves to the front instead of adding a row", () => {
  toast({ title: "Copied to clipboard", description: "0x52e6…71Ca", duration: null });
  toast({ title: "Copied to clipboard", description: "0x5fc5…d168", duration: null });
  toast({ title: "Copied to clipboard", description: "0x52e6…71Ca", duration: null });
  const rows = toastSnapshot();
  assert.equal(rows.length, 2, "two distinct messages, two rows");
  assert.equal(rows[1].description, "0x52e6…71Ca", "the repeat is now the front of the deck");
  assert.equal(rows[1].count, 2);
  assert.equal(rows[0].count, 1);
  assert.equal(rows[1].bump, 2, "the repeat restarts its progress bar");
  dismissAllToasts();
});

test("an explicit id replaces; it counts only when the text did not change", () => {
  toast({ id: "swap-error", description: "Quote failed.", duration: null });
  toast({ id: "swap-error", description: "Quote failed.", duration: null });
  assert.equal(toastSnapshot().find((t) => t.id === "swap-error")?.count, 2);
  toast({ id: "swap-error", description: "Different failure.", duration: null });
  assert.equal(toastSnapshot().find((t) => t.id === "swap-error")?.count, 1);
  dismissAllToasts();
});

test("WIRING: the toaster folds several toasts into a deck and shows the repeat count", () => {
  const toaster = readFileSync("components/ui/toaster.tsx", "utf8");
  assert.match(toaster, /gridArea: "1 \/ 1"/, "stacked toasts share one cell");
  assert.match(toaster, /count=\{t\.count\}/);
  assert.match(toaster, /onMouseEnter=\{\(\) => setExpanded\(true\)\}/, "hover fans the deck out");
});
