"use client";

/**
 * BYOK provider adapters — model discovery and wire-format translation.
 *
 * The browser runs the BYOK loop against the user's own provider with the
 * user's own key. This file is what makes "the user's own provider" mean more
 * than Anthropic.
 *
 * ── The canonical shape is Anthropic's, deliberately ────────────────────────
 *
 * `/agent/persona/{name}` serves tool specs as `input_schema`, `chat.py`
 * exchanges `tool_use` / `tool_result` blocks, and `history.py` refuses to trim
 * a transcript in a way that splits one from the other. That contract is built,
 * tested and running, and it is the shape the our-models path speaks natively.
 *
 * So translation happens **here, at the browser edge**, and nothing
 * server-side learns that other providers exist. Each adapter is a pure pair —
 * canonical in, provider wire out; provider wire in, canonical out — which
 * also makes the whole thing testable without a key or a network.
 *
 * ── Rules about the key ─────────────────────────────────────────────────────
 *
 * 1. **We never see it.** It stays in the browser, is never sent to our origin,
 *    never logged, never put in a URL (query strings land in proxy logs and
 *    `Referer` headers — every provider here accepts a header instead).
 * 2. **The destination is a hardcoded constant, never configuration.** A key is
 *    the most sensitive value in the page, and an endpoint that arrives from a
 *    response is an endpoint an attacker can aim. `assertProviderUrl` refuses
 *    any host that is not the provider's own. Same argument as
 *    `assertKeylessEndpoint` in `client-tools.ts`, one severity higher: there
 *    the risk is reading the wrong chain, here it is handing someone a
 *    credential.
 *
 * ── What has NOT been verified ──────────────────────────────────────────────
 *
 * The CORS transport is measured: all three `/models` endpoints preflight from
 * `https://robincalls.com`, and all three return CORS headers on the error path
 * too, so a bad key is a readable 401 rather than an opaque network failure.
 *
 * The response *bodies* below are built from provider documentation, not from
 * captured live responses — nobody has run this against a real key. The parsers
 * are therefore written to tolerate missing fields rather than assume them, and
 * the first real call is expected to correct something here. Do not treat these
 * shapes as confirmed until a live turn has completed.
 */

export type ProviderId = "anthropic" | "openai" | "gemini";

/** A model the user may pick, normalized across providers. */
export interface ModelOption {
  id: string;
  label: string;
  /**
   * Whether this model is known to support tool use.
   *
   * Every persona here needs tools; a model without them fails on the first
   * call, in front of the user, after they have already typed a question. No
   * provider's model list reports tool support, so this is our judgement and
   * the UI should surface `"unverified"` as a warning rather than hiding it.
   */
  toolSupport: "known" | "unverified";
}

export interface SystemBlock {
  text: string;
  cacheable: boolean;
}

export interface CanonicalTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type CanonicalBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
      /** See `CanonicalToolCall.signature`. Lives on the block so it survives the transcript. */
      signature?: string;
    }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface CanonicalMessage {
  role: "user" | "assistant";
  content: string | CanonicalBlock[];
}

export interface CanonicalToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /**
   * Opaque provider continuation state, echoed back verbatim or the provider
   * refuses the NEXT request.
   *
   * Gemini 3.x returns an encrypted `thoughtSignature` alongside every
   * `functionCall`; replaying that call without it is a hard 400 — "Function
   * call is missing a thought_signature in functionCall parts". Measured
   * server-side on 2026-08-03, where the first turn succeeded and the second
   * failed: the requirement does not exist on a single request, so only a real
   * multi-turn conversation surfaces it.
   *
   * Anthropic has no equivalent and rejects unknown keys on a `tool_use` block,
   * so its adapter strips this — a transcript stays portable between providers.
   */
  signature?: string;
}

export interface CanonicalUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** What one provider round trip produced, in the shape the server expects back. */
export interface CanonicalTurn {
  text: string;
  toolCalls: CanonicalToolCall[];
  stopReason: string | null;
  usage: CanonicalUsage;
}

export interface TurnRequest {
  model: string;
  maxTokens: number;
  system: SystemBlock[];
  tools: CanonicalTool[];
  messages: CanonicalMessage[];
}

/** A `fetch`-ready request. Headers carry the key; nothing here is logged. */
export interface ProviderRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface AdapterDeps {
  /** Injectable for tests. Defaults to the real one. */
  fetch?: typeof globalThis.fetch;
  /**
   * Ids for providers that do not supply them (Gemini). Only needs to be
   * unique within one transcript; injectable so tests stay deterministic.
   */
  makeId?: () => string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** Where the user gets a key. Shown in the empty state, not fetched. */
  consoleUrl: string;
  listModels(apiKey: string, deps?: AdapterDeps): Promise<ModelOption[]>;
  buildRequest(input: TurnRequest, apiKey: string, deps?: AdapterDeps): ProviderRequest;
  parseResponse(payload: unknown, deps?: AdapterDeps): CanonicalTurn;
}

// ── Destination pinning ─────────────────────────────────────────────────────

const PROVIDER_HOSTS: Record<ProviderId, string> = {
  anthropic: "api.anthropic.com",
  openai: "api.openai.com",
  gemini: "generativelanguage.googleapis.com",
};

/**
 * Refuse to send a key anywhere but the provider's own origin.
 *
 * Every URL in this file is a literal, so today this can only fire on a code
 * change. That is the point: it is here so that "make the endpoint
 * configurable" is a decision someone has to make on purpose, in a diff, next
 * to this comment — rather than a convenience that quietly turns the key into
 * an exfiltration target.
 */
export function assertProviderUrl(provider: ProviderId, url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing to send a ${provider} key over ${parsed.protocol}`);
  }
  if (parsed.hostname !== PROVIDER_HOSTS[provider]) {
    throw new Error(
      `Refusing to send a ${provider} key to ${parsed.hostname}; expected ${PROVIDER_HOSTS[provider]}`
    );
  }
  return url;
}

async function getJson(
  url: string,
  headers: Record<string, string>,
  deps: AdapterDeps | undefined,
  provider: ProviderId
): Promise<unknown> {
  const doFetch = deps?.fetch ?? globalThis.fetch;
  const response = await doFetch(assertProviderUrl(provider, url), { headers });
  if (!response.ok) {
    // Readable because all three send CORS headers on errors too (measured).
    // The provider's own message is far more useful than anything we could
    // invent — "your key does not have access to this model" versus "failed".
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${provider} rejected the model list (${response.status}). ${trimDetail(detail)}`.trim()
    );
  }
  return response.json();
}

function trimDetail(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length > 300 ? `${flat.slice(0, 300)}…` : flat;
}

// ── Schema translation ──────────────────────────────────────────────────────

/**
 * Strip a JSON Schema down to the OpenAPI subset Gemini accepts.
 *
 * Gemini's `Schema` rejects keywords it does not know rather than ignoring
 * them, and our generated schemas carry two it does not: `additionalProperties`
 * (on every tool) and `pattern` (on every address argument). Sent as-is, every
 * single tool call 400s — and the error names the schema, not the tool, so it
 * reads like a bug in the request builder.
 *
 * `pattern` is not merely dropped. The constraint it encodes is real, and the
 * server re-validates it (`reads.ts` throws `BadReadRequest` on a malformed
 * address), so losing it costs a round trip rather than correctness — but a
 * model that never sees the shape guesses more. It is folded into the
 * description instead, where Gemini does read it.
 */
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties || Object.keys(properties).length === 0) {
    // A no-argument tool: Gemini wants `parameters` omitted entirely, not an
    // object schema with an empty property bag.
    return null;
  }

  const mapped: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(properties)) {
    const { pattern, additionalProperties: _drop, ...rest } = spec;
    const description = [
      typeof rest.description === "string" ? rest.description : "",
      typeof pattern === "string" ? `Must match the pattern ${pattern}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    mapped[name] = description ? { ...rest, description } : rest;
  }

  const out: Record<string, unknown> = { type: "object", properties: mapped };
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    out.required = schema.required;
  }
  return out;
}

// ── Message translation helpers ─────────────────────────────────────────────

function blocksOf(message: CanonicalMessage): CanonicalBlock[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content;
}

function joinSystem(system: SystemBlock[]): string {
  return system.map((b) => b.text).join("\n\n");
}

/**
 * `tool_use_id` → tool name, harvested from the transcript.
 *
 * Gemini's `functionResponse` is keyed by NAME; it has no notion of a call id
 * at all. So resuming a Gemini conversation means looking back at the
 * `tool_use` that asked, which only the transcript knows.
 */
function toolNamesById(messages: CanonicalMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    for (const block of blocksOf(message)) {
      if (block.type === "tool_use") names.set(block.id, block.name);
    }
  }
  return names;
}

function parseJsonish(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Drop provider-opaque keys a transcript picked up under a different provider.
 *
 * `signature` (Gemini's `thoughtSignature`) rides on `tool_use` blocks because
 * the transcript is the only thing that survives between turns. Anthropic
 * validates block shape rather than ignoring unknown keys, so a conversation
 * started on Gemini and continued after the user switched providers would 400
 * on every subsequent turn — visible only to people mid-conversation, at the
 * moment they changed a dropdown. Mirrors `_strip_foreign_keys` in
 * `services/agent/app/llm/anthropic.py`.
 */
export function stripForeignKeys(messages: CanonicalMessage[]): CanonicalMessage[] {
  return messages.map((message) => {
    if (typeof message.content === "string") return message;
    return {
      ...message,
      content: message.content.map((block) => {
        if (block.type !== "tool_use") return block;
        const { signature: _dropped, ...rest } = block;
        return rest;
      }),
    };
  });
}

// ── Anthropic ───────────────────────────────────────────────────────────────

const ANTHROPIC_VERSION = "2023-06-01";

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    // A HARD GATE, not a hint: without it the API answers
    // `400 Disallowed CORS origin`. It is presence-checked, not value-checked,
    // and it is documented only in the SDK source — which is why it is set
    // explicitly here rather than assumed.
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  consoleUrl: "https://console.anthropic.com/settings/keys",

  async listModels(apiKey, deps) {
    const payload = (await getJson(
      "https://api.anthropic.com/v1/models?limit=100",
      anthropicHeaders(apiKey),
      deps,
      "anthropic"
    )) as { data?: { id?: string; display_name?: string }[] };

    // No filtering. Every model this endpoint returns is a chat model and
    // supports tools, which is the exception among the three.
    return (payload.data ?? [])
      .filter((m): m is { id: string; display_name?: string } => typeof m.id === "string")
      .map((m) => ({
        id: m.id,
        label: m.display_name || m.id,
        toolSupport: "known" as const,
      }));
  },

  buildRequest(input, apiKey) {
    return {
      url: assertProviderUrl("anthropic", "https://api.anthropic.com/v1/messages"),
      headers: anthropicHeaders(apiKey),
      body: {
        model: input.model,
        max_tokens: input.maxTokens,
        // The cache breakpoint, mirroring `llm.py`. Under BYOK each user is
        // their own organization and so their own cache, which is why the
        // static block is small and the check explainers are a tool instead —
        // a large shared prefix would be re-written per user and amortized by
        // nobody.
        system: input.system.map((block) =>
          block.cacheable
            ? { type: "text", text: block.text, cache_control: { type: "ephemeral" } }
            : { type: "text", text: block.text }
        ),
        tools: input.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        })),
        messages: stripForeignKeys(input.messages),
      },
    };
  },

  parseResponse(payload) {
    const response = payload as {
      content?: { type?: string; text?: string; id?: string; name?: string; input?: unknown }[];
      stop_reason?: string;
      usage?: Record<string, number>;
    };
    const text: string[] = [];
    const toolCalls: CanonicalToolCall[] = [];

    for (const block of response.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") text.push(block.text);
      if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          args: (block.input as Record<string, unknown>) ?? {},
        });
      }
    }

    const usage = response.usage ?? {};
    return {
      text: text.join(""),
      toolCalls,
      stopReason: response.stop_reason ?? null,
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};

// ── OpenAI ──────────────────────────────────────────────────────────────────

/**
 * `GET /v1/models` returns every model the key can reach — embeddings, audio,
 * image, moderation — with no `object` distinction useful for filtering and no
 * capability metadata whatsoever. So this is a heuristic, and it is written to
 * fail in the safe direction: an unrecognised id is offered as `"unverified"`
 * rather than hidden, because a hidden model the user is paying for is a
 * support ticket, while a warned one is a choice.
 *
 * The denylist is the load-bearing half. It only has to recognise families
 * that definitively cannot hold a conversation, which changes far more slowly
 * than the chat lineup does.
 */
const OPENAI_NON_CHAT = /(embedding|whisper|tts|audio|dall-e|moderation|image|transcribe|realtime|search|davinci|babbage|curie|ada)/i;
const OPENAI_KNOWN_CHAT = /^(gpt-[45]|gpt-4o|o[1-4]($|-)|chatgpt-)/i;

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  label: "OpenAI",
  consoleUrl: "https://platform.openai.com/api-keys",

  async listModels(apiKey, deps) {
    const payload = (await getJson(
      "https://api.openai.com/v1/models",
      { authorization: `Bearer ${apiKey}` },
      deps,
      "openai"
    )) as { data?: { id?: string }[] };

    return (payload.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && !OPENAI_NON_CHAT.test(id))
      .sort()
      .map((id) => ({
        id,
        label: id,
        toolSupport: OPENAI_KNOWN_CHAT.test(id) ? ("known" as const) : ("unverified" as const),
      }));
  },

  buildRequest(input, apiKey) {
    // Chat Completions rather than Responses: it is the format every
    // OpenAI-compatible endpoint speaks, so a user pointing a BYOK key at a
    // compatible gateway keeps working. Nothing this agent does needs
    // Responses-only features.
    const messages: Record<string, unknown>[] = [
      { role: "system", content: joinSystem(input.system) },
    ];

    for (const message of input.messages) {
      const blocks = blocksOf(message);
      const text = blocks
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (message.role === "assistant") {
        const calls = blocks.filter((b) => b.type === "tool_use");
        messages.push({
          role: "assistant",
          content: text || null,
          ...(calls.length
            ? {
                tool_calls: calls.map((b) => ({
                  id: b.id,
                  type: "function",
                  function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
                })),
              }
            : {}),
        });
        continue;
      }

      // A tool result is its OWN message here, not a block inside a user turn —
      // one per result, each keyed to the call it answers. Folding them into
      // the user message instead produces a 400 that names neither.
      const results = blocks.filter((b) => b.type === "tool_result");
      for (const block of results) {
        messages.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: block.content,
        });
      }
      if (text || results.length === 0) messages.push({ role: "user", content: text });
    }

    return {
      url: assertProviderUrl("openai", "https://api.openai.com/v1/chat/completions"),
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: {
        model: input.model,
        max_completion_tokens: input.maxTokens,
        messages,
        ...(input.tools.length
          ? {
              tools: input.tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.input_schema,
                },
              })),
            }
          : {}),
      },
    };
  },

  parseResponse(payload) {
    const response = payload as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: Record<string, number | Record<string, number>>;
    };
    const choice = response.choices?.[0];
    const message = choice?.message ?? {};

    const toolCalls: CanonicalToolCall[] = (message.tool_calls ?? [])
      .filter((c) => c.id && c.function?.name)
      .map((c) => ({
        id: c.id as string,
        name: c.function?.name as string,
        // `arguments` is a JSON *string*, and a model can emit a malformed one.
        // An empty object beats throwing: the dispatcher validates arguments
        // anyway and will answer with a usable error the model can act on,
        // where a parse exception kills the whole turn.
        args: (parseJsonish(c.function?.arguments ?? "{}") as Record<string, unknown>) ?? {},
      }));

    const usage = (response.usage ?? {}) as Record<string, number> & {
      prompt_tokens_details?: { cached_tokens?: number };
    };
    return {
      text: message.content ?? "",
      toolCalls,
      stopReason: choice?.finish_reason ?? null,
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        // OpenAI caches automatically and reports reads only. There is no
        // write figure because there is no write step to pay for.
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
    };
  },
};

// ── Gemini ──────────────────────────────────────────────────────────────────

/**
 * The only one of the three whose model list carries capability metadata:
 * `supportedGenerationMethods` reliably excludes embedding and retrieval
 * models. It does not distinguish a text model from an image, speech, music,
 * robotics or agent-product one that also implements `generateContent`, so
 * those are excluded by name.
 *
 * Measured against a live key: the surviving list still offered Lyria (music),
 * Gemini Robotics-ER, Nano Banana Pro (image), Computer Use, Deep Research,
 * Antigravity Agent and three Gemma builds — every one of them presented as
 * tool-capable, because the mapper below hardcoded `toolSupport: "known"` for
 * anything that got this far. A user picking one gets a failure on their first
 * question, after typing it.
 *
 * Gemma is the subtle entry: it is a real text model and it does answer
 * `generateContent`, but it does not implement function calling on this API at
 * all. Every persona here needs tools, so it cannot be offered as a choice.
 */
const GEMINI_NON_CHAT =
  /(embedding|aqa|image|imagen|tts|audio|veo|native-audio|lyria|robotics|computer-use|deep-?research|nano-banana|antigravity|^gemma)/i;

/**
 * Which surviving models we are willing to CLAIM support tools.
 *
 * Deliberately a positive pattern with an "unverified" fallback rather than a
 * denylist: a family Google ships next year is unknown to this file, and the
 * honest default for something we have never seen is a warning, not a promise.
 * `ModelOption.toolSupport` exists precisely so the UI can say "we could not
 * confirm this" instead of hiding or vouching.
 */
const GEMINI_TOOL_CAPABLE = /^gemini-\d/i;

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  label: "Google Gemini",
  consoleUrl: "https://aistudio.google.com/apikey",

  async listModels(apiKey, deps) {
    const payload = (await getJson(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
      { "x-goog-api-key": apiKey },
      deps,
      "gemini"
    )) as {
      models?: {
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }[];
    };

    return (payload.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => ({ raw: m, id: (m.name ?? "").replace(/^models\//, "") }))
      .filter(({ id }) => id && !GEMINI_NON_CHAT.test(id))
      .map(({ raw, id }) => ({
        id,
        label: raw.displayName || id,
        toolSupport: GEMINI_TOOL_CAPABLE.test(id)
          ? ("known" as const)
          : ("unverified" as const),
      }));
  },

  buildRequest(input, apiKey) {
    const names = toolNamesById(input.messages);
    const contents: Record<string, unknown>[] = [];

    for (const message of input.messages) {
      const parts: Record<string, unknown>[] = [];
      for (const block of blocksOf(message)) {
        if (block.type === "text" && block.text) parts.push({ text: block.text });
        if (block.type === "tool_use") {
          parts.push({
            functionCall: { name: block.name, args: block.input ?? {}, id: block.id },
            // A SIBLING of functionCall, not a field inside it. Without this the
            // model 400s on the turn after any tool call — the first request of
            // a conversation always succeeds, which is why this survived review.
            ...(block.signature ? { thoughtSignature: block.signature } : {}),
          });
        }
        if (block.type === "tool_result") {
          // `functionResponse` is keyed by NAME, so the name is recovered from
          // the `tool_use` that asked — only the transcript knows it. The id is
          // echoed too: name alone is ambiguous the moment a model calls one
          // tool twice in a turn, and the two results are not interchangeable.
          const name = names.get(block.tool_use_id);
          if (!name) continue;
          parts.push({
            functionResponse: {
              name,
              id: block.tool_use_id,
              response: { result: parseJsonish(block.content) },
            },
          });
        }
      }
      if (parts.length) {
        contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
      }
    }

    const declarations = input.tools.map((t) => {
      const parameters = toGeminiSchema(t.input_schema);
      return {
        name: t.name,
        description: t.description,
        ...(parameters ? { parameters } : {}),
      };
    });

    return {
      url: assertProviderUrl(
        "gemini",
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          input.model
        )}:generateContent`
      ),
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: {
        systemInstruction: { parts: [{ text: joinSystem(input.system) }] },
        contents,
        ...(declarations.length ? { tools: [{ functionDeclarations: declarations }] } : {}),
        generationConfig: { maxOutputTokens: input.maxTokens },
      },
    };
  },

  parseResponse(payload, deps) {
    const makeId = deps?.makeId ?? defaultId;
    const response = payload as {
      candidates?: {
        content?: {
          parts?: {
            text?: string;
            functionCall?: { name?: string; args?: unknown; id?: string };
            thoughtSignature?: string;
          }[];
        };
        finishReason?: string;
      }[];
      usageMetadata?: Record<string, number>;
    };
    const candidate = response.candidates?.[0];
    const text: string[] = [];
    const toolCalls: CanonicalToolCall[] = [];

    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === "string") text.push(part.text);
      if (part.functionCall?.name) {
        toolCalls.push({
          // Gemini 3.x DOES return an id. An earlier version of this file said
          // it did not — read from the docs, and wrong against the live API,
          // which returns e.g. `"id": "JnkoJL1N"`. Prefer the model's own id so
          // results match its bookkeeping, and mint one only as a fallback for
          // a model or API version that omits it: the server matches
          // `client_results` back by `tool_use_id`, and a blank id there would
          // silently drop a result.
          id: part.functionCall.id || makeId(),
          name: part.functionCall.name,
          args: (part.functionCall.args as Record<string, unknown>) ?? {},
          ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}),
        });
      }
    }

    const usage = response.usageMetadata ?? {};
    return {
      text: text.join(""),
      toolCalls,
      stopReason: candidate?.finishReason ?? null,
      usage: {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        cacheReadTokens: usage.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
      },
    };
  },
};

function defaultId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return `toolu_${random ?? Math.random().toString(36).slice(2, 14)}`;
}

// ── Registry ────────────────────────────────────────────────────────────────

export const PROVIDERS: Record<ProviderId, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function adapterFor(provider: string): ProviderAdapter {
  const adapter = PROVIDERS[provider as ProviderId];
  if (!adapter) throw new Error(`Unknown provider ${provider}`);
  return adapter;
}

/**
 * Fetch a provider's model list for the model selector.
 *
 * Returns a discriminated result rather than throwing, because every failure
 * here is one the UI has to render: a bad key, a key without list permission,
 * a network blip. "The list is empty" and "we could not fetch the list" are
 * different sentences and the selector must not show the first when it means
 * the second — the same rule the tool layer follows for verdict reads.
 */
export type ModelListResult =
  | { ok: true; models: ModelOption[] }
  | { ok: false; error: string };

export async function listModels(
  provider: string,
  apiKey: string,
  deps?: AdapterDeps
): Promise<ModelListResult> {
  if (!apiKey.trim()) return { ok: false, error: "No API key was entered." };
  try {
    const models = await adapterFor(provider).listModels(apiKey, deps);
    return { ok: true, models };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
