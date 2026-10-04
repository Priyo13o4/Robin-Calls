import test from "node:test";
import assert from "node:assert/strict";

import { Citations, unsupportedNumbers, validate } from "../lib/agent/citations";

/**
 * Citation-or-silence, browser side.
 *
 * This is a port of `services/agent/app/citations.py`, and the reason it exists
 * is that under BYOK the whole loop runs in the browser — `/agent/chat` is never
 * called, so the Python validator never sees the answer. Since our-models
 * refuses a key until metering lands, BYOK is the path users are actually on.
 * Without this the page would render an "EVERY FIGURE CITED" strip over
 * unchecked text, which is worse than having no validator at all.
 *
 * The cases below are deliberately the same ones `tests/test_citations.py`
 * pins. **Two implementations of one rule drift silently** — the paths would
 * strip different sentences and nobody would notice — so when you change one
 * side, change both suites.
 */

function withResults(...payloads: unknown[]): Citations {
  const citations = new Citations();
  for (const payload of payloads) citations.addResult(payload);
  return citations;
}

test("a number no tool returned takes its whole sentence with it", () => {
  const citations = withResults({ ok: true, found: true, value: { score: 72 } });
  const result = validate(
    "The score is 72. Roughly 61% of supply sits in the top ten wallets.",
    citations
  );

  assert.equal(result.text, "The score is 72.");
  assert.deepEqual(result.stripped, ["Roughly 61% of supply sits in the top ten wallets."]);
});

test("numbers are harvested at any nesting depth", () => {
  // Harvesting from the serialized payload is what makes a new tool's new shape
  // covered the day it ships, with no registration step to forget.
  const citations = withResults({
    ok: true,
    value: { checks: [{ id: "lp_custody", deduction: 9, evidence: { pct: 81.4 } }] },
  });

  assert.equal(unsupportedNumbers("LP custody cost it 9 points.", citations).length, 0);
  assert.equal(unsupportedNumbers("The deepest pool holds 81.4%.", citations).length, 0);
  assert.deepEqual(unsupportedNumbers("The deepest pool holds 44.2%.", citations), ["44.2"]);
});

test("small integers and the chain id are not claims", () => {
  const citations = new Citations();
  // No tool ran at all; ordinary English must still survive.
  const result = validate("Two things stand out. This is chain 4663.", citations);
  assert.equal(result.stripped.length, 0);
});

test("an honest rounding of a supported number is still supported", () => {
  const citations = withResults({ value: { liquidity: 412880, score: 72.0 } });
  assert.equal(unsupportedNumbers("about 72", citations).length, 0);
  assert.equal(unsupportedNumbers("roughly 412,900 dollars", citations).length, 0);
  // 1% is the ceiling — a different number is not a rounding of this one.
  assert.deepEqual(unsupportedNumbers("some 500,000 dollars", citations), ["500,000"]);
});

test("hex identifiers are not measurements", () => {
  const citations = new Citations();
  const result = validate("The admin is 0x9c4e11ab and the beacon is 0xe10b0000.", citations);
  assert.equal(result.stripped.length, 0);
});

test("an answer made entirely of invented numbers refuses rather than emptying", () => {
  const citations = new Citations();
  const result = validate("The score is 91 and liquidity is $412,880.", citations);

  assert.equal(result.stripped.length, 1);
  // Empty text would read as a system glitch; this reads as a refusal.
  assert.match(result.text, /can't answer that from what the tools returned/);
});

test("decimals and thousands separators canonicalize to the same value", () => {
  const citations = withResults({ value: { supply: "1234567" } });
  assert.equal(unsupportedNumbers("1,234,567 tokens", citations).length, 0);

  const trailing = withResults({ value: { score: 72.0 } });
  assert.equal(unsupportedNumbers("a 72 today", trailing).length, 0);
});

test("sentence splitting does not break on a decimal", () => {
  const citations = withResults({ value: { pct: 81.4, score: 72 } });
  const result = validate("Liquidity is 81.4% pooled. The score is 72.", citations);
  assert.equal(result.stripped.length, 0);
  assert.equal(result.text, "Liquidity is 81.4% pooled. The score is 72.");
});

test("empty text is left alone", () => {
  assert.deepEqual(validate("", new Citations()), { text: "", stripped: [] });
});
