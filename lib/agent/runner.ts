"use client";

/**
 * Running one turn. **Two code paths, and they are not variations of one.**
 *
 * ── our-models ──────────────────────────────────────────────────────────────
 *
 * `POST /agent/chat`, SSE, the loop runs in `chat.py`. The browser's job is to
 * render frames and to execute client-locale tools when the server hands the
 * loop over (`client_tool_call` → run → POST back with the transcript the
 * server sent).
 *
 * ── BYOK ────────────────────────────────────────────────────────────────────
 *
 * **`/agent/chat` is never called.** The entire agent loop — model calls, tool
 * dispatch, budget, history trimming, citation validation — runs in this file,
 * in the browser, against the user's own provider. The server contributes the
 * persona bundle (`GET /agent/persona/{name}`) and server-locale tool execution
 * (`POST /agent/tool`), and learns nothing else about the conversation.
 *
 * Anything that must hold on both paths therefore exists twice: once in Python
 * and once here. `citations.ts` and `history.ts` say so at length. Adding a
 * turn-level rule to `chat.py` alone leaves BYOK — the path most users are on,
 * since our-models refuses a key until metering lands — running without it.
 *
 * ── What is deliberately NOT re-implemented ─────────────────────────────────
 *
 * Provenance re-verification (`accept_client_result`). Under BYOK the browser
 * computes the result, hands it to a model the browser is also calling, and
 * renders the answer on the same screen. A guard between two halves of one
 * browser is theatre. The blast radius is the user's own screen — their key,
 * their browser, their local history — and this is an accepted, documented gap
 * (HANDOFF §5). Do not "fix" it by verifying a result against itself.
 */

import {
  adapterFor,
  type CanonicalBlock,
  type CanonicalMessage,
  type CanonicalUsage,
} from "./providers";
import {
  isClientTool,
  runClientTool,
  type ClientRpcConfig,
  type ClientToolOutcome,
} from "./client-tools";
import { Citations, validate } from "./citations";
import { trim } from "./history";
import { isAbort, postEventStream, SseHttpError } from "./sse";
import {
  outcomeOf,
  type AgentConfig,
  type ByokSettings,
  type FaultSource,
  type PersonaBundle,
  type ToolLocale,
  type ToolPayload,
  type TraceEntry,
  type TurnError,
  type TurnNotice,
} from "./types";

/**
 * Same-origin, always. nginx routes `/agent/` to the agent container, and a
 * configurable base would mean a value from somewhere else deciding where
 * `scan_token` and the persona allowlist are enforced. `/agent/tool` carries no
 * bearer precisely because it is reached from the user's own page — pointing it
 * elsewhere breaks that argument silently.
 */
const AGENT_BASE = "/agent";

const TRACE_OUTCOMES = new Set(["found", "empty", "transient", "denied", "failed"]);

/** Ours saying "not now": a retry, never a finding. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 503]);

export const codes = {
  CLIENT_TOOL_FAILED: "RC_AGENT_CLIENT_TOOL_FAILED",
  TOOL_BUDGET: "RC_AGENT_TOOL_BUDGET",
  TOOL_DENIED: "RC_AGENT_TOOL_DENIED",
  UNKNOWN_TOOL: "RC_AGENT_UNKNOWN_TOOL",
  MODEL_UNAVAILABLE: "RC_AGENT_MODEL_UNAVAILABLE",
  MODEL_FAILED: "RC_AGENT_MODEL_FAILED",
  HISTORY_TRIMMED: "RC_AGENT_HISTORY_TRIMMED",
} as const;

// ── Read surfaces ───────────────────────────────────────────────────────────

export async function fetchConfig(signal?: AbortSignal): Promise<AgentConfig> {
  const response = await fetch(`${AGENT_BASE}/config`, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`The agent service answered ${response.status}.`);
  return (await response.json()) as AgentConfig;
}

export async function fetchPersona(name: string, signal?: AbortSignal): Promise<PersonaBundle> {
  const response = await fetch(`${AGENT_BASE}/persona/${encodeURIComponent(name)}`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`No persona bundle for ${name} (${response.status}).`);
  return (await response.json()) as PersonaBundle;
}

/**
 * Server-locale tool execution for the BYOK loop.
 *
 * A refusal is returned as a payload, never thrown. The allowlist holding is a
 * normal outcome the model can act on — it will usually answer another way —
 * and throwing would end a turn that had already read three other tools.
 */
async function callServerTool(
  name: string,
  args: Record<string, unknown>,
  persona: string,
  signal?: AbortSignal
): Promise<ToolPayload> {
  let response: Response;
  try {
    response = await fetch(`${AGENT_BASE}/tool`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, args, persona }),
      signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    return {
      ok: false,
      error: "The record could not be reached from this browser.",
      transient: true,
    };
  }

  const body = (await response.json().catch(() => null)) as
    | (ToolPayload & { error?: string })
    | null;

  if (response.ok) {
    // A 200 whose body we could not read is NOT an empty record. `{}` fails
    // `ok === false`, so it would fall through `outcomeOf` to "empty" and
    // render as NOTHING ON RECORD — a truncated proxy response narrated as an
    // affirmative absence of history, the top row of CLAUDE.md §4's table. On a
    // success `ok` is always present, so its absence means the body is not one.
    if (!body || typeof body.ok !== "boolean") {
      return {
        ok: false,
        error: "The record answered with something this page could not read.",
        transient: true,
      };
    }
    return body;
  }

  // A non-2xx carries `{error}` and no `ok` — that IS the endpoint's error
  // envelope (`chat.py` `call_tool`), so requiring `ok` here would turn every
  // real allowlist refusal into "our infrastructure is down".
  return {
    ok: false,
    error: body?.error ?? `The tool call failed (${response.status}).`,
    code: response.status === 403 ? codes.TOOL_DENIED : response.status === 404 ? codes.UNKNOWN_TOOL : undefined,
    // 4xx from this endpoint is a definite answer — a denied tool, an unknown
    // name, a bad argument. 5xx is ours failing, and so is 429: nginx rate-limits
    // `/agent/` at the edge, and a budget we imposed is an outage from the
    // caller's side, not a fact about the token. Classified as definite it would
    // render under the red hazard stripe and still bill the turn.
    transient: response.status >= 500 || TRANSIENT_STATUSES.has(response.status),
  };
}

// ── Turn plumbing ───────────────────────────────────────────────────────────

export type TurnPhase = "thinking" | "reading" | "browser_reading" | "validating";

export interface TurnCallbacks {
  onPhase?(phase: TurnPhase): void;
  onTrace?(entry: TraceEntry): void;
  onNotice?(notice: TurnNotice): void;
  onUsage?(usage: CanonicalUsage): void;
}

export interface TurnResult {
  text: string;
  trace: TraceEntry[];
  notices: TurnNotice[];
  usage: CanonicalUsage;
  strippedClaims: number;
  /** BYOK only: the validator ran here, so the removed sentences are in hand. */
  strippedText?: string[];
  billable: boolean;
  /** What to store and replay next turn. Verbatim — never rebuilt downstream. */
  transcript: CanonicalMessage[];
  /** How many of the *stored* messages the model was not shown this turn. */
  historyDropped: number;
  error?: TurnError;
  /**
   * The user stopped it, or it ended with nothing to show. Distinct from
   * `error`: nothing failed, so it must not render as a failure — and distinct
   * from a normal answer, so it must not render under the citation strip as a
   * validated empty reply either.
   */
  aborted?: boolean;
}

const ZERO_USAGE: CanonicalUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function addUsage(a: CanonicalUsage, b: CanonicalUsage): CanonicalUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/**
 * Turn one browser-executed client tool into the payload shape the model sees.
 *
 * Mirrors `Dispatcher.accept_client_result` and the `client_results` branch of
 * `chat.py` — minus the verification, for the reason in the file header. A
 * failed browser read is `transient`: from the model's point of view the user's
 * own RPC failing is an outage, retryable, and **not a finding about the
 * token** (CLAUDE.md §4).
 */
function clientPayload(outcome: ClientToolOutcome): ToolPayload {
  if (outcome.error || !outcome.result) {
    return {
      ok: false,
      error: outcome.error ?? "The browser returned no result.",
      code: codes.CLIENT_TOOL_FAILED,
      transient: true,
    };
  }
  return {
    ok: true,
    found: true,
    value: outcome.result.value,
    provenance: {
      ...outcome.result.provenance,
    },
  };
}

function traceOf(
  id: string,
  name: string,
  locale: ToolLocale,
  payload: ToolPayload,
  startedAt: number,
  outcome?: ClientToolOutcome
): TraceEntry {
  return {
    id,
    name,
    locale,
    outcome: outcomeOf(payload),
    durationMs: Math.round(performance.now() - startedAt),
    payload,
    provenance: outcome?.result?.provenance,
  };
}

function toolResultBlock(id: string, payload: ToolPayload): CanonicalBlock {
  return {
    type: "tool_result",
    tool_use_id: id,
    content: JSON.stringify(payload),
    is_error: payload.ok === false,
  };
}

// ── our-models ──────────────────────────────────────────────────────────────

export interface OurModelsInput {
  persona: string;
  transcript: CanonicalMessage[];
  userText: string;
  rpc: ClientRpcConfig;
  signal?: AbortSignal;
}

/**
 * Run one our-models turn against `POST /agent/chat`.
 *
 * The stored transcript that comes back is deliberately **text-only** — the
 * user's question and the final validated answer, with no `tool_use` /
 * `tool_result` pairs.
 *
 * That is not laziness. The server owns the intra-turn transcript and never
 * returns it: `message` carries text, `strippedClaims`, `billable` and a count,
 * and nothing else. Reconstructing the tool blocks from the trace frames would
 * mean inventing `tool_result` contents we were never sent, and an assistant
 * `tool_use` whose result does not match is not a smaller conversation, it is a
 * 400 on every subsequent turn — a failure that only appears in long
 * conversations, which is to say in production. The cost of the honest version
 * is that the model may re-read a tool next turn. That is cheap; the other
 * failure is not.
 */
export async function runOurModelsTurn(
  input: OurModelsInput,
  callbacks: TurnCallbacks = {}
): Promise<TurnResult> {
  const userMessage: CanonicalMessage = { role: "user", content: input.userText };
  const priorPlusUser = [...input.transcript, userMessage];

  let messages: CanonicalMessage[] = priorPlusUser;
  let clientResults: Array<{ tool_use_id: string; name: string; result?: unknown; error?: string }> = [];

  const trace: TraceEntry[] = [];
  const notices: TurnNotice[] = [];
  let usage = ZERO_USAGE;
  let text = "";
  let strippedClaims = 0;
  let billable = true;
  let historyDropped = 0;
  let error: TurnResult["error"];

  /**
   * The guard is **"did an answer arrive"**, not "was an error set".
   *
   * Gating the transcript on `error` alone leaves a hole exactly the width of
   * the STOP button: an abort sets no error and leaves `text` empty, so the
   * conversation stored an assistant message whose only block was
   * `{type:"text", text:""}`. Anthropic rejects that block, and it rejects it on
   * every subsequent turn — one press of STOP permanently bricks the
   * conversation, with no way back from the UI. Gemini silently drops the
   * message instead, which is its own kind of wrong.
   *
   * So an aborted or empty turn returns the transcript it was handed, exactly
   * as `runByokTurn`'s `fail()` does. The user's question is not recorded as
   * asked, because it was not answered.
   */
  const finish = (): TurnResult => ({
    text,
    trace,
    notices,
    usage,
    strippedClaims,
    billable,
    transcript:
      error || !text
        ? input.transcript
        : [...priorPlusUser, { role: "assistant", content: [{ type: "text", text }] }],
    historyDropped,
    error,
    aborted: !error && !text,
  });

  // Bounded because a server that keeps asking for client tools would otherwise
  // loop forever in a browser nobody is watching. The server's own per-turn cap
  // is the real ceiling; this is the backstop for it not being reached.
  for (let round = 0; round < 8; round += 1) {
    callbacks.onPhase?.("thinking");
    let handedOver: { calls: Array<{ id: string; name: string; args: Record<string, unknown> }>; messages: CanonicalMessage[] } | null =
      null;

    try {
      for await (const frame of postEventStream(
        `${AGENT_BASE}/chat`,
        {
          persona: input.persona,
          messages,
          client_results: clientResults,
          // `head_block` is deliberately omitted. It would be the browser's own
          // idea of the head, compared against a block number the same browser
          // reported, on the same endpoint — a guard checking a number against
          // itself. `client_bridge.verify` documents an absent head as
          // "staleness unverifiable", which is the truth here; supplying one
          // would make the check look enforced while proving nothing.
          client_tools_available: true,
        },
        { signal: input.signal }
      )) {
        const data = frame.data ? (JSON.parse(frame.data) as Record<string, unknown>) : {};
        switch (frame.event) {
          case "notice": {
            const notice: TurnNotice = {
              code: data.code as string | undefined,
              message: String(data.message ?? ""),
              droppedMessages: data.droppedMessages as number | undefined,
            };
            notices.push(notice);
            if (notice.code === codes.HISTORY_TRIMMED) historyDropped = notice.droppedMessages ?? 0;
            callbacks.onNotice?.(notice);
            break;
          }
          case "usage": {
            const round0: CanonicalUsage = {
              inputTokens: Number(data.inputTokens ?? 0),
              outputTokens: Number(data.outputTokens ?? 0),
              cacheReadTokens: Number(data.cacheReadTokens ?? 0),
              cacheWriteTokens: Number(data.cacheWriteTokens ?? 0),
            };
            usage = addUsage(usage, round0);
            callbacks.onUsage?.(usage);
            break;
          }
          case "tool": {
            // No payload on this path: a server-locale result never reaches the
            // browser. The row says what ran and how it went, and the UI says
            // plainly that the body stayed on the server rather than rendering
            // an empty payload that would read as "it returned nothing".
            const entry: TraceEntry = {
              id: String(data.id ?? ""),
              name: String(data.name ?? ""),
              locale: (data.locale as ToolLocale) ?? "server",
              // Never default to "found": that renders lime OK, and the one
              // field saying whether a read succeeded must fail closed.
              outcome: TRACE_OUTCOMES.has(String(data.outcome))
                ? (data.outcome as TraceEntry["outcome"])
                : "failed",
              durationMs: Number(data.durationMs ?? 0),
            };
            trace.push(entry);
            callbacks.onTrace?.(entry);
            callbacks.onPhase?.("reading");
            break;
          }
          case "client_tool_call": {
            handedOver = {
              calls: (data.calls as Array<{ id: string; name: string; args: Record<string, unknown> }>) ?? [],
              messages: (data.messages as CanonicalMessage[]) ?? messages,
            };
            break;
          }
          case "message": {
            text = String(data.text ?? "");
            strippedClaims = Number(data.strippedClaims ?? 0);
            billable = data.billable !== false;
            break;
          }
          case "error": {
            error = {
              message: String(data.error ?? "The turn failed."),
              code: data.code as string | undefined,
              // Only a model failure is retryable in place; a refused persona or
              // an unconfigured deployment is a fact, not an outage.
              transient: data.code === codes.MODEL_FAILED,
            };
            billable = false;
            break;
          }
          default:
            break; // start, await_client, done — no render state of their own
        }
      }
    } catch (err) {
      if (isAbort(err)) return finish();
      error = {
        message:
          err instanceof SseHttpError && err.status === 429
            ? "Too many requests to the agent. Wait a moment and ask again."
            : "The agent service could not be reached.",
        transient: true,
      };
      billable = false;
      return finish();
    }

    if (error || !handedOver) return finish();

    // The server paused the loop. Run the reads here, then resume from the
    // transcript it sent — verbatim, because it carries `tool_use` blocks whose
    // `signature` the next provider request needs.
    callbacks.onPhase?.("browser_reading");
    const outcomes = await Promise.all(
      handedOver.calls.map(async (call) => {
        const startedAt = performance.now();
        const outcome = await runClientTool(call, input.rpc, input.signal);
        const payload = clientPayload(outcome);
        const entry = traceOf(call.id, call.name, "client", payload, startedAt, outcome);
        trace.push(entry);
        callbacks.onTrace?.(entry);
        if (!payload.ok) billable = false;
        return outcome;
      })
    );

    messages = handedOver.messages;
    clientResults = outcomes.map((outcome) => ({
      tool_use_id: outcome.tool_use_id,
      name: outcome.name,
      result: outcome.result,
      error: outcome.error,
    }));
  }

  error = { message: "The turn did not settle. Ask again.", transient: true };
  return finish();
}

// ── BYOK ────────────────────────────────────────────────────────────────────

export interface ByokInput {
  persona: string;
  bundle: PersonaBundle;
  settings: ByokSettings;
  transcript: CanonicalMessage[];
  userText: string;
  rpc: ClientRpcConfig;
  maxToolCalls: number;
  /**
   * Ceiling for client-locale reads, which run on the USER'S OWN RPC and cost
   * us nothing. Far higher than `maxToolCalls` on purpose — see the charge
   * site below. Defaults to `maxToolCalls` when absent, keeping the old
   * single-pool behaviour for any caller that has not been updated.
   */
  maxFreeToolCalls?: number;
  maxHistoryTokens?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * Run one BYOK turn. The whole loop, in this browser.
 *
 * Everything `chat.py` does per turn happens here in the same order and for the
 * same reasons: trim first (so an over-long transcript fails as a shorter
 * history rather than a provider 400), then model, then tools, then the budget
 * ceiling, then citation validation on the final text.
 */
export async function runByokTurn(
  input: ByokInput,
  callbacks: TurnCallbacks = {}
): Promise<TurnResult> {
  const adapter = adapterFor(input.settings.provider);
  const citations = new Citations();
  const trace: TraceEntry[] = [];
  const notices: TurnNotice[] = [];

  let usage = ZERO_USAGE;
  let billable = true;
  /*
   * TWO counters, because the two locales spend different things.
   *
   * `server` reads go back to `/agent/tool` and land on
   * `/api/internal/v1/read/*`, which sets `cache-control: no-store` — every one
   * is a live Postgres round-trip on an endpoint that carries no bearer. That
   * is the budget worth keeping tight.
   *
   * `client` reads execute in this browser against the user's own RPC. They
   * cost us nothing at all; the cap on them is purely a runaway-loop bound and
   * has no reason to be as small. A single client-side contract audit (proxy
   * slots, diamond `facets()`, selector scan, authority reads) is easily a
   * dozen calls and would otherwise exhaust a budget it never charges.
   */
  let callsMade = 0;
  let freeCallsMade = 0;
  const freeCap = input.maxFreeToolCalls ?? input.maxToolCalls;
  const spent = (client: boolean) => (client ? freeCallsMade : callsMade);
  const capFor = (client: boolean) => (client ? freeCap : input.maxToolCalls);
  const overBudget = (client: boolean) => spent(client) >= capFor(client);

  const userMessage: CanonicalMessage = { role: "user", content: input.userText };
  const full = [...input.transcript, userMessage];

  const trimmed = trim(full, input.maxHistoryTokens);
  if (trimmed.wasTrimmed) {
    // Never silent: the page still shows history the model was not given, and an
    // unexplained divergence reads as the agent forgetting at random.
    const notice: TurnNotice = {
      code: codes.HISTORY_TRIMMED,
      message: `This conversation got long, so the ${trimmed.dropped} oldest messages were left out of this answer.`,
      droppedMessages: trimmed.dropped,
    };
    notices.push(notice);
    callbacks.onNotice?.(notice);
  }

  const messages: CanonicalMessage[] = [...trimmed.messages];
  let tools = input.bundle.tools;

  /**
   * The user pressed STOP. Nothing failed and nothing was answered, so this is
   * neither an error nor a result: the stored transcript is untouched (an
   * unanswered `tool_use` replayed next turn is a hard 400) and `aborted` tells
   * the UI not to dress the silence up as a validated answer.
   */
  const aborted = (): TurnResult => ({
    text: "",
    trace,
    notices,
    usage,
    strippedClaims: 0,
    billable: false,
    transcript: input.transcript,
    historyDropped: trimmed.dropped,
    aborted: true,
  });

  /**
   * `source` defaults to "ours" even though every current caller is a provider
   * fault, and deliberately: the next `fail()` someone adds here is far more
   * likely to be our tool dispatcher than the model endpoint, and inheriting
   * "yours" by default would silently blame a user's key for our bug. Blame is
   * opt-in, and the two sites that opt in are both the raw provider fetch.
   */
  const fail = (
    message: string,
    code?: string,
    transient = false,
    source: FaultSource = "ours"
  ): TurnResult => ({
    text: "",
    trace,
    notices,
    usage,
    strippedClaims: 0,
    billable: false,
    // A failed turn must not poison the stored transcript with a half-finished
    // exchange — the next turn would replay an unanswered `tool_use`.
    transcript: input.transcript,
    historyDropped: trimmed.dropped,
    error: { message, code, transient, source },
  });

  for (;;) {
    callbacks.onPhase?.("thinking");

    let parsed: ReturnType<typeof adapter.parseResponse>;
    try {
      const request = adapter.buildRequest(
        {
          model: input.settings.model,
          maxTokens: input.maxTokens ?? 2048,
          system: input.bundle.system,
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema,
          })),
          messages,
        },
        input.settings.apiKey
      );
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: input.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        // The provider's own message is far more useful than anything we could
        // invent — "your key does not have access to this model" beats "failed".
        // "yours": under BYOK this fetch goes from the reader's own browser to
        // the reader's own provider account, on the reader's own key. A 429 is
        // their quota and a 401 is their key — we are not in the request path
        // at all, and saying "our infrastructure did not answer" over it is
        // both false and useless, since we are not who can fix it.
        return fail(
          `${adapter.label} answered ${response.status}. ${detail.replace(/\s+/g, " ").slice(0, 300)}`.trim(),
          codes.MODEL_FAILED,
          response.status >= 500 || response.status === 429,
          "yours"
        );
      }
      parsed = adapter.parseResponse(await response.json());
    } catch (err) {
      if (isAbort(err)) return aborted();
      return fail(
        `${adapter.label} could not be reached from this browser.`,
        codes.MODEL_FAILED,
        true,
        "yours"
      );
    }

    usage = addUsage(usage, parsed.usage);
    callbacks.onUsage?.(usage);

    if (parsed.toolCalls.length === 0) {
      callbacks.onPhase?.("validating");
      const checked = validate(parsed.text, citations);

      // A model round that produced no text is not an answer, and storing it
      // as one appends `{type:"text", text:""}` — which Anthropic rejects on
      // every subsequent turn. Same hole the our-models `finish()` had; both
      // paths gate on "did an answer arrive", not on "was an error set".
      if (!checked.text) return aborted();

      const answer: CanonicalMessage = {
        role: "assistant",
        content: [{ type: "text", text: checked.text }],
      };
      return {
        text: checked.text,
        trace,
        notices,
        usage,
        strippedClaims: checked.stripped.length,
        strippedText: checked.stripped,
        billable,
        // The FULL transcript, not the trimmed one: trimming decides what the
        // model sees this turn, not what the conversation is. Storing the
        // trimmed copy would make every trim permanent and compounding.
        transcript: [...full, answer],
        historyDropped: trimmed.dropped,
      };
    }

    // `signature` rides on the block because the transcript is the only state
    // that survives between turns. Gemini 3.x hard-400s the NEXT request when
    // its `thoughtSignature` is not echoed back beside the call.
    const assistantBlocks: CanonicalBlock[] = [];
    if (parsed.text) assistantBlocks.push({ type: "text", text: parsed.text });
    for (const call of parsed.toolCalls) {
      assistantBlocks.push({
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: call.args,
        ...(call.signature ? { signature: call.signature } : {}),
      });
    }
    messages.push({ role: "assistant", content: assistantBlocks });
    full.push({ role: "assistant", content: assistantBlocks });

    const results: CanonicalBlock[] = [];
    for (const call of parsed.toolCalls) {
      const startedAt = performance.now();
      let payload: ToolPayload;
      let outcome: ClientToolOutcome | undefined;
      let locale: ToolLocale = "server";

      const clientLocale = isClientTool(call.name);
      if (overBudget(clientLocale)) {
        payload = {
          ok: false,
          error: `Tool-call limit of ${capFor(clientLocale)} reached for this turn (${clientLocale ? "browser" : "server"} reads). Answer with what you already have, or ask the user to narrow the question.`,
          code: codes.TOOL_BUDGET,
          transient: false,
        };
      } else {
        if (clientLocale) freeCallsMade += 1;
        else callsMade += 1;
        if (clientLocale) {
          locale = "client";
          callbacks.onPhase?.("browser_reading");
          outcome = await runClientTool(
            { id: call.id, name: call.name, args: call.args },
            input.rpc
          );
          payload = clientPayload(outcome);
        } else {
          callbacks.onPhase?.("reading");
          try {
            payload = await callServerTool(call.name, call.args, input.persona, input.signal);
          } catch (err) {
            if (isAbort(err)) return aborted();
            throw err;
          }
        }
      }

      if (payload.ok === false && payload.transient) billable = false;

      const entry = traceOf(call.id, call.name, locale, payload, startedAt, outcome);
      trace.push(entry);
      callbacks.onTrace?.(entry);

      citations.addResult(payload);
      results.push(toolResultBlock(call.id, payload));
    }

    messages.push({ role: "user", content: results });
    full.push({ role: "user", content: results });

    // Either counter being spent ends the turn: once the reads the model needs
    // are refused it cannot make progress, and looping to discover that costs
    // another completion on the user's key.
    if ((overBudget(false) || overBudget(true)) && tools.length > 0) {
      const exhausted = overBudget(false) ? "server" : "browser";
      const notice: TurnNotice = {
        code: codes.TOOL_BUDGET,
        message: `Tool-call limit (${capFor(exhausted === "browser")}) reached for ${exhausted} reads.`,
      };
      notices.push(notice);
      callbacks.onNotice?.(notice);
      // Force a final answer rather than looping: each iteration spends the
      // user's provider quota. Same wording as `chat.py` so the two paths do
      // not produce differently-shaped final answers.
      const nudge: CanonicalMessage = {
        role: "user",
        content:
          "You have reached this turn's tool-call limit. Answer with what you already have, and say plainly what you could not check rather than implying it was fine.",
      };
      messages.push(nudge);
      full.push(nudge);
      tools = [];
    }
  }
}
