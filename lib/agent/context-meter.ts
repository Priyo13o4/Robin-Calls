"use client";

/**
 * How full the conversation is, for the ring beside the tool budget.
 *
 * **The budget shown is OURS, not the model's.** gemini-3.5-flash-lite has a
 * context window around a million tokens; `AGENT_MAX_HISTORY_TOKENS` is 24,000.
 * A ring reading "18k / 1M · 2%" would say "plenty of room" at the exact moment
 * `trim()` starts dropping the user's earliest questions on the floor. The
 * ceiling that actually bites is the only honest one to draw.
 *
 * **`wouldDrop` is measured by the trimmer, never re-derived.** It calls the
 * real `trim()` — the same function the request path calls — because a second
 * implementation of "which turns survive" would drift from the first, and the
 * one thing worse than no indicator is one that disagrees with what happens.
 * That is CLAUDE.md §8.10 in miniature: an indicator nobody wired to the thing
 * it indicates.
 *
 * Counted in the plane's own unit (`CHARS_PER_TOKEN = 3`, see `history.ts`).
 * No tokenizer is installed and this is a budget guard, not an invoice.
 *
 * ## Why the ring reads far lower than the token counter beside it
 *
 * They measure different things, and the difference is the whole architecture.
 *
 * On the **our-models** path the tool loop runs inside the FastAPI container.
 * Every round re-sends that turn's tool results to the model — which is what
 * the `n IN` figure accumulates — but only the final prose comes back to the
 * browser, so the stored transcript is user text and assistant text and nothing
 * else. Measured live 2026-08-06: a turn billing 22,732 input tokens left a
 * two-message, ~384-token transcript behind it. Both numbers are right. Tool
 * results are paid for within a turn and cost nothing on the next one.
 *
 * On **BYOK** the browser runs the loop, so `tool_use` and `tool_result` blocks
 * are in the transcript and are carried into every later turn. That is the path
 * where the ring climbs, and the only path where `compaction.ts` has anything
 * to elide.
 *
 * So this must never be presented as "what your last turn cost". It is how much
 * of the conversation the next turn will still be carrying.
 */

import type { CanonicalMessage } from "./providers";
import { DEFAULT_MAX_HISTORY_TOKENS, approxTokens, trim } from "./history";

export type ContextPressure = "roomy" | "filling" | "tight" | "over";

/** Where the ring changes colour. Below `FILLING` it stays quiet. */
export const FILLING_AT = 0.6;
export const TIGHT_AT = 0.85;

export interface ContextReading {
  usedTokens: number;
  maxTokens: number;
  /**
   * 0..1, clamped at the top. A transcript at 130% of budget reads as a full
   * ring, not an overflowing one — the ring's job is "you are at the ceiling",
   * and how far past it you are is not a distinction the user can act on.
   */
  fraction: number;
  pressure: ContextPressure;
  /**
   * Messages the next turn would drop if sent as-is, straight from `trim()`.
   * Zero whenever the transcript fits, which is the common case.
   */
  wouldDrop: number;
  /**
   * The transcript does not fit even after trimming everything trimmable.
   *
   * A distinct state because `wouldDrop` cannot express it: the trimmer cuts
   * only at turn boundaries, so a single turn larger than the whole budget —
   * one enormous tool result, which is exactly what a source read or a wide
   * audit produces — has nothing to cut and reports `dropped: 0`. Read through
   * `wouldDrop` alone that is indistinguishable from a healthy conversation,
   * and the ring would sit at "nearly full" while the provider rejects the
   * request outright. `history.ts` keeps that turn whole on purpose (a silently
   * truncated tool result is a partial verdict that still looks complete), so
   * the honest thing is to name the state, not to hide it.
   */
  irreducible: boolean;
}

export function pressureOf(
  fraction: number,
  wouldDrop: number,
  irreducible = false,
): ContextPressure {
  // Both of these outrank the ratio. The trimmer cuts at turn boundaries, so a
  // transcript can be under budget in tokens and still lose a turn — and
  // losing a turn is the event the user cares about, not the arithmetic.
  if (wouldDrop > 0 || irreducible) return "over";
  if (fraction >= TIGHT_AT) return "tight";
  if (fraction >= FILLING_AT) return "filling";
  return "roomy";
}

export function readContext(
  messages: CanonicalMessage[],
  maxTokens: number = DEFAULT_MAX_HISTORY_TOKENS,
): ContextReading {
  const usedTokens = approxTokens(messages);
  // A non-positive ceiling is a misconfiguration, not "infinite room". Report
  // a full ring rather than dividing by zero into NaN and rendering nothing.
  const fraction = maxTokens > 0 ? Math.min(1, usedTokens / maxTokens) : 1;
  const trimmed = maxTokens > 0 ? trim(messages, maxTokens) : null;
  const wouldDrop = trimmed?.dropped ?? 0;
  // What SURVIVES the trim is the thing that gets sent, so that is what has to
  // fit — not what we started with.
  const irreducible = trimmed !== null && trimmed.approxTokens > maxTokens;
  return {
    usedTokens,
    maxTokens,
    fraction,
    pressure: pressureOf(fraction, wouldDrop, irreducible),
    wouldDrop,
    irreducible,
  };
}

/**
 * Is there enough conversation behind us for compaction to be worth offering?
 *
 * Compaction costs a model call and always loses something, so offering it on a
 * two-message conversation would spend real money to summarise nothing. The
 * gate is deliberately on turns rather than tokens: one enormous tool result is
 * not a conversation with a summarisable history.
 */
export const MIN_TURNS_TO_COMPACT = 4;

export function canCompact(messages: CanonicalMessage[], reading: ContextReading): boolean {
  const turns = messages.filter((m) => m.role === "user").length;
  if (turns < MIN_TURNS_TO_COMPACT) return false;
  return reading.pressure !== "roomy";
}
