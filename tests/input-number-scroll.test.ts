import test from "node:test";
import assert from "node:assert/strict";
import { exactlyRenderable, InputNumberScroll } from "@/app/components/trade/InputNumberScroll";

/**
 * The input number scroll component must never state two different amounts at once,
 * and must never drop in-progress keystrokes (like trailing dot or zeros).
 *
 * It mirrors the contract from /token-sale (TokenSaleSwap.tsx):
 * - Clean numbers roll smoothly via NumberFlow.
 * - In-progress strings ("0.", "0.00", bare ".") render verbatim.
 * - Leading zeros / scientific notation / non-finite values fail closed to raw or placeholder.
 */

test("exactlyRenderable accurately identifies clean numbers that can roll", () => {
  const clean = ["0", "1", "1.5", "0.05", "0.25", "12.34", "100", "500000"];
  for (const raw of clean) {
    assert.equal(exactlyRenderable(raw), true, `"${raw}" should be exactly renderable`);
  }
});

test("exactlyRenderable rejects values where Intl formatting would mutate user input", () => {
  // Trailing dot, trailing zeros, empty, exponent, or capped rounding cases
  const inProgressOrMutated = [
    "",
    ".",
    "0.",
    "0.0",
    "0.00",
    "0.000000",
    "12.",
    "12.0",
    "0.0000005", // 5e-7 round-trips differently
  ];
  for (const raw of inProgressOrMutated) {
    assert.equal(exactlyRenderable(raw), false, `"${raw}" must NOT be passed to odometer`);
  }
});

test("exactlyRenderable rejects non-numeric junk", () => {
  const junk = ["abc", "1e5", "--1", "NaN", "undefined", "1.2.3"];
  for (const raw of junk) {
    assert.equal(exactlyRenderable(raw), false, `"${raw}" must not be parsed into odometer`);
  }
});

test("InputNumberScroll is defined and exports both component and helper", () => {
  assert.equal(typeof InputNumberScroll, "function", "InputNumberScroll component must be a function");
  assert.equal(typeof exactlyRenderable, "function", "exactlyRenderable must be an exported function");
});
