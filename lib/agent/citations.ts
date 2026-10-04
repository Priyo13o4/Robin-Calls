"use client";

/**
 * Citation-or-silence for the BYOK loop. A port of
 * `services/agent/app/citations.py`, and it must stay one.
 *
 * ── Why this exists in TypeScript at all ────────────────────────────────────
 *
 * Under BYOK the whole agent loop runs in the browser and `/agent/chat` is
 * never called, so the Python validator never sees the answer. BYOK is the
 * path most users will be on (our-models refuses a key until metering lands),
 * which means without this file the product's central claim — *the narrator
 * cannot state a number no tool returned* — would be false on the default
 * path while the UI kept saying it was true.
 *
 * That is worse than having no validator: the page would render an
 * "ON THE RECORD · EVERY FIGURE CITED" strip over unchecked text.
 *
 * ── Divergence is the failure mode ──────────────────────────────────────────
 *
 * Two implementations of one rule drift, and drift here is invisible: the two
 * paths would strip different sentences and nobody would notice until someone
 * compared them. `tests/agent-citations.test.ts` pins the shared cases, and the
 * constants below are transcribed rather than re-derived — if you change one
 * side, change both, and add the case to both suites.
 *
 * The design bias is Python's and is repeated here because it is the part
 * people try to "improve": **strip whole sentences, never rewrite them.**
 * Rewriting generates replacement text that itself needs validating, and a
 * partially-edited sentence can invert its own meaning — dropping "not" from
 * "liquidity is not locked" is a worse outcome than dropping the sentence.
 */

/** A number worth checking: percentages, scores, dollar amounts, counts. */
const NUMBER = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])/g;

/**
 * Sentence split that does not break on decimals, ellipses, or `0x…` hex.
 *
 * A NEWLINE is a boundary too. Breaking only on `[.!?]` + capital made a whole
 * markdown block — heading plus bullets — into one "sentence", so a single
 * uncitable number deleted the entire section. Observed live: an answer about
 * proxy patterns ended at a bare "### 4." because the text under it said
 * EIP-2535. Stripping must cost a claim, not a chapter.
 * Transcribed from `citations._SENTENCE` — keep the two identical.
 */
const SENTENCE = /(?<=[.!?])\s+(?=[A-Z(\[])|\n+/g;

/**
 * Standards, versions and list ordinals are NAMES spelled with digits — the
 * same category as the `0x…` hex already scrubbed, and no more a measurement
 * than "Route 66" is a distance.
 *
 * Without this, `ALWAYS_ALLOWED` happened to list 1967, 20, 721 and 1155, so
 * exactly four standards were sayable and every other one was censored: the
 * Robin Knight could not write "EIP-1167" or "ERC-4626" at all. An allowlist of
 * individual standards is wrong the day the next one ships; matching the FORM
 * is not. Transcribed from `citations._IDENTIFIER_FORMS`.
 */
const IDENTIFIER_FORMS = [
  /\b(?:eip|erc|bip|slip)[\s\-_]?\d+\b/gi,
  /\bv\d+(?:\.\d+)*(?:\+[\w.]+)?\b/gi,
  /\b(?:uint|int|bytes)\d+\b/gi,
  /^[ ]{0,3}#{1,6}[ ]*\d+[.)]?/gm,
  /^[ ]{0,3}\d+[.)][ ]/gm,
];

/**
 * Numbers that are not claims about the chain. Small integers appear in
 * ordinary prose far more often than they appear as findings, and flagging them
 * would strip readable English while catching nothing. A fabricated score is
 * never in this set.
 */
const UNREMARKABLE = new Set([
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "100",
]);

/** Years and the chain id read as numbers but are context, not measurements. */
const ALWAYS_ALLOWED = new Set(["4663", "1967", "20", "721", "1155"]);

function canonical(token: string): string {
  let value = token.replace(/,/g, "");
  if (value.includes(".")) value = value.replace(/0+$/, "").replace(/\.$/, "");
  return value || "0";
}

function roundsTo(claim: string, known: string): boolean {
  const a = Number(claim);
  const b = Number(known);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  if (b === 0) return false;
  // Within 1% covers honest rounding and unit-scaling in prose ("about 72" of
  // a score stored as 72.0, "$1.2M" of 1234567). It does not cover a
  // different number.
  return Math.abs(a - b) / Math.abs(b) <= 0.01;
}

function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((m) => m[1]);
}

/** Every numeric token that appeared in this turn's tool results. */
export class Citations {
  readonly values = new Set<string>();

  /**
   * Harvest numbers from one tool result, at any nesting depth.
   *
   * Serializing rather than walking typed fields is intentional: a new tool
   * returning a new shape is covered the day it ships, with no registration
   * step to forget. The cost is permissiveness — a number appearing anywhere
   * in any result satisfies a claim — and that is the right bias. This catches
   * invention out of nothing, not which of several real numbers was quoted.
   */
  addResult(payload: unknown): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload) ?? "";
    } catch {
      serialized = String(payload);
    }
    for (const token of numbersIn(serialized)) {
      this.values.add(token);
      this.values.add(canonical(token));
    }
  }

  supports(token: string): boolean {
    const value = canonical(token);
    if (this.values.has(value) || this.values.has(token)) return true;
    for (const known of this.values) {
      if (roundsTo(value, known)) return true;
    }
    return false;
  }
}

export interface Validation {
  text: string;
  stripped: string[];
}

export function unsupportedNumbers(sentence: string, citations: Citations): string[] {
  const found: string[] = [];
  // Hex strings (addresses, hashes) are identifiers, not measurements, and
  // their digits would otherwise read as claims.
  let scrubbed = sentence.replace(/0x[0-9a-fA-F]+/g, " ");
  for (const form of IDENTIFIER_FORMS) scrubbed = scrubbed.replace(form, " ");
  for (const token of numbersIn(scrubbed)) {
    const value = canonical(token);
    if (UNREMARKABLE.has(value) || ALWAYS_ALLOWED.has(value)) continue;
    if (!citations.supports(token)) found.push(token);
  }
  return found;
}

/** Split into [body, separator] pairs so the separator can be put back. */
function segments(text: string): [string, string][] {
  const out: [string, string][] = [];
  let position = 0;
  const rx = new RegExp(SENTENCE.source, "g");
  let match: RegExpExecArray | null;
  while ((match = rx.exec(text)) !== null) {
    if (match[0].length === 0) { rx.lastIndex += 1; continue; }
    out.push([text.slice(position, match.index), match[0]]);
    position = match.index + match[0].length;
  }
  out.push([text.slice(position), ""]);
  return out;
}

/** Strip sentences making numeric claims no tool result supports. */
export function validate(text: string, citations: Citations): Validation {
  if (!text.trim()) return { text, stripped: [] };

  const kept: string[] = [];
  const stripped: string[] = [];

  // Each piece keeps the whitespace that FOLLOWED it and is rejoined with that
  // whitespace intact. Joining on a single space normalised every separator and
  // flattened headings and bullet lists onto one line — a reply the validator
  // had passed still came out mangled, and now that newlines are boundaries it
  // would mangle every list. Mirrors `citations._segments`.
  for (const [body, separator] of segments(text)) {
    if (unsupportedNumbers(body, citations).length > 0) {
      stripped.push(body.trim());
      continue;
    }
    kept.push(body + separator);
  }

  let result = kept.join("").trim();

  if (stripped.length > 0 && !result) {
    // Everything failed. Refusing is correct: a reply assembled entirely from
    // invented numbers has no salvageable remainder, and empty text would read
    // as a system glitch rather than a refusal. Wording matches citations.py.
    result =
      "I can't answer that from what the tools returned — the numbers I " +
      "would need aren't in the record I was given. Try asking for a " +
      "specific verdict or check, and I'll quote what's actually stored.";
  }

  return { text: result, stripped };
}
