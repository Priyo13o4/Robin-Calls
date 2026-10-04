import test from "node:test";
import assert from "node:assert/strict";

import { breakdownContext } from "../lib/agent/context-breakdown";
import { approxTokens } from "../lib/agent/history";
import { compactTranscript } from "../lib/agent/compaction";
import type { CanonicalMessage } from "../lib/agent/providers";

/**
 * The breakdown sits next to the ring, and the two are read together. Every
 * test here is really one assertion: it may not contradict the ring.
 */

const BIG = "x".repeat(9_000);

function conversation(): CanonicalMessage[] {
  return [
    { role: "user", content: "who holds the LP?" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Let me look." },
        { type: "tool_use", id: "a1", name: "run_contract_audit", input: { address: "0xabc" } },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "a1", content: BIG }],
    },
    { role: "assistant", content: [{ type: "text", text: "The pool is held by a locker." }] },
    { role: "user", content: "and the deployer?" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "b2", name: "get_token_meta", input: { address: "0xabc" } },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "b2", content: BIG }] },
    { role: "assistant", content: [{ type: "text", text: "Deployed by 0xdead." }] },
    // A third turn: `compactTranscript` keeps the last two whole, so a fixture
    // with only two turns has nothing older to elide and would prove nothing.
    { role: "user", content: "anything else on it?" },
    { role: "assistant", content: [{ type: "text", text: "Nothing further on record." }] },
  ];
}

test("the slices sum to exactly what the ring shows", () => {
  const messages = conversation();
  const result = breakdownContext(messages);
  const summed = result.slices.reduce((total, slice) => total + slice.tokens, 0);
  assert.equal(result.totalTokens, approxTokens(messages), "the total is not the ring's total");
  assert.equal(summed, result.totalTokens, "the parts do not add up to the whole");
});

test("summing holds when many tools are involved — the flooring case", () => {
  // Flooring each slice independently loses up to a token per slice, so the
  // shortfall grows with the number of slices. Twelve distinct tools is where
  // a naive implementation is visibly short.
  const messages: CanonicalMessage[] = [];
  for (let i = 0; i < 12; i += 1) {
    messages.push({ role: "user", content: `question ${i}` });
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id: `t${i}`, name: `tool_${i}`, input: { n: i } }],
    });
    messages.push({
      role: "user",
      // Deliberately not a multiple of CHARS_PER_TOKEN.
      content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "y".repeat(500 + i) }],
    });
  }
  const result = breakdownContext(messages);
  const summed = result.slices.reduce((total, slice) => total + slice.tokens, 0);
  assert.equal(summed, result.totalTokens);
  assert.equal(result.totalTokens, approxTokens(messages));
});

test("a tool result is attributed to the tool that asked for it", () => {
  const result = breakdownContext(conversation());
  const audit = result.slices.find((s) => s.key === "tool:run_contract_audit");
  assert.ok(audit, "the audit tool has no slice");
  // The 9,000-char result dominates; if the result were attributed to the user
  // (it arrives on a user-role message) this would be a few tokens instead.
  assert.ok(audit.tokens > 2_900, `audit slice was only ${audit.tokens} tokens`);
  assert.equal(audit.count, 2, "the call and its result both belong to the tool");
});

test("a tool result whose call is gone is named, not silently merged into prose", () => {
  // `trim()` can drop the turn that made the call while its result survives in
  // a later one. Attributing that to the user's prose would inflate the one
  // slice a user cannot do anything about.
  const orphan: CanonicalMessage[] = [
    { role: "user", content: [{ type: "tool_result", tool_use_id: "missing", content: BIG }] },
  ];
  const result = breakdownContext(orphan);
  const slice = result.slices.find((s) => s.kind === "tool");
  assert.ok(slice, "an orphan result was not counted as tool traffic");
  assert.equal(slice.label, "unknown tool");
  assert.equal(result.slices.some((s) => s.kind === "user"), false);
});

test("prose is never ranked above the tools", () => {
  const result = breakdownContext(conversation());
  const firstProse = result.slices.findIndex((s) => s.kind === "user" || s.kind === "assistant");
  const lastTool = result.slices.map((s) => s.kind).lastIndexOf("tool");
  assert.ok(firstProse > lastTool, "a prose slice was interleaved with the tool ranking");
});

test("recoverable is what compaction actually frees, not the tool total", () => {
  const messages = conversation();
  const result = breakdownContext(messages);
  const compacted = compactTranscript(messages);
  assert.equal(result.recoverableTokens, compacted.tokensBefore - compacted.tokensAfter);

  const toolTokens = result.slices
    .filter((s) => s.kind === "tool")
    .reduce((total, slice) => total + slice.tokens, 0);
  // The recent turns are kept whole, so the honest figure is strictly less than
  // the sum of the tool slices. A breakdown that reported the latter would
  // promise a saving the button cannot deliver.
  assert.ok(
    result.recoverableTokens < toolTokens,
    `recoverable ${result.recoverableTokens} should be under the ${toolTokens} tokens of tool traffic`,
  );
  assert.ok(result.recoverableTokens > 0, "there was something to recover and it reported none");
});

test("a prose-only conversation reports nothing to recover", () => {
  // The our-models path: no tool_result ever reaches the browser. COMPACT is
  // honest about being useless here rather than appearing to do something.
  const prose: CanonicalMessage[] = [];
  for (let i = 0; i < 8; i += 1) {
    prose.push({ role: "user", content: `question ${i} `.repeat(200) });
    prose.push({ role: "assistant", content: [{ type: "text", text: `answer ${i} `.repeat(200) }] });
  }
  const result = breakdownContext(prose);
  assert.equal(result.recoverableTokens, 0);
  assert.equal(result.slices.some((s) => s.kind === "tool"), false);
  assert.equal(
    result.slices.reduce((total, slice) => total + slice.tokens, 0),
    result.totalTokens,
  );
});

test("an empty transcript produces no slices and claims no saving", () => {
  const result = breakdownContext([]);
  assert.deepEqual(result.slices, []);
  assert.equal(result.totalTokens, 0);
  assert.equal(result.recoverableTokens, 0);
});
