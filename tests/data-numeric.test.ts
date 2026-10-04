import test from "node:test";
import assert from "node:assert/strict";
import { toNumericString, fromNumericString } from "../lib/data/numeric";

// ── the falsy-zero trap ──
//
// Postgres `numeric` columns arrive as strings and leave as strings. The
// obvious-looking conversions — `n ? n.toString() : null` on write and
// `r.x ? Number(r.x) : null` on read — both destroy a real `0`.
//
// In this domain that is the worst possible value to lose: zero liquidity is a
// fully drained pool, the single strongest rug signal. It has bitten twice, on
// the write path (`market_snapshots`) and on the read path (`slow_rug_watch`,
// `token_marks`), so both directions are pinned here.

test("fromNumericString preserves zero instead of nulling it", () => {
  assert.equal(fromNumericString("0"), 0);
  assert.equal(fromNumericString("0.00"), 0);
  assert.equal(fromNumericString("120.5"), 120.5);
});

test("toNumericString preserves zero instead of nulling it", () => {
  assert.equal(toNumericString(0), "0");
  assert.equal(toNumericString(120.5), "120.5");
});

test("genuinely absent values stay null in both directions", () => {
  assert.equal(fromNumericString(null), null);
  assert.equal(fromNumericString(undefined), null);
  assert.equal(toNumericString(null), null);
  assert.equal(toNumericString(undefined), null);
});

test("non-finite values are rejected rather than written as NaN/Infinity", () => {
  // `numeric` has no NaN/Infinity we want; a bad computation must not be
  // persisted as a value that later reads back as a number.
  assert.equal(toNumericString(Number.NaN), null);
  assert.equal(toNumericString(Number.POSITIVE_INFINITY), null);
  assert.equal(fromNumericString("not-a-number"), null);
});

test("round-trip through the database representation is lossless for zero", () => {
  const stored = toNumericString(0);
  assert.equal(stored, "0");
  assert.equal(fromNumericString(stored), 0);
});
