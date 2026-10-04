import test from "node:test";
import assert from "node:assert/strict";
import { canReserveSequencerCredits, sanitizeSequencerError } from "@/lib/data/sequencer";

test("sequencer credit reservation enforces both daily caps", () => {
  const limits = { accountDaily: 10_000, totalDaily: 20_000 };
  assert.equal(canReserveSequencerCredits(0, 0, 8_000, limits), true);
  assert.equal(canReserveSequencerCredits(8_000, 8_000, 2_001, limits), false);
  assert.equal(canReserveSequencerCredits(1_000, 19_000, 1_001, limits), false);
  assert.equal(canReserveSequencerCredits(0, 0, 0, limits), false);
  assert.equal(canReserveSequencerCredits(0, 0, 10_001, limits), false);
});

test("sequencer errors are bounded and redact URLs and long hex values", () => {
  const safe = sanitizeSequencerError(new Error(`request https://provider.test/key failed token=supersecret 0x${"ab".repeat(32)}`));
  assert.equal(safe.includes("provider.test"), false);
  assert.equal(safe.includes("supersecret"), false);
  assert.equal(safe.includes("ab".repeat(32)), false);
  assert.ok(safe.length <= 240);
});
