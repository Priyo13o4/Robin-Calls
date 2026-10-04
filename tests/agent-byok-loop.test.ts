import test from "node:test";
import assert from "node:assert/strict";

import { runByokTurn } from "../lib/agent/runner";
import type { PersonaBundle } from "../lib/agent/types";

/**
 * The BYOK loop.
 *
 * **BYOK is a second code path, not a flag on the first one.** The entire agent
 * loop runs in the browser: model calls, tool dispatch, the per-turn budget,
 * history trimming and citation validation. `/agent/chat` is never called, and
 * the first test below is there to keep it that way — a "unification" that
 * quietly routes BYOK through the server would send the user's conversation to
 * an endpoint it is specifically designed never to reach.
 *
 * Offline by construction: `fetch` is stubbed, no key, no network. Only
 * server-locale tools are exercised, so no viem transport is involved either.
 */

const BUNDLE: PersonaBundle = {
  name: "interrogator",
  title: "The Interrogator",
  promptVersion: "2",
  system: [
    { text: "core knowledge", cacheable: true },
    { text: "persona prompt", cacheable: false },
  ],
  tools: [
    {
      name: "get_latest_verdict",
      description: "The most recent verdict for a token.",
      input_schema: {
        type: "object",
        properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
        required: ["address"],
        additionalProperties: false,
      },
      locale: "server",
    },
  ],
};

const RPC = { chainId: 4663, endpoints: ["https://rpc.example.test"], maxBlockLag: 200 };

const SETTINGS = { provider: "gemini" as const, model: "gemini-3.5-flash-lite", apiKey: "test-key" };

interface Call {
  url: string;
  body: Record<string, unknown>;
}

/** Serve canned provider/tool responses and record every request made. */
function harness(providerBodies: unknown[], toolPayloads: unknown[] = []) {
  const calls: Call[] = [];
  let providerIndex = 0;
  let toolIndex = 0;

  const impl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: String(url), body });

    if (String(url).includes("/agent/tool")) {
      const payload = toolPayloads[toolIndex] ?? { ok: true, found: true, value: {} };
      toolIndex += 1;
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    const payload = providerBodies[providerIndex] ?? {};
    providerIndex += 1;
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  return { calls, impl };
}

async function run(
  impl: typeof globalThis.fetch,
  overrides: Partial<Parameters<typeof runByokTurn>[0]> = {}
) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await runByokTurn({
      persona: "interrogator",
      bundle: BUNDLE,
      settings: SETTINGS,
      transcript: [],
      userText: "Why is this what it is?",
      rpc: RPC,
      maxToolCalls: 8,
      ...overrides,
    });
  } finally {
    globalThis.fetch = original;
  }
}

/** A Gemini turn that asks for one tool, carrying a thought signature. */
function geminiToolCall(signature: string | null) {
  return {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: {
                name: "get_latest_verdict",
                args: { address: "0x" + "a".repeat(40) },
                id: "JnkoJL1N",
              },
              ...(signature ? { thoughtSignature: signature } : {}),
            },
          ],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 4193, candidatesTokenCount: 12 },
  };
}

function geminiText(text: string) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 4500, candidatesTokenCount: 60 },
  };
}

test("BYOK never calls /agent/chat", async () => {
  const { calls, impl } = harness([geminiText("The record says nothing further.")]);
  await run(impl);

  assert.equal(
    calls.filter((c) => c.url.includes("/agent/chat")).length,
    0,
    "the browser owns this loop; the chat endpoint must not be touched"
  );
});

test("Gemini's thoughtSignature is replayed beside the functionCall on the next request", async () => {
  // Measured live 2026-08-03: the FIRST request always succeeds, and the next
  // one hard-400s when the signature is missing. Only a multi-turn exchange
  // surfaces it, which is exactly why it needs a test.
  const { calls, impl } = harness(
    [geminiToolCall("sig-abc123"), geminiText("The verdict is on record.")],
    [{ ok: true, found: true, value: { id: 4187 } }]
  );
  await run(impl);

  const secondProviderCall = calls.filter((c) => c.url.includes("generativelanguage"))[1];
  const parts = (secondProviderCall.body.contents as Array<{ parts: Record<string, unknown>[] }>)
    .flatMap((c) => c.parts)
    .filter((p) => "functionCall" in p);

  assert.equal(parts.length, 1);
  assert.equal(
    parts[0].thoughtSignature,
    "sig-abc123",
    "a sibling of functionCall, not a field inside it"
  );
});

test("the model's own tool-call id is preferred, and results match back to it", async () => {
  const { calls, impl } = harness(
    [geminiToolCall("sig"), geminiText("Done.")],
    [{ ok: true, found: true, value: { id: 4187 } }]
  );
  const result = await run(impl);

  assert.equal(result.trace[0].id, "JnkoJL1N");
  const second = calls.filter((c) => c.url.includes("generativelanguage"))[1];
  const responses = (second.body.contents as Array<{ parts: Record<string, unknown>[] }>)
    .flatMap((c) => c.parts)
    .filter((p) => "functionResponse" in p)
    .map((p) => p.functionResponse as Record<string, unknown>);

  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, "JnkoJL1N");
  assert.equal(responses[0].name, "get_latest_verdict");
});

test("every server-locale tool call carries the persona", async () => {
  // Without it the dispatcher's allowlist is skipped entirely, and `scan_token`
  // would be one anonymous POST away (`authorize`: absence is a refusal).
  const { calls, impl } = harness(
    [geminiToolCall("sig"), geminiText("Done.")],
    [{ ok: true, found: true, value: {} }]
  );
  await run(impl);

  const toolCall = calls.find((c) => c.url.includes("/agent/tool"));
  assert.ok(toolCall);
  assert.equal(toolCall.body.persona, "interrogator");
  assert.equal(toolCall.body.name, "get_latest_verdict");
});

test("the tool-call cap is enforced in the browser, and forces a final answer", async () => {
  const { calls, impl } = harness(
    [geminiToolCall("s1"), geminiToolCall("s2"), geminiText("What I could not check: the rest.")],
    [{ ok: true, found: true, value: { id: 4187 } }]
  );
  const result = await run(impl, { maxToolCalls: 1 });

  assert.equal(
    calls.filter((c) => c.url.includes("/agent/tool")).length,
    1,
    "the second call never left the browser"
  );
  assert.equal(result.trace[1].outcome, "failed");
  assert.equal(result.trace[1].payload?.code, "RC_AGENT_TOOL_BUDGET");
  assert.ok(result.notices.some((n) => n.code === "RC_AGENT_TOOL_BUDGET"));

  // Tools are withdrawn for the forced final round rather than the loop being
  // allowed to keep spending the user's provider quota.
  const last = calls.filter((c) => c.url.includes("generativelanguage")).at(-1);
  assert.equal(last?.body.tools, undefined);
});

test("an invented number is stripped in the browser, and the sentences come back", async () => {
  const { impl } = harness(
    [geminiToolCall("sig"), geminiText("The score is 91. Roughly 61% of supply is in ten wallets.")],
    [{ ok: true, found: true, value: { score: 91 } }]
  );
  const result = await run(impl);

  assert.equal(result.text, "The score is 91.");
  assert.equal(result.strippedClaims, 1);
  assert.deepEqual(result.strippedText, ["Roughly 61% of supply is in ten wallets."]);
});

test("a transient tool fault makes the turn non-billable and never a finding", async () => {
  const failing = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/agent/tool")) {
      return new Response(JSON.stringify({ error: "upstream timed out" }), { status: 503 });
    }
    const body = init ? geminiToolCall("sig") : geminiText("");
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  let providerCalls = 0;
  const impl = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/agent/tool")) return failing(url, init);
    providerCalls += 1;
    const payload = providerCalls === 1 ? geminiToolCall("sig") : geminiText("The lookup did not complete.");
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const result = await run(impl);

  assert.equal(result.billable, false, "the user must not pay for our outage");
  assert.equal(result.trace[0].outcome, "transient");
  assert.equal(result.trace[0].payload?.transient, true);
});

test("a denied tool is a payload the model can act on, not a dead turn", async () => {
  // The allowlist holding is a normal outcome — the model can usually answer
  // another way — so it comes back as a result, not as a thrown turn. And it is
  // NOT transient: a refusal is an answer about permissions, and billing it as
  // an outage or retrying it would both be wrong.
  const { impl } = harness(
    [geminiToolCall("sig"), geminiText("I cannot run a fresh scan as this persona.")],
    [{ error: "persona 'interrogator' may not call 'scan_token'" }]
  );

  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const response = await impl(url as string, init);
    if (String(url).includes("/agent/tool")) {
      return new Response(await response.text(), { status: 403 });
    }
    return response;
  }) as unknown as typeof globalThis.fetch;

  let result;
  try {
    result = await runByokTurn({
      persona: "interrogator",
      bundle: BUNDLE,
      settings: SETTINGS,
      transcript: [],
      userText: "Scan this now.",
      rpc: RPC,
      maxToolCalls: 8,
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(result.trace[0].outcome, "denied");
  assert.equal(result.trace[0].payload?.code, "RC_AGENT_TOOL_DENIED");
  assert.equal(result.trace[0].payload?.transient, false, "a refusal is an answer, not an outage");
  assert.equal(result.billable, true);
  assert.equal(result.error, undefined);
  assert.match(result.text, /cannot run a fresh scan/);
});

test("a failed turn leaves the stored transcript untouched", async () => {
  // Otherwise the next turn replays an unanswered `tool_use` and 400s forever.
  const impl = (async () =>
    new Response("model overloaded", { status: 503 })) as unknown as typeof globalThis.fetch;

  const prior = [{ role: "user" as const, content: "earlier question" }];
  const result = await run(impl, { transcript: prior });

  assert.equal(result.transcript, prior);
  assert.equal(result.error?.transient, true);
  assert.equal(result.billable, false);
});

test("the stored transcript keeps the full history, not the trimmed view", async () => {
  // Trimming decides what the model sees this turn, not what the conversation
  // is. Storing the trimmed copy would make every trim permanent and compounding.
  const { impl } = harness([geminiText("Noted.")]);
  const prior = [
    { role: "user" as const, content: "q1" },
    { role: "assistant" as const, content: "a1" },
  ];
  const result = await run(impl, { transcript: prior, maxHistoryTokens: 1 });

  assert.equal(result.historyDropped > 0, true);
  assert.equal(result.transcript.length, 4, "q1, a1, the new question, the new answer");
  assert.equal(result.transcript[0].content, "q1");
});

// ── The interrupted-turn class ──────────────────────────────────────────────
//
// Three bugs, one shape: a turn that was stopped or could not be read was
// presented and stored as a turn that succeeded. The worst of them permanently
// bricked a conversation — an assistant message with an empty text block is a
// hard 400 on Anthropic for EVERY later turn, with no way back from the UI.

test("a stopped turn leaves the transcript untouched and is flagged, not errored", async () => {
  const controller = new AbortController();
  const impl = (async () => {
    controller.abort();
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }) as unknown as typeof globalThis.fetch;

  const prior = [{ role: "user" as const, content: "an earlier question" }];
  const result = await run(impl, { transcript: prior, signal: controller.signal });

  assert.equal(result.aborted, true);
  assert.equal(result.error, undefined, "a stop is not a failure");
  assert.equal(result.text, "");
  assert.equal(result.transcript, prior, "nothing may be appended for an unanswered turn");
});

test("a turn that ends with no text stores nothing, rather than an empty block", async () => {
  // Anthropic rejects `{type:"text", text:""}` and rejects it on every
  // subsequent turn; Gemini silently drops the message. Neither is survivable
  // as stored state.
  const { impl } = harness([geminiText("")]);
  const prior = [{ role: "user" as const, content: "q1" }];
  const result = await run(impl, { transcript: prior });

  assert.equal(result.transcript, prior);
  for (const message of result.transcript) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        assert.notEqual(block.type === "text" && block.text, "", "empty text block stored");
      }
    }
  }
});

test("a 200 whose body cannot be read is an outage, never an empty record", async () => {
  const impl = (async (url: string) => {
    if (String(url).includes("/agent/tool")) {
      // A truncated or proxy-mangled body. `{}` would render NOTHING ON RECORD.
      return new Response("{\"ok\": tru", { status: 200 });
    }
    return new Response(JSON.stringify(geminiToolCall("sig")), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  let first = true;
  const stubbed = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/agent/tool")) return impl(url, init);
    if (first) {
      first = false;
      return impl(url, init);
    }
    return new Response(JSON.stringify(geminiText("The lookup did not complete.")), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const result = await run(stubbed);

  assert.equal(result.trace[0].outcome, "transient", "not 'empty' — nothing was read");
  assert.equal(result.trace[0].payload?.transient, true);
  assert.equal(result.billable, false);
});

test("a 429 from the record is an outage, not a finding about the token", async () => {
  // nginx rate-limits /agent/ at the edge. A budget we imposed is not a fact
  // about anyone's token, and must not wear the hazard stripe.
  const impl = (async (url: string) => {
    if (String(url).includes("/agent/tool")) {
      return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
    }
    return new Response(JSON.stringify(geminiToolCall("sig")), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  let first = true;
  const stubbed = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/agent/tool")) return impl(url, init);
    if (first) {
      first = false;
      return impl(url, init);
    }
    return new Response(JSON.stringify(geminiText("Could not check.")), { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  const result = await run(stubbed);
  assert.equal(result.trace[0].outcome, "transient");
  assert.equal(result.billable, false, "the user must not pay for our rate limit");
});
