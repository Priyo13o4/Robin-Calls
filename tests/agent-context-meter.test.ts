import test from "node:test";
import assert from "node:assert/strict";
import {
  FILLING_AT,
  MIN_TURNS_TO_COMPACT,
  TIGHT_AT,
  canCompact,
  pressureOf,
  readContext,
} from "../lib/agent/context-meter";
import { CHARS_PER_TOKEN, approxTokens } from "../lib/agent/history";
import type { CanonicalMessage } from "../lib/agent/providers";

/**
 * The ring exists to answer one question honestly: is this conversation about
 * to start losing its own beginning? Everything here defends that.
 */

/** A user turn of roughly `tokens` tokens, in the plane's own unit. */
function userTurn(tokens: number, tag = "q"): CanonicalMessage {
  return { role: "user", content: `${tag}${"x".repeat(tokens * CHARS_PER_TOKEN)}` } as CanonicalMessage;
}

function assistantTurn(tokens: number): CanonicalMessage {
  return { role: "assistant", content: "y".repeat(tokens * CHARS_PER_TOKEN) } as CanonicalMessage;
}

test("an empty conversation reads as empty, not as full", () => {
  const r = readContext([], 24_000);
  assert.equal(r.usedTokens, 0);
  assert.equal(r.fraction, 0);
  assert.equal(r.pressure, "roomy");
  assert.equal(r.wouldDrop, 0);
});

test("usage is measured against OUR ceiling, not the model's window", () => {
  // The whole point of the component. 30k of transcript against a 24k budget
  // is a full ring; against a notional 1M window it would read as 3%.
  const messages = [userTurn(30_000)];
  const ours = readContext(messages, 24_000);
  assert.equal(ours.fraction, 1, "clamped, and full");
  assert.notEqual(ours.pressure, "roomy");

  const modelWindow = readContext(messages, 1_000_000);
  assert.ok(modelWindow.fraction < 0.05, "the same transcript looks empty against a 1M window");
  assert.equal(modelWindow.pressure, "roomy", "which is exactly the lie the ring must not tell");
});

test("fraction is clamped, so a 200%-over transcript still reads as one full ring", () => {
  const r = readContext([userTurn(48_000)], 24_000);
  assert.equal(r.fraction, 1);
});

test("wouldDrop comes from the real trimmer and matches what the request path does", () => {
  // Four turns, each ~4k. A 10k ceiling cannot hold all four, so the trimmer
  // cuts at a turn boundary — and the ring must report that same cut.
  const messages = [
    userTurn(4_000, "a"),
    assistantTurn(1_000),
    userTurn(4_000, "b"),
    assistantTurn(1_000),
    userTurn(4_000, "c"),
    assistantTurn(1_000),
  ];
  const r = readContext(messages, 10_000);
  assert.ok(r.wouldDrop > 0, "the trimmer would cut here and the ring said it would not");
  assert.equal(r.pressure, "over");

  // The number itself has to agree with trim(), not merely be non-zero.
  const kept = messages.slice(r.wouldDrop);
  assert.ok(approxTokens(kept) <= 10_000, "the reported cut does not actually fit the budget");
});

test("a dropped turn outranks the ratio — losing a turn is the event, not the arithmetic", () => {
  // Under budget by tokens, yet the trimmer still cut: `over` must win.
  assert.equal(pressureOf(0.2, 3), "over");
  assert.equal(pressureOf(0, 1), "over");
});

test("one turn too big to trim is 'over', not 'tight' — the request will be refused", () => {
  // The trimmer cuts only at turn boundaries, so a single oversized turn has
  // nothing to cut and honestly reports `dropped: 0`. Read through wouldDrop
  // alone that is indistinguishable from a healthy conversation, and the ring
  // would sit just short of full while the provider rejects the request.
  const r = readContext([userTurn(30_000)], 24_000);
  assert.equal(r.wouldDrop, 0, "there is genuinely nothing to drop");
  assert.equal(r.irreducible, true);
  assert.equal(r.pressure, "over");
});

test("a transcript that fits after trimming is not irreducible", () => {
  const messages = [
    userTurn(4_000, "a"),
    assistantTurn(1_000),
    userTurn(4_000, "b"),
    assistantTurn(1_000),
    userTurn(1_000, "c"),
  ];
  const r = readContext(messages, 10_000);
  assert.equal(r.irreducible, false, "trimming resolves this one, so it is not a hard failure");
});

test("the quiet band stays quiet, and the thresholds are the ones documented", () => {
  assert.equal(pressureOf(0, 0), "roomy");
  assert.equal(pressureOf(FILLING_AT - 0.01, 0), "roomy");
  assert.equal(pressureOf(FILLING_AT, 0), "filling");
  assert.equal(pressureOf(TIGHT_AT - 0.01, 0), "filling");
  assert.equal(pressureOf(TIGHT_AT, 0), "tight");
  assert.equal(pressureOf(1, 0), "tight", "full but nothing lost yet is not the same as over");
});

test("a zero or negative ceiling reads full, never NaN", () => {
  // A misconfigured dial must not render a blank ring that looks like room.
  for (const max of [0, -1]) {
    const r = readContext([userTurn(100)], max);
    assert.equal(r.fraction, 1, `ceiling ${max}`);
    assert.ok(Number.isFinite(r.fraction));
    assert.equal(r.wouldDrop, 0, "no cut can be computed against a nonsense ceiling");
  }
});

test("compaction is not offered on a short conversation, whatever the pressure", () => {
  // One enormous tool result is not a summarisable history, and compacting it
  // would spend a model call to lose information for nothing.
  const messages = [userTurn(30_000)];
  const r = readContext(messages, 24_000);
  assert.equal(r.pressure, "over", "maximum pressure...");
  assert.equal(canCompact(messages, r), false, "...and still nothing worth compacting");
});

test("compaction is offered once there is both history and pressure", () => {
  const messages: CanonicalMessage[] = [];
  for (let i = 0; i < MIN_TURNS_TO_COMPACT; i += 1) {
    messages.push(userTurn(3_000, `q${i}`), assistantTurn(1_000));
  }
  const reading = readContext(messages, 24_000);
  assert.notEqual(reading.pressure, "roomy");
  assert.equal(canCompact(messages, reading), true);

  // ...and not while there is plenty of room, however many turns there are.
  const roomy = readContext(messages, 1_000_000);
  assert.equal(roomy.pressure, "roomy");
  assert.equal(canCompact(messages, roomy), false);
});
