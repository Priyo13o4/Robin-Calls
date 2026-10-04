import test from "node:test";
import assert from "node:assert/strict";
import { _saleSwapInternals } from "@/app/token-sale/TokenSaleSwap";

const { exactlyRenderable } = _saleSwapInternals;

/**
 * The buy card must never state two different amounts at once.
 *
 * The big number was handed to an odometer that formats through Intl, while the
 * CTA below printed the raw keystrokes. They disagreed in two ways:
 *
 *   "0.0"       rendered "0"         — trailing zeros dropped
 *   "0.0000005" rendered "0.000001"  — ROUNDED UP past a 6-digit cap
 *
 * The first is cosmetic. The second is not: the headline figure showed a larger
 * number than the button would send, on the one screen whose entire job is
 * telling someone how much ETH they are about to commit.
 *
 * So the odometer only ever animates a value it can render unchanged, and the
 * test below is the round trip, not a second copy of the formatting rule.
 */

/** What the card actually paints, mirroring TypedAmount's two branches. */
function displayed(raw: string): string {
  if (!exactlyRenderable(raw)) return raw;
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
  return Number(raw).toLocaleString("en-US", { maximumFractionDigits: decimals, useGrouping: false });
}

test("what is displayed is always what was typed", () => {
  const typed = [
    "", "0", "0.", "0.0", "0.00", "0.000000",
    "0.0000005", "0.1234567", "0.05", "0.001", "1", "1.5",
    "12.340", "0.010", "3.14159265358979",
  ];
  for (const raw of typed) {
    assert.equal(displayed(raw), raw, `typing "${raw}" painted "${displayed(raw)}"`);
  }
});

test("the two reported cases specifically", () => {
  // Pinned by name so a regression is legible in the failure output.
  assert.equal(displayed("0.0"), "0.0", "trailing zero was dropped again");
  assert.equal(displayed("0.000000"), "0.000000", "trailing zeros were dropped again");
  assert.equal(displayed("0.0000005"), "0.0000005", "the amount was rounded to a DIFFERENT number");
});

test("a value that rounds under the odometer is never given to it", () => {
  // The guard that matters: anything Intl would alter must take the raw branch.
  for (const raw of ["0.0000005", "0.0", "0.000000", "0."]) {
    assert.equal(exactlyRenderable(raw), false, `"${raw}" would be reformatted by the odometer`);
  }
});

test("ordinary amounts still animate — the fix must not disable the odometer", () => {
  // Failing safe here would mean a static number for every input, which is a
  // silent removal of the feature rather than a fix.
  for (const raw of ["0.05", "1", "1.5", "0.25", "12.34"]) {
    assert.equal(exactlyRenderable(raw), true, `"${raw}" should still roll`);
  }
});

test("junk never reaches the odometer", () => {
  for (const raw of ["", "abc", "1e5", "--1", "."]) {
    assert.equal(exactlyRenderable(raw), false, `"${raw}" must not be parsed into the odometer`);
  }
});

test("the display cannot claim MORE than the wallet is asked to send", () => {
  // The property behind the rounding bug, stated as the risk it carried: the
  // painted figure must never exceed the parsed one.
  for (const raw of ["0.0000005", "0.00000049", "0.1234567", "0.05"]) {
    const shown = displayed(raw);
    const shownNum = Number(shown);
    assert.ok(
      Number.isFinite(shownNum) && shownNum <= Number(raw),
      `display "${shown}" overstates typed "${raw}"`,
    );
  }
});
