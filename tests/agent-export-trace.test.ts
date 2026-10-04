import test from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "../lib/agent/store";
import type { Conversation, TraceEntry } from "../lib/agent/types";

/**
 * A Markdown export is the only copy of a conversation that leaves the
 * browser — we store nothing — so it is also the artifact a user sends us when
 * a tool misbehaves. It used to print name, outcome and duration and drop the
 * error text, which meant a rate limit, an unconfigured explorer endpoint and
 * a wrong-chain RPC all exported as the single word `transient`. The reason
 * was in the payload the whole time, one field away, and the export was where
 * it went missing.
 *
 * The failing outcome must carry WHY. The succeeding one must not grow noise.
 */

function conversation(trace: TraceEntry[]): Conversation {
  return {
    id: "c1",
    title: "audit",
    persona: "auditor",
    mode: "ours",
    createdAt: "2026-08-06T05:53:51.046Z",
    updatedAt: "2026-08-06T05:53:51.046Z",
    subject: null,
    messages: [
      { id: "u1", role: "user", text: "audit 0xabc", createdAt: "2026-08-06T05:53:51.046Z" },
      { id: "a1", role: "assistant", text: "I could not complete it.", createdAt: "2026-08-06T05:53:52.046Z", trace },
    ],
  } as unknown as Conversation;
}

const CLIENT_FAILURE: TraceEntry = {
  id: "t1",
  name: "run_contract_audit",
  locale: "client",
  outcome: "transient",
  durationMs: 999,
  payload: {
    ok: false,
    error: "HTTP request failed. Status: 429 Too Many Requests",
    code: "RC_AGENT_CLIENT_TOOL_FAILED",
    transient: true,
  },
};

test("a failed tool row exports the reason, not just the outcome word", () => {
  const md = toMarkdown(conversation([CLIENT_FAILURE]));
  assert.match(md, /`run_contract_audit` — transient \(999ms\)/);
  assert.match(md, /429 Too Many Requests/, "the export dropped the only text that says what broke");
  assert.match(md, /RC_AGENT_CLIENT_TOOL_FAILED/);
});

test("a successful tool row stays a single line — the reason is for failures only", () => {
  const ok: TraceEntry = {
    id: "t2",
    name: "get_contract_audit",
    locale: "server",
    outcome: "found",
    durationMs: 64,
    payload: { ok: true, found: true, value: { capabilities: [] } },
  };
  const md = toMarkdown(conversation([ok]));
  assert.match(md, /`get_contract_audit` — found \(64ms\)/);
  assert.ok(!md.includes("reason"), "a healthy read must not grow a reason line");
});

test("a row with no payload at all still exports, without inventing a reason", () => {
  // The our-models path: a server-locale result never reaches the browser, so
  // there is no payload to read an error out of. That must not throw.
  const noPayload: TraceEntry = {
    id: "t3",
    name: "get_verdict",
    locale: "server",
    outcome: "transient",
    durationMs: 120,
  };
  const md = toMarkdown(conversation([noPayload]));
  assert.match(md, /`get_verdict` — transient \(120ms\)/);
  assert.ok(!md.includes("reason"));
});
