import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDERS,
  PROVIDER_IDS,
  adapterFor,
  assertProviderUrl,
  listModels,
  toGeminiSchema,
  type CanonicalBlock,
  type CanonicalMessage,
  type ProviderRequest,
  type TurnRequest,
} from "../lib/agent/providers";

/**
 * BYOK provider adapters.
 *
 * Everything here is offline and key-free by construction: the adapters are
 * pure functions plus one injectable `fetch`. That is the reason the canonical
 * shape is Anthropic's and translation happens at the browser edge — the whole
 * translation layer is testable without a provider account.
 *
 * What these tests CANNOT establish is whether the provider accepts the body
 * we build. The shapes come from documentation, not from captured responses.
 * Treat a green run as "we translate consistently", not "this works".
 */

const TOOLS = [
  {
    name: "get_latest_verdict",
    description: "The most recent canonical Verdict recorded for a token address.",
    input_schema: {
      type: "object",
      properties: {
        address: {
          type: "string",
          pattern: "^0x[a-fA-F0-9]{40}$",
          description: "A Robinhood Chain address (0x + 40 hex).",
        },
      },
      additionalProperties: false,
      required: ["address"],
    },
  },
  {
    name: "get_indicted_stats",
    description: "Aggregate Wanted Board figures.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

/** A transcript mid-tool-loop: question, tool call, tool result. */
const MESSAGES: CanonicalMessage[] = [
  { role: "user", content: "Is 0xabc safe?" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check the record." },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "get_latest_verdict",
        input: { address: "0xabc" },
      },
    ],
  },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: '{"ok":true,"found":true,"value":{"score":72}}',
      },
    ],
  },
];

const TURN: TurnRequest = {
  model: "test-model",
  maxTokens: 2048,
  system: [
    { text: "STATIC KNOWLEDGE", cacheable: true },
    { text: "PERSONA PROMPT", cacheable: false },
  ],
  tools: TOOLS,
  messages: MESSAGES,
};

function bodyOf(request: ProviderRequest): Record<string, any> {
  return request.body as Record<string, any>;
}

// ── Destination pinning ─────────────────────────────────────────────────────

test("a key is only ever sent to the provider's own origin", () => {
  // The most sensitive value in the page. Every URL in the adapter file is a
  // literal, so this can only fire on a code change — which is the point: it
  // makes "let the endpoint be configurable" a decision someone takes on
  // purpose rather than a convenience that turns the key into an exfil target.
  assert.doesNotThrow(() =>
    assertProviderUrl("anthropic", "https://api.anthropic.com/v1/messages")
  );
  assert.throws(() => assertProviderUrl("anthropic", "https://evil.example.com/v1/messages"));
  assert.throws(() => assertProviderUrl("openai", "https://api.anthropic.com/v1/models"));
  assert.throws(() => assertProviderUrl("gemini", "http://generativelanguage.googleapis.com/x"));
});

test("every adapter builds a request pointed at its own host, with the key in a header", () => {
  for (const id of PROVIDER_IDS) {
    const request = PROVIDERS[id].buildRequest(TURN, "sk-test-key");
    assert.doesNotThrow(() => assertProviderUrl(id, request.url), `${id} url`);

    // Never in the query string: those land in proxy logs and Referer headers.
    // Every provider here accepts a header, so there is no reason to.
    assert.ok(!request.url.includes("sk-test-key"), `${id} put the key in the URL`);
    const headers = JSON.stringify(request.headers);
    assert.ok(headers.includes("sk-test-key"), `${id} did not send the key at all`);
  }
});

// ── Anthropic ───────────────────────────────────────────────────────────────

test("anthropic gets the browser gate header and the cache breakpoint", () => {
  const request = PROVIDERS.anthropic.buildRequest(TURN, "k");
  // Without this header the API answers `400 Disallowed CORS origin`. It is
  // presence-checked, not value-checked, and documented only in SDK source.
  assert.equal(request.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");

  const system = bodyOf(request).system;
  assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
  assert.equal(system[1].cache_control, undefined, "the volatile block must not be cached");
});

test("anthropic passes the canonical transcript through, translating nothing", () => {
  // It is the canonical shape, so any translation here would be a bug. The one
  // thing it does do is strip provider-opaque keys — see the next test.
  assert.deepEqual(bodyOf(PROVIDERS.anthropic.buildRequest(TURN, "k")).messages, MESSAGES);
});

test("anthropic strips a gemini signature so a transcript stays portable", () => {
  // Anthropic validates block shape rather than ignoring unknown keys, so a
  // conversation started on Gemini and continued after the user switched
  // providers would 400 on every turn after the first tool call — visible only
  // to people mid-conversation, at the moment they changed a dropdown.
  const carried: CanonicalMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "get_latest_verdict",
          input: { address: "0xa" },
          signature: "OPAQUE",
        },
      ],
    },
  ];
  const sent = bodyOf(
    PROVIDERS.anthropic.buildRequest({ ...TURN, messages: carried }, "k")
  ).messages as CanonicalMessage[];
  const block = (sent[0].content as CanonicalBlock[])[0];
  assert.equal("signature" in block, false, "an unknown key here is a 400");
  assert.equal(block.type === "tool_use" && block.id, "call_1", "the real fields survive");
});

test("anthropic parses text, tool calls and cache usage", () => {
  const turn = PROVIDERS.anthropic.parseResponse({
    content: [
      { type: "text", text: "Checking." },
      { type: "tool_use", id: "toolu_9", name: "get_latest_verdict", input: { address: "0xa" } },
    ],
    stop_reason: "tool_use",
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 1500,
      cache_creation_input_tokens: 0,
    },
  });
  assert.equal(turn.text, "Checking.");
  assert.deepEqual(turn.toolCalls, [
    { id: "toolu_9", name: "get_latest_verdict", args: { address: "0xa" } },
  ]);
  assert.equal(turn.usage.cacheReadTokens, 1500);
});

// ── OpenAI ──────────────────────────────────────────────────────────────────

test("openai turns a tool result into its own message, keyed to the call", () => {
  // Folded into the user turn instead, this 400s with an error that names
  // neither the tool nor the message.
  const messages = bodyOf(PROVIDERS.openai.buildRequest(TURN, "k")).messages;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[1].role, "user");

  const assistant = messages[2];
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.tool_calls[0].function.name, "get_latest_verdict");
  // Arguments ride as a JSON *string* here, unlike every other provider.
  assert.equal(typeof assistant.tool_calls[0].function.arguments, "string");

  const result = messages[3];
  assert.equal(result.role, "tool");
  assert.equal(result.tool_call_id, "toolu_1");
});

test("openai survives a model emitting malformed tool arguments", () => {
  // A parse exception would kill the turn. An empty object reaches the
  // dispatcher, which validates arguments and answers with something the model
  // can actually act on.
  const turn = PROVIDERS.openai.parseResponse({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [{ id: "call_1", function: { name: "get_verdict", arguments: "{not json" } }],
        },
        finish_reason: "tool_calls",
      },
    ],
  });
  assert.equal(turn.toolCalls.length, 1);
  assert.equal(turn.toolCalls[0].name, "get_verdict");
});

test("openai's model list drops what cannot hold a conversation", async () => {
  const payload = {
    data: [
      { id: "gpt-5" },
      { id: "o3-mini" },
      { id: "text-embedding-3-large" },
      { id: "whisper-1" },
      { id: "dall-e-3" },
      { id: "omni-moderation-latest" },
      { id: "some-future-model" },
    ],
  };
  const result = await listModels("openai", "k", {
    fetch: (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch,
  });
  assert.ok(result.ok);
  const ids = result.models.map((m) => m.id);
  assert.deepEqual(ids, ["gpt-5", "o3-mini", "some-future-model"]);

  // Unrecognised is offered with a warning, never hidden: a model the user is
  // paying for that we silently refuse to show is a support ticket.
  const byId = Object.fromEntries(result.models.map((m) => [m.id, m.toolSupport]));
  assert.equal(byId["gpt-5"], "known");
  assert.equal(byId["some-future-model"], "unverified");
});

// ── Gemini ──────────────────────────────────────────────────────────────────

test("gemini schemas drop the keywords it rejects and keep the constraint in prose", () => {
  // Sent as-is, `additionalProperties` and `pattern` make every tool call 400,
  // with an error that names the schema rather than the tool.
  const schema = toGeminiSchema(TOOLS[0].input_schema)!;
  assert.deepEqual(Object.keys(schema).sort(), ["properties", "required", "type"]);

  const address = (schema.properties as Record<string, any>).address;
  assert.equal(address.pattern, undefined);
  assert.equal(address.additionalProperties, undefined);
  // The constraint is real and the model reads descriptions, so it survives
  // there. The server re-validates it either way.
  assert.match(address.description, /\^0x\[a-fA-F0-9\]\{40\}\$/);
});

test("gemini gets no parameters at all for a no-argument tool", () => {
  // An object schema with an empty property bag is rejected; omission is not.
  assert.equal(toGeminiSchema(TOOLS[1].input_schema), null);
  const declarations = bodyOf(PROVIDERS.gemini.buildRequest(TURN, "k")).tools[0]
    .functionDeclarations;
  const stats = declarations.find((d: any) => d.name === "get_indicted_stats");
  assert.equal("parameters" in stats, false);
});

test("gemini keys a tool result by name, resolved from the transcript", () => {
  // Gemini has no call ids at all, so the only way to answer a call is to look
  // back at the `tool_use` that asked — which only the transcript knows.
  const contents = bodyOf(PROVIDERS.gemini.buildRequest(TURN, "k")).contents;
  assert.equal(contents[1].role, "model", "assistant is spelled `model` here");
  const response = contents[2].parts[0].functionResponse;
  assert.equal(response.name, "get_latest_verdict");
  assert.deepEqual(response.response.result, {
    ok: true,
    found: true,
    value: { score: 72 },
  });
});

// ── Thought signatures and ids ──────────────────────────────────────────────
//
// Both of these were wrong in the first version of this file, and both were
// wrong in the same way: written from the provider docs and never sent to the
// real API. The server-side client met the live endpoint on 2026-08-03 and
// found that (a) a `functionCall` must be replayed with its `thoughtSignature`
// or the NEXT request is a hard 400, and (b) Gemini does return a call id.
// Neither is observable on a single request, which is exactly why they
// survived a full test suite.

test("gemini captures the signature and prefers the model's own call id", () => {
  const turn = PROVIDERS.gemini.parseResponse(
    {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: {
                  name: "get_latest_verdict",
                  args: { address: "0xa" },
                  id: "JnkoJL1N",
                },
                thoughtSignature: "EjQKMgER-opaque",
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 9 },
    },
    { makeId: () => "MINTED" }
  );
  assert.equal(turn.toolCalls[0].id, "JnkoJL1N", "the model's id wins over a minted one");
  assert.equal(turn.toolCalls[0].signature, "EjQKMgER-opaque");
});

test("gemini replays the signature beside the call, never inside it", () => {
  const carried: CanonicalMessage[] = [
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "get_latest_verdict",
          input: { address: "0xa" },
          signature: "OPAQUE",
        },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: "{}" }],
    },
  ];
  const body = bodyOf(PROVIDERS.gemini.buildRequest({ ...TURN, messages: carried }, "k"));
  const parts = (body.contents as { parts: Record<string, any>[] }[])[0].parts;
  assert.equal(parts[0].thoughtSignature, "OPAQUE");
  assert.equal(
    "thoughtSignature" in parts[0].functionCall,
    false,
    "nesting it inside functionCall is the same 400 as omitting it"
  );
  assert.equal(parts[0].functionCall.id, "call_1");

  // The result echoes the id too: name alone is ambiguous once a model calls
  // one tool twice in a turn, and the two results are not interchangeable.
  const result = (body.contents as { parts: Record<string, any>[] }[])[1].parts[0];
  assert.equal(result.functionResponse.id, "call_1");
  assert.equal(result.functionResponse.name, "get_latest_verdict");
});

test("gemini still mints an id when a response carries none", () => {
  // The fallback for any model or API version that omits it. The server matches
  // `client_results` back by `tool_use_id`, so a blank id drops the result.
  let n = 0;
  const turn = PROVIDERS.gemini.parseResponse(
    {
      candidates: [
        {
          content: {
            parts: [
              { text: "Looking." },
              { functionCall: { name: "get_latest_verdict", args: { address: "0xa" } } },
            ],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 9 },
    },
    { makeId: () => `id_${++n}` }
  );
  assert.equal(turn.text, "Looking.");
  assert.deepEqual(turn.toolCalls, [
    { id: "id_1", name: "get_latest_verdict", args: { address: "0xa" } },
  ]);
  assert.equal(turn.usage.inputTokens, 40);
});

test("gemini's model list uses the capability metadata it actually publishes", async () => {
  const payload = {
    models: [
      {
        name: "models/gemini-3-pro",
        displayName: "Gemini 3 Pro",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
      { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      { name: "models/gemini-2.5-flash-tts", supportedGenerationMethods: ["generateContent"] },
    ],
  };
  const result = await listModels("gemini", "k", {
    fetch: (async () => new Response(JSON.stringify(payload), { status: 200 })) as typeof fetch,
  });
  assert.ok(result.ok);
  // `supportedGenerationMethods` excludes the embedding model on its own; the
  // speech model claims generateContent and has to go by name.
  assert.deepEqual(result.models, [
    { id: "gemini-3-pro", label: "Gemini 3 Pro", toolSupport: "known" },
  ]);
});

// ── Failure handling ────────────────────────────────────────────────────────

test("a rejected key is a readable error, never an empty model list", async () => {
  // All three providers send CORS headers on the error path (measured), so the
  // browser can read the reason. "No models" and "we could not ask" are
  // different sentences and the selector must not show the first for the
  // second — the same rule the tool layer follows for verdict reads.
  const result = await listModels("anthropic", "bad-key", {
    fetch: (async () =>
      new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes("401"));
  assert.ok(!result.ok && result.error.includes("invalid x-api-key"));
});

test("an empty key never reaches the network", async () => {
  let called = false;
  const result = await listModels("openai", "   ", {
    fetch: (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("an unknown provider is refused rather than defaulted", () => {
  assert.throws(() => adapterFor("openrouter"));
});

test("the gemini model list offers only models a persona could actually use", async () => {
  // Measured against a live key: `supportedGenerationMethods` alone let through
  // music (Lyria), robotics, image, computer-use, deep-research, an agent
  // product and three Gemma builds — and the mapper stamped every one of them
  // `toolSupport: "known"`. Every persona here calls tools, so picking one of
  // those fails on the user's first question, after they have typed it.
  const listed = [
    { name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash" },
    { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
    { name: "models/gemma-4-31b-it", displayName: "Gemma 4 31B IT" },
    { name: "models/lyria-3-pro-preview", displayName: "Lyria 3 Pro Preview" },
    { name: "models/gemini-robotics-er-2-preview", displayName: "Gemini Robotics-ER 2" },
    { name: "models/gemini-2.5-computer-use-preview", displayName: "Computer Use" },
    { name: "models/deep-research-pro-preview", displayName: "Deep Research Pro" },
    { name: "models/nano-banana-pro", displayName: "Nano Banana Pro" },
    { name: "models/antigravity-agent-preview", displayName: "Antigravity Agent" },
    { name: "models/text-embedding-004", displayName: "Embedding" },
  ].map((m) => ({ ...m, supportedGenerationMethods: ["generateContent"] }));

  const models = await PROVIDERS.gemini.listModels("k", {
    fetch: (async () =>
      new Response(JSON.stringify({ models: listed }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
  });

  const ids = models.map((m) => m.id);
  assert.deepEqual(ids, ["gemini-3.5-flash", "gemini-2.5-pro"]);
  // And what survives is claimed as tool-capable only because it matched the
  // positive pattern — an unrecognised future family must warn, not vouch.
  assert.ok(models.every((m) => m.toolSupport === "known"));
});

test("an unrecognised gemini family is offered as unverified, never as known", async () => {
  const models = await PROVIDERS.gemini.listModels("k", {
    fetch: (async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/geminix-1-preview",
              displayName: "GeminiX",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )) as typeof fetch,
  });
  assert.equal(models[0]?.toolSupport, "unverified");
});
