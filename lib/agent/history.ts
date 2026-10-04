"use client";

/**
 * Bounding the transcript for the BYOK loop. A port of
 * `services/agent/app/history.py`, for the same reason `citations.ts` is a port
 * of `citations.py`: under BYOK `/agent/chat` is never called, so the Python
 * trim never runs and the transcript would grow until the provider rejected it
 * outright — mid-conversation, after the user has invested a session, and no
 * better on retry.
 *
 * **Two rules, and the second one is the subtle one.**
 *
 * 1. Trim from the *oldest* end. Recent turns carry the thread.
 *
 * 2. **Never split a `tool_use` from its `tool_result`.** Every provider here
 *    rejects an assistant `tool_use` with no matching result, and rejects an
 *    orphan result just as hard. So "drop the first N messages" is not a
 *    smaller conversation, it is a 400 — a worse failure than the one being
 *    prevented, and one that only appears on long conversations with tool
 *    calls. The cut is only ever made at a **turn boundary**: a user message
 *    with no `tool_result` blocks in it.
 *
 * The trim is never silent: the page keeps showing history the model was not
 * given, and an unexplained divergence reads as the agent forgetting at random.
 * `dropped` is what the UI's memory divider is drawn from.
 */

import type { CanonicalMessage } from "./providers";

/**
 * Rough characters-per-token, deliberately conservative (real English is ~4).
 * A budget guard, not an accounting system: guessing low costs a slightly
 * shorter history, guessing high costs the hard failure this prevents.
 * Transcribed from `history.CHARS_PER_TOKEN` — keep the two equal.
 */
export const CHARS_PER_TOKEN = 3;

/** Matches `settings.max_history_tokens` (AGENT_MAX_HISTORY_TOKENS). */
export const DEFAULT_MAX_HISTORY_TOKENS = 24_000;

export interface Trimmed {
  messages: CanonicalMessage[];
  dropped: number;
  approxTokens: number;
  wasTrimmed: boolean;
}

export function approxTokens(messages: CanonicalMessage[]): number {
  let total = 0;
  for (const message of messages) {
    total +=
      typeof message.content === "string"
        ? message.content.length
        : JSON.stringify(message.content ?? []).length;
  }
  return Math.floor(total / CHARS_PER_TOKEN);
}

/**
 * True when this message can legally be the first one in a transcript.
 *
 * A plain user message. Anything carrying a `tool_result` is mid-exchange and
 * needs the `tool_use` that asked for it.
 */
function isTurnBoundary(message: CanonicalMessage): boolean {
  if (message.role !== "user") return false;
  if (typeof message.content === "string") return true;
  if (Array.isArray(message.content)) {
    return !message.content.some((block) => block?.type === "tool_result");
  }
  return false;
}

/** Drop whole turns off the front until the transcript fits. */
export function trim(
  messages: CanonicalMessage[],
  maxTokens: number = DEFAULT_MAX_HISTORY_TOKENS
): Trimmed {
  if (messages.length === 0) {
    return { messages: [], dropped: 0, approxTokens: 0, wasTrimmed: false };
  }

  const current = approxTokens(messages);
  if (current <= maxTokens) {
    return { messages, dropped: 0, approxTokens: current, wasTrimmed: false };
  }

  const boundaries: number[] = [];
  messages.forEach((m, i) => {
    if (isTurnBoundary(m)) boundaries.push(i);
  });

  for (const cut of boundaries.slice(1)) {
    const candidate = messages.slice(cut);
    const size = approxTokens(candidate);
    if (size <= maxTokens) {
      return { messages: candidate, dropped: cut, approxTokens: size, wasTrimmed: true };
    }
  }

  // Even the last complete turn is over budget — a single enormous message,
  // usually one huge tool result. Keeping it whole and letting the provider
  // reject it is the honest outcome: silently truncating a tool result would
  // hand the model a partial verdict that still looks complete, which is the
  // one thing this system must never do.
  if (boundaries.length > 0) {
    const last = boundaries[boundaries.length - 1];
    const candidate = messages.slice(last);
    return {
      messages: candidate,
      dropped: last,
      approxTokens: approxTokens(candidate),
      wasTrimmed: last > 0,
    };
  }

  // No turn boundary at all — a malformed transcript. Pass it through rather
  // than invent one; the provider's own error is more useful than ours.
  return { messages, dropped: 0, approxTokens: current, wasTrimmed: false };
}
