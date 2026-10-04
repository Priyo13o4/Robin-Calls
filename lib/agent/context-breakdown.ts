"use client";

/**
 * Where the context actually went — the detail behind the ring.
 *
 * The ring answers "how full", which is the question that decides whether to
 * press COMPACT. This answers "full of what", which is the question that
 * decides whether COMPACT will help at all: a conversation that is 90% one
 * source read shrinks enormously, and one that is 90% the user's own questions
 * does not shrink at all no matter how many times the button is pressed.
 *
 * ## The parts must sum to the whole
 *
 * This is the whole risk in the module, and it is CLAUDE.md §8.10 in the small:
 * a breakdown that disagrees with the ring beside it is worse than no
 * breakdown, because the reader cannot tell which one to believe.
 *
 * Two things make it exact rather than approximately right:
 *
 * 1. **Chars are attributed the way `approxTokens` counts them**, including the
 *    JSON punctuation. A message's array content costs
 *    `JSON.stringify(content).length`, which is the blocks *plus* `[`, `]` and
 *    one comma between each — so those bytes are attributed too, to their own
 *    slice, rather than quietly lost. They are a real cost and a small one; the
 *    alternative is a breakdown that is always a little short and never says why.
 *
 * 2. **Tokens are allocated by running prefix total, not by flooring each slice
 *    independently.** `approxTokens` floors once over the sum; flooring each
 *    slice would lose up to a token per slice and leave the parts under the
 *    whole by an amount that grows with the number of tools used. Each slice
 *    instead takes the difference between two floored prefix totals, so the
 *    slices sum to exactly `approxTokens(messages)` by construction. The cost
 *    is that an individual slice can be off by one against its own chars, which
 *    is invisible at this scale and the right thing to trade away.
 *
 * ## Recoverable is measured, never estimated
 *
 * `recoverableTokens` runs the real `compactTranscript` and subtracts. Deriving
 * it from "sum of the tool slices" would overstate it every time — compaction
 * keeps the most recent turns whole and ignores results under
 * `MIN_ELIDABLE_CHARS` — and an overstated saving is a button that promises
 * relief it cannot deliver (§8.11: if a number is named for a fact, measure it).
 */

import type { CanonicalBlock, CanonicalMessage } from "./providers";
import { CHARS_PER_TOKEN, approxTokens } from "./history";
import { compactTranscript } from "./compaction";

export type SliceKind = "user" | "assistant" | "tool" | "structure";

export interface ContextSlice {
  /** Stable identity for React keys and tests. `tool:<name>` for tool traffic. */
  key: string;
  label: string;
  kind: SliceKind;
  tokens: number;
  /**
   * Blocks counted into this slice — messages for prose, calls plus results
   * for a tool. A count, not a claim about round trips.
   */
  count: number;
}

export interface ContextBreakdown {
  slices: ContextSlice[];
  /** Equals `approxTokens(messages)`, and equals the sum of the slices. */
  totalTokens: number;
  /** What pressing COMPACT would actually free, from running it. */
  recoverableTokens: number;
}

const UNNAMED_TOOL = "unknown tool";

/** `JSON.stringify` returns `undefined` for `undefined`; inside an array that
 *  serialises as `null`, four characters. Count what the array would cost. */
function serializedLength(value: unknown): number {
  const text = JSON.stringify(value);
  return text === undefined ? 4 : text.length;
}

/**
 * `tool_use_id` → tool name, over the whole transcript.
 *
 * Built in one pass ahead of the walk because a result can be attributed only
 * by the call that asked for it, and compaction may already have replaced the
 * result's body — the id survives that, the content does not.
 */
function toolNames(messages: CanonicalMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      const b = block as { type?: unknown; id?: unknown; name?: unknown } | null;
      if (b?.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        names.set(b.id, b.name);
      }
    }
  }
  return names;
}

interface Bucket {
  label: string;
  kind: SliceKind;
  chars: number;
  count: number;
}

function bucketFor(
  buckets: Map<string, Bucket>,
  key: string,
  label: string,
  kind: SliceKind,
): Bucket {
  const found = buckets.get(key);
  if (found) return found;
  const created: Bucket = { label, kind, chars: 0, count: 0 };
  buckets.set(key, created);
  return created;
}

function classify(
  block: CanonicalBlock | null,
  role: CanonicalMessage["role"],
  names: Map<string, string>,
): { key: string; label: string; kind: SliceKind } {
  const b = block as { type?: unknown; name?: unknown; tool_use_id?: unknown } | null;
  if (b?.type === "tool_use") {
    const name = typeof b.name === "string" ? b.name : UNNAMED_TOOL;
    return { key: `tool:${name}`, label: name, kind: "tool" };
  }
  if (b?.type === "tool_result") {
    const id = typeof b.tool_use_id === "string" ? b.tool_use_id : "";
    const name = names.get(id) ?? UNNAMED_TOOL;
    return { key: `tool:${name}`, label: name, kind: "tool" };
  }
  return role === "user"
    ? { key: "user", label: "Your questions", kind: "user" }
    : { key: "assistant", label: "The agent's answers", kind: "assistant" };
}

/**
 * Order: tools by weight first, then the two prose slices, then the envelope.
 *
 * Not a plain descending sort. Prose is usually small and always present, and
 * letting it drift into the middle of the tool list makes the list read as a
 * ranking of unlike things. What the reader is looking for is which tool is
 * costing them, so the tools are ranked and everything else is context beneath.
 */
const KIND_ORDER: Record<SliceKind, number> = { tool: 0, user: 1, assistant: 2, structure: 3 };

export function breakdownContext(messages: CanonicalMessage[]): ContextBreakdown {
  const totalTokens = approxTokens(messages);
  if (messages.length === 0) {
    return { slices: [], totalTokens, recoverableTokens: 0 };
  }

  const names = toolNames(messages);
  const buckets = new Map<string, Bucket>();

  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      const target = classify(null, message.role, names);
      const bucket = bucketFor(buckets, target.key, target.label, target.kind);
      bucket.chars += typeof message.content === "string" ? message.content.length : 0;
      bucket.count += 1;
      continue;
    }

    // `[`, `]`, and one comma between each pair — exactly what
    // `JSON.stringify(content)` adds over the blocks themselves.
    const envelope = 2 + Math.max(0, message.content.length - 1);
    bucketFor(buckets, "structure", "Message formatting", "structure").chars += envelope;

    for (const block of message.content) {
      const target = classify(block, message.role, names);
      const bucket = bucketFor(buckets, target.key, target.label, target.kind);
      bucket.chars += serializedLength(block);
      bucket.count += 1;
    }
  }

  const ordered = [...buckets.entries()]
    .filter(([, bucket]) => bucket.chars > 0)
    .sort(([, a], [, b]) =>
      KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]
        ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
        : b.chars - a.chars,
    );

  // Prefix totals, so the slices sum to `totalTokens` exactly. See the header.
  let runningChars = 0;
  let issued = 0;
  const slices: ContextSlice[] = ordered.map(([key, bucket]) => {
    runningChars += bucket.chars;
    const upTo = Math.floor(runningChars / CHARS_PER_TOKEN);
    const tokens = upTo - issued;
    issued = upTo;
    return { key, label: bucket.label, kind: bucket.kind, tokens, count: bucket.count };
  });

  const compacted = compactTranscript(messages);
  return {
    slices,
    totalTokens,
    recoverableTokens: Math.max(0, compacted.tokensBefore - compacted.tokensAfter),
  };
}
