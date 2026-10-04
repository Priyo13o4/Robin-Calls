import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEP_RECENT_TURNS,
  MIN_ELIDABLE_CHARS,
  compactTranscript,
  elisionText,
  recentTurnStart,
} from "../lib/agent/compaction";
import type { CanonicalMessage } from "../lib/agent/providers";

/**
 * Compaction is the one optimisation in this plane that can manufacture a false
 * all-clear out of nothing — it edits what the model is told it read. Most of
 * these tests are about what it must NOT do.
 */

const BIG = "x".repeat(MIN_ELIDABLE_CHARS + 200);

function turn(question: string, toolName: string, id: string, payload: string): CanonicalMessage[] {
  return [
    { role: "user", content: question },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id, name: toolName, input: { address: "0xabc" }, signature: `sig-${id}` },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: payload }] },
    { role: "assistant", content: "Here is what I found." },
  ] as unknown as CanonicalMessage[];
}

function conversation(turns: number): CanonicalMessage[] {
  const out: CanonicalMessage[] = [];
  for (let i = 0; i < turns; i += 1) out.push(...turn(`q${i}`, "get_verdict", `t${i}`, `${BIG}${i}`));
  return out;
}

test("old tool results are elided and recent turns are untouched", () => {
  const messages = conversation(5);
  const result = compactTranscript(messages, KEEP_RECENT_TURNS);

  assert.equal(result.elided, 3, "5 turns, 2 kept whole, so 3 results elided");
  assert.ok(result.tokensAfter < result.tokensBefore, "compaction did not shrink anything");

  const cutoff = recentTurnStart(messages, KEEP_RECENT_TURNS);
  for (let i = cutoff; i < messages.length; i += 1) {
    assert.deepEqual(result.transcript[i], messages[i], `recent message ${i} was modified`);
  }
});

test("an elided result never reads as an empty result", () => {
  // §4's table, in reverse: every row there is a read that failed being
  // narrated as a fact about the token. An optimiser that blanks a payload
  // manufactures the same bug on purpose.
  const text = elisionText("get_contract_audit");
  assert.match(text, /NOT an empty result/i);
  assert.match(text, /not a finding that nothing was found/i);
  assert.match(text, /call the tool again/i);
  assert.match(text, /get_contract_audit/, "the model should know which read it lost");

  const result = compactTranscript(conversation(5));
  const json = JSON.stringify(result.transcript);
  assert.ok(!json.includes('"content":{}'), "an elided result serialized as an empty object");
  assert.ok(!json.includes('"content":null'), "an elided result serialized as null");
});

test("tool_use blocks survive verbatim, signature included", () => {
  // Gemini refuses the NEXT request if a thoughtSignature is not echoed back,
  // and every provider rejects a tool_use with no matching result. Compaction
  // that broke either would turn a long conversation into a hard 400.
  const messages = conversation(5);
  const result = compactTranscript(messages);

  const uses = (list: CanonicalMessage[]) =>
    list.flatMap((m) =>
      Array.isArray(m.content)
        ? m.content.filter((b) => (b as { type?: string })?.type === "tool_use")
        : [],
    );
  assert.deepEqual(uses(result.transcript), uses(messages), "tool_use blocks were altered");

  // Pairing intact: every result still names a tool_use that exists.
  const ids = new Set(uses(result.transcript).map((b) => (b as { id: string }).id));
  for (const m of result.transcript) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      const block = b as { type?: string; tool_use_id?: string };
      if (block.type === "tool_result") {
        assert.ok(ids.has(block.tool_use_id!), `orphaned tool_result ${block.tool_use_id}`);
      }
    }
  }
});

test("the user's own words and the model's answers are never rewritten", () => {
  const messages = conversation(5);
  const result = compactTranscript(messages);
  const prose = (list: CanonicalMessage[]) => list.filter((m) => typeof m.content === "string");
  assert.deepEqual(prose(result.transcript), prose(messages));
});

test("a short conversation is returned untouched, by identity", () => {
  const messages = conversation(KEEP_RECENT_TURNS);
  const result = compactTranscript(messages, KEEP_RECENT_TURNS);
  assert.equal(result.transcript, messages, "should be the same array, not a copy");
  assert.equal(result.elided, 0);
  assert.equal(result.tokensAfter, result.tokensBefore);
});

test("small tool results are left alone — the placeholder would cost more", () => {
  const messages: CanonicalMessage[] = [];
  for (let i = 0; i < 5; i += 1) messages.push(...turn(`q${i}`, "get_block_number", `t${i}`, "42"));
  const result = compactTranscript(messages);
  assert.equal(result.elided, 0);
  assert.equal(result.tokensAfter, result.tokensBefore);
});

test("compacting twice is a no-op the second time", () => {
  // The placeholder is under MIN_ELIDABLE_CHARS, so it cannot be re-elided
  // into a shorter and shorter stub across repeated presses.
  const once = compactTranscript(conversation(6));
  const twice = compactTranscript(once.transcript);
  assert.equal(twice.elided, 0, "a second press ate into an already-elided result");
  assert.equal(twice.tokensAfter, once.tokensAfter);
});

test("an empty or malformed transcript does not throw", () => {
  assert.equal(compactTranscript([]).elided, 0);
  const malformed = [{ role: "assistant", content: null }] as unknown as CanonicalMessage[];
  assert.equal(compactTranscript(malformed).elided, 0);
});
