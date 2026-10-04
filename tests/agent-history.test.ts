import test from "node:test";
import assert from "node:assert/strict";

import { approxTokens, trim } from "../lib/agent/history";
import type { CanonicalMessage } from "../lib/agent/providers";

/**
 * Bounding the BYOK transcript.
 *
 * A port of `services/agent/app/history.py`, for the same reason as
 * `citations.ts`: under BYOK the Python trim never runs, and an unbounded
 * transcript fails hard, mid-conversation, and no better on retry.
 *
 * The load-bearing assertion is the second one. **Never split a `tool_use` from
 * its `tool_result`** — every provider rejects an orphan of either kind, so a
 * naive "drop the first N messages" is not a smaller conversation, it is a 400.
 * That failure only appears on long conversations with tool calls, which is to
 * say in production.
 */

const user = (text: string): CanonicalMessage => ({ role: "user", content: text });

const assistantCall = (id: string): CanonicalMessage => ({
  role: "assistant",
  content: [{ type: "tool_use", id, name: "get_verdict", input: {} }],
});

const toolResult = (id: string, body = "{}"): CanonicalMessage => ({
  role: "user",
  content: [{ type: "tool_result", tool_use_id: id, content: body }],
});

test("a transcript that already fits is returned untouched", () => {
  const messages = [user("hello"), { role: "assistant", content: "hi" } as CanonicalMessage];
  const result = trim(messages, 1000);

  assert.equal(result.wasTrimmed, false);
  assert.equal(result.dropped, 0);
  assert.equal(result.messages, messages, "the same array, not a copy");
});

test("the cut never lands between a tool_use and its tool_result", () => {
  const messages = [
    user("first question"),
    assistantCall("toolu_1"),
    toolResult("toolu_1", JSON.stringify({ padding: "x".repeat(4000) })),
    { role: "assistant", content: "an answer" } as CanonicalMessage,
    user("second question"),
    assistantCall("toolu_2"),
    toolResult("toolu_2"),
    { role: "assistant", content: "another answer" } as CanonicalMessage,
  ];

  const result = trim(messages, 200);

  assert.ok(result.wasTrimmed);
  // The first kept message must be a legal transcript opening: a plain user
  // message with no tool_result in it.
  const first = result.messages[0];
  assert.equal(first.role, "user");
  assert.equal(typeof first.content, "string");

  // And no tool_result may survive without the tool_use that asked for it.
  const askedIds = new Set<string>();
  for (const message of result.messages) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "tool_use") askedIds.add(block.id);
        if (block.type === "tool_result") {
          assert.ok(askedIds.has(block.tool_use_id), `orphaned result ${block.tool_use_id}`);
        }
      }
    }
  }
});

test("an irreducible final turn is kept whole rather than truncated", () => {
  // One enormous tool result. Silently truncating it would hand the model a
  // partial verdict that still looks complete — the one thing this system must
  // never do — so the provider's own rejection is the honest outcome.
  const messages = [
    user("old"),
    { role: "assistant", content: "old answer" } as CanonicalMessage,
    user("current"),
    assistantCall("toolu_9"),
    toolResult("toolu_9", "y".repeat(90_000)),
  ];

  const result = trim(messages, 100);

  assert.equal(result.dropped, 2);
  assert.equal(result.messages[0].content, "current");
  assert.ok(result.approxTokens > 100, "kept over budget on purpose");
});

test("a transcript with no legal starting point is passed through, not invented", () => {
  const messages = [assistantCall("toolu_1"), toolResult("toolu_1")];
  const result = trim(messages, 1);

  assert.equal(result.dropped, 0);
  assert.equal(result.wasTrimmed, false);
  assert.equal(result.messages.length, 2);
});

test("token estimation matches the Python heuristic", () => {
  // CHARS_PER_TOKEN = 3, deliberately conservative. Guessing low costs a
  // shorter history; guessing high costs the failure this exists to prevent.
  assert.equal(approxTokens([user("x".repeat(300))]), 100);
  assert.equal(approxTokens([]), 0);
});
