/**
 * The wire shapes the browser sees, and the render model built from them.
 *
 * Everything here mirrors something that already exists server-side:
 * `GET /agent/config`, `GET /agent/persona/{name}`, `POST /agent/tool`, and the
 * SSE frames `POST /agent/chat` emits. Nothing in this file invents a field —
 * when a shape looks thin, that is the contract being thin, not an omission.
 *
 * ── The one rule about the transcript ───────────────────────────────────────
 *
 * `Conversation.transcript` is the ONLY state that survives between turns. It
 * is stored and replayed **verbatim**. `tool_use` blocks carry `signature`
 * (Gemini's `thoughtSignature`), and there is no guarantee a future provider
 * does not add a second such key — so nothing in this codebase may map,
 * rebuild, or key-filter a stored transcript. Provider-specific pruning happens
 * at the request edge (`stripForeignKeys` in `providers.ts`) and nowhere else.
 */

import type {
  CanonicalMessage,
  CanonicalUsage,
  ModelOption,
  ProviderId,
  SystemBlock,
} from "./providers";
import type { ClientRpcConfig, Provenance } from "./client-tools";

export type ToolLocale = "server" | "client" | "local";

/** `GET /agent/config`. Public: never carries a credentialed RPC URL. */
export interface AgentConfig {
  promptVersion: string;
  ourModelsEnabled: boolean;
  maxToolCallsPerTurn: number;
  /** Ceiling for client-locale reads, which run on the user's own RPC. */
  maxFreeToolCallsPerTurn?: number;
  rpc: ClientRpcConfig;
  personas: PersonaSummary[];
}

export interface PersonaSummary {
  name: string;
  title: string;
  internal: boolean;
  tools: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  locale: ToolLocale;
}

/** `GET /agent/persona/{name}` — everything the BYOK loop needs to build a request. */
export interface PersonaBundle {
  name: string;
  title: string;
  promptVersion: string;
  system: SystemBlock[];
  tools: ToolSpec[];
}

/**
 * What one tool call produced, in the shape the model is handed.
 *
 * The three states are `ok && found`, `ok && !found`, and `!ok` — and the
 * middle one is the whole reason this is not a nullable value. "Nothing is on
 * record" is not an all-clear and must never render as one (CLAUDE.md §4).
 */
export interface ToolPayload {
  ok: boolean;
  found?: boolean;
  value?: unknown;
  note?: string | null;
  error?: string;
  code?: string;
  transient?: boolean;
  /** Provenance-rejection reason: wrong_chain | stale | off_allowlist | malformed. */
  reason?: string;
  provenance?: {
    source?: string;
    chainId?: number;
    blockNumber?: number;
    observedAt?: string;
    fetchedAt?: string;
    completeness?: "complete" | "partial";
  };
}

/** Mirrors `telemetry.ToolOutcome`. Same five words, same meanings. */
export type TraceOutcome = "found" | "empty" | "transient" | "denied" | "failed";

export function outcomeOf(payload: ToolPayload): TraceOutcome {
  if (payload.ok === false) {
    if (payload.code === "RC_AGENT_TOOL_DENIED") return "denied";
    return payload.transient ? "transient" : "failed";
  }
  return payload.found ? "found" : "empty";
}

/**
 * One row in the tool trace.
 *
 * `payload` is present only when the browser actually held the result — every
 * call on the BYOK path, and client-locale calls on the our-models path. On the
 * our-models path a server-locale result never reaches the browser, so the row
 * carries name, outcome and duration and says so rather than showing an empty
 * payload that would read as "the tool returned nothing".
 */
export interface TraceEntry {
  id: string;
  name: string;
  locale: ToolLocale;
  outcome: TraceOutcome;
  durationMs: number;
  payload?: ToolPayload;
  provenance?: Provenance;
}

export interface TurnNotice {
  code?: string;
  message: string;
  droppedMessages?: number;
}

/**
 * One rendered message.
 *
 * Distinct from `CanonicalMessage`: this is what the page shows, which is
 * deliberately a superset of what the model was given. History trimming means
 * the page keeps messages the model never saw, and `memoryStartsHere` marks
 * where the two diverged for the most recent turn.
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  /** Persona active for this assistant turn; absent on older stored messages. */
  persona?: string;
  /** Marks the visible assistant turn where a conversation changed persona. */
  personaChanged?: boolean;
  /** Assistant only. */
  trace?: TraceEntry[];
  strippedClaims?: number;
  /**
   * The removed sentences themselves. Available on the BYOK path only, where
   * the validator runs in this browser; our-models reports a count and keeps
   * the text server-side, so the UI must not imply it has one when it has the
   * other.
   */
  strippedText?: string[];
  billable?: boolean;
  usage?: CanonicalUsage;
  notices?: TurnNotice[];
  error?: TurnError;
  /**
   * The user stopped this turn, or it produced nothing. Neither a failure nor
   * an answer — see `StoppedTurn`. Kept distinct from `error` so a stop never
   * renders as something breaking, and distinct from a normal message so it
   * never renders under the citation strip as a validated empty reply.
   */
  stopped?: boolean;
  /** True when the model's memory for the latest turn began at this message. */
  memoryStartsHere?: boolean;
}

/**
 * Whose infrastructure failed — and therefore who can do anything about it.
 *
 * Recorded where the failure happens, never derived from the current mode at
 * render time. A conversation outlives the mode that produced it: the case file
 * is replayed from storage, and a turn that died on the caller's own exhausted
 * Gemini quota is still their quota when it is re-read a week later under
 * our-models. Reading `state.mode` in the transcript would re-attribute every
 * stored error to whatever the picker happens to say today.
 *
 * Absent means "ours". Every error written before this field existed came from
 * the server path, and the conservative direction is to keep blame on us —
 * wrongly accusing a user's key of a fault that was ours is the worse mistake.
 */
export type FaultSource = "ours" | "yours";

export interface TurnError {
  message: string;
  code?: string;
  transient?: boolean;
  /** Defaults to `"ours"` when unset — see `FaultSource`. */
  source?: FaultSource;
}

export type ChatMode = "byok" | "our_models";

export interface Conversation {
  id: string;
  /** IndexedDB compare-and-swap revision. Missing legacy values are revision 0. */
  storageRevision?: number;
  title: string;
  persona: string;
  mode: ChatMode;
  createdAt: string;
  updatedAt: string;
  /** The address this conversation was opened beside, if any. */
  subject: string | null;
  messages: ChatMessage[];
  /**
   * Verbatim model-facing state. Stored as received; never rebuilt. See the
   * file header — `signature` on a `tool_use` block is load-bearing and is not
   * the only opaque key a provider may ever add.
   */
  transcript: CanonicalMessage[];
}

/** Provider credentials and selection. Browser-local, never posted anywhere. */
export interface ByokSettings {
  provider: ProviderId;
  model: string;
  apiKey: string;
}

export type { CanonicalMessage, CanonicalUsage, ModelOption, ProviderId, SystemBlock };
