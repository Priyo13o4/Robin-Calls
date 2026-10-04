import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDexPrice, toSubscript } from "../lib/trade/format";

describe("formatDexPrice", () => {
  it("formats normal prices >= $1.00", () => {
    assert.equal(formatDexPrice(1234.56), "$1,234.56");
    assert.equal(formatDexPrice(1.234), "$1.234");
  });

  it("formats prices between 0.0001 and 1.00 with standard 6 decimals", () => {
    assert.equal(formatDexPrice(0.05), "$0.050000");
    assert.equal(formatDexPrice(0.000123), "$0.000123");
  });

  it("handles threshold guard when value < 0.000001 like DexScreener subscript notation", () => {
    // 6 zeros: 0.000000603 -> $0.0₆603
    assert.equal(formatDexPrice(0.000000603), "$0.0₆603");
    // 5 zeros: 0.00000603 -> $0.0₅603
    assert.equal(formatDexPrice(0.00000603), "$0.0₅603");
    // 4 zeros: 0.0000603 -> $0.0₄603
    assert.equal(formatDexPrice(0.0000603), "$0.0₄603");
  });

  it("handles scientific notation exponents cleanly", () => {
    // 6.03e-24 -> $0.0₂₃603
    assert.equal(formatDexPrice(6.03e-24), "$0.0₂₃603");
    // 1e-7 -> $0.0₆1
    assert.equal(formatDexPrice(1e-7), "$0.0₆1");
  });

  it("handles null, zero, negative and non-finite values safely", () => {
    assert.equal(formatDexPrice(null), "—");
    assert.equal(formatDexPrice(undefined), "—");
    assert.equal(formatDexPrice(0), "—");
    assert.equal(formatDexPrice(-5), "—");
    assert.equal(formatDexPrice(NaN), "—");
  });

  it("supports custom prefix and significant digits", () => {
    assert.equal(formatDexPrice(0.000000603, { prefix: "" }), "0.0₆603");
  });
});
