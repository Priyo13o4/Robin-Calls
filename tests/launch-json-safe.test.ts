import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jsonSafe, textSafe } from "../lib/data/launches";

// A Doppler Lock carries uint96 shares as bigint; one in `detail` aborted the whole window commit on chain.
test("jsonSafe turns nested bigints into strings instead of throwing", () => {
  const detail = { beneficiaries: [{ beneficiary: "0xabc", shares: 950_000_000_000_000_000n }], positions: [{ liquidityDelta: "1" }] };
  assert.throws(() => JSON.stringify(detail));
  assert.deepEqual(jsonSafe(detail), { beneficiaries: [{ beneficiary: "0xabc", shares: "950000000000000000" }], positions: [{ liquidityDelta: "1" }] });
  assert.equal(jsonSafe(null), null);
});

test("textSafe strips Postgres-prohibited 0x00 null bytes and whitespace", () => {
  assert.equal(textSafe("Token\0Name\0"), "TokenName");
  assert.equal(textSafe("\0\0"), null);
  assert.equal(textSafe("   "), null);
  assert.equal(textSafe(null), null);
  assert.equal(textSafe(undefined), null);
  assert.equal(textSafe("CleanToken"), "CleanToken");
});

test("jsonSafe strips 0x00 null bytes inside detail object strings", () => {
  const detail = { name: "Bad\0Token", meta: { symbol: "BAD\0" } };
  assert.deepEqual(jsonSafe(detail), { name: "BadToken", meta: { symbol: "BAD" } });
});

test("every launch writer strips NUL through the shared helpers (wiring, §8 #7)", () => {
  const writers = { "lib/data/sequencer.ts": 1, "lib/data/launches.ts": 2 } as const;
  for (const [file, count] of Object.entries(writers)) {
    const src = readFileSync(file, "utf8");
    const named = src.match(/name: textSafe\(d\.name\)/g) ?? [];
    assert.equal(named.length, count, `${file}: every launches insert passes name through textSafe`);
    assert.doesNotMatch(src, /name: d\.name,/, `${file}: a raw token name reaches Postgres`);
  }
  // A local copy is how the sequencer lost the NUL strip once already.
  assert.doesNotMatch(readFileSync("lib/data/sequencer.ts", "utf8"), /function jsonSafe/);
});
