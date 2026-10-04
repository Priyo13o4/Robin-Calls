"use client";

/**
 * User-pressed compaction: make the conversation fit without losing the thread.
 *
 * ## Why this does not summarise prose
 *
 * The obvious build is the one Claude Code does — hand the transcript to a
 * model and ask for a summary. We deliberately do not, for two reasons that are
 * specific to this product rather than to compaction in general.
 *
 * 1. **Prose is where qualifiers die.** A summary of "the audit was partial, so
 *    an empty capability list is not an all-clear" comes back as "no
 *    capabilities found" often enough to be a design fact, not a risk. That is
 *    the single failure mode this whole codebase is organised against (§4), and
 *    it is the reason the audit card was built to render structure instead of
 *    paragraphs. Introducing a model whose job is to compress hedges would undo
 *    that on purpose.
 *
 * 2. **The weight is not in the prose anyway.** Measured on real turns: one
 *    `get_contract_audit` result is ~5,700 tokens, a live browser audit ~21,000,
 *    a source read ~36,000. The user's questions and the model's answers are a
 *    rounding error beside any one of those. Summarising the cheap part to
 *    protect the expensive part gets the trade backwards.
 *
 * So compaction elides **old tool results** and keeps every word of the
 * conversation verbatim. It costs no model call, cannot invent, cannot round a
 * number, and cannot upgrade "unresolved" to "clean".
 *
 * ## What replaces an elided result
 *
 * Not an empty object, and not silence. An elided result that reads as `{}` is
 * a tool that found nothing, and the model will narrate it as such — the exact
 * laundering in §4's table, manufactured by our own optimiser. The placeholder
 * says plainly that the content was removed, names the tool, and says it can be
 * read again.
 *
 * ## What is never touched
 *
 * - The most recent `KEEP_RECENT_TURNS` turns, whole. They are the thread.
 * - Every `tool_use` block, including its opaque `signature` — Gemini rejects
 *   the next request if a thought signature is not echoed back verbatim, and
 *   the `tool_use_id` pairing is what keeps a transcript legal at all.
 * - The page's own message list. Compaction shrinks the MODEL-facing transcript
 *   only; the user keeps seeing everything they already saw.
 *
 * ## This only bites on BYOK
 *
 * On the our-models path the tool loop runs server-side and only prose comes
 * back, so the stored transcript never contains a `tool_result` at all — there
 * is nothing here to elide, and pressing COMPACT correctly does nothing (the
 * button is not offered until the conversation is under pressure, which on that
 * path takes a genuinely long conversation of pure prose). On BYOK the browser
 * runs the loop and carries every tool result into every later turn, which is
 * where the weight accumulates and where this earns its place.
 */

import type { CanonicalMessage } from "./providers";
import { approxTokens } from "./history";

/** Turns kept whole at the recent end. Two, because a follow-up usually refers
 *  to the answer before last, not just the last one. */
export const KEEP_RECENT_TURNS = 2;

/** Below this, eliding costs more in placeholder text than it saves. */
export const MIN_ELIDABLE_CHARS = 400;

export interface Compaction {
  transcript: CanonicalMessage[];
  /** Tool results actually replaced. Zero means nothing was worth eliding. */
  elided: number;
  tokensBefore: number;
  tokensAfter: number;
}

export function elisionText(toolName: string | null): string {
  const named = toolName ? `\`${toolName}\`` : "a tool";
  return (
    `[This ${named} result was removed from the model's working memory to keep ` +
    `the conversation within its limit. It is NOT an empty result and NOT a ` +
    `finding that nothing was found — the data was read successfully and then ` +
    `dropped here to save space. Do not describe this as the tool returning ` +
    `nothing. If a figure from it is needed, call the tool again.]`
  );
}

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

function isToolResult(block: unknown): block is ToolResultBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "tool_result"
  );
}

/** Best-effort name for the placeholder. Absent is fine — it degrades to "a tool". */
function toolNameFor(
  messages: CanonicalMessage[],
  upTo: number,
  toolUseId: string | undefined,
): string | null {
  if (!toolUseId) return null;
  for (let i = upTo; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as { type?: unknown; id?: unknown; name?: unknown };
      if (b?.type === "tool_use" && b.id === toolUseId && typeof b.name === "string") {
        return b.name;
      }
    }
  }
  return null;
}

/**
 * Index of the first message belonging to the last `keepTurns` turns.
 *
 * A turn starts at a plain user message — the same boundary `trim()` cuts on,
 * and for the same reason: anything carrying a `tool_result` is mid-exchange.
 */
export function recentTurnStart(messages: CanonicalMessage[], keepTurns: number): number {
  const boundaries: number[] = [];
  messages.forEach((m, i) => {
    if (m.role !== "user") return;
    if (typeof m.content === "string") boundaries.push(i);
    else if (Array.isArray(m.content) && !m.content.some((b) => (b as { type?: unknown })?.type === "tool_result")) {
      boundaries.push(i);
    }
  });
  if (boundaries.length <= keepTurns) return 0;
  return boundaries[boundaries.length - keepTurns];
}

export function compactTranscript(
  messages: CanonicalMessage[],
  keepTurns: number = KEEP_RECENT_TURNS,
): Compaction {
  const tokensBefore = approxTokens(messages);
  const cutoff = recentTurnStart(messages, keepTurns);
  if (cutoff === 0) {
    // Nothing older than the turns we promised to keep. Returning the input
    // array unchanged (not a copy) lets a caller compare by identity to see
    // that nothing happened.
    return { transcript: messages, elided: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  let elided = 0;
  const transcript = messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (!Array.isArray(message.content)) return message;

    let touched = false;
    const content = message.content.map((block) => {
      if (!isToolResult(block)) return block;
      const serialized =
        typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? null);
      if (serialized.length < MIN_ELIDABLE_CHARS) return block;
      touched = true;
      elided += 1;
      // Spread first so `tool_use_id` and any provider-specific key survive;
      // only `content` is replaced.
      return { ...block, content: elisionText(toolNameFor(messages, index, block.tool_use_id)) };
    });

    return touched ? ({ ...message, content } as CanonicalMessage) : message;
  });

  return { transcript, elided, tokensBefore, tokensAfter: approxTokens(transcript) };
}
