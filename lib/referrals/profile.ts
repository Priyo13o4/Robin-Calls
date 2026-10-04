/**
 * Nickname and emoji cleaning. Pure, so the rules can be tested against the
 * awkward inputs directly (tests/referral-profile.test.ts).
 *
 * React escapes markup, so this is not about XSS. It is about what a name can
 * do to the LEADERBOARD it sits on: a bidi override reverses the rest of the
 * row, a zero-width run makes two different names look identical, and a newline
 * breaks the layout. Those are stripped rather than rejected — someone pasting
 * a name with a stray character should get their name, not an error.
 */

/**
 * Control characters, zero-width marks, bidi overrides, word joiners, BOM.
 *
 * Written as escapes rather than literals: these are invisible in an editor, so
 * a literal class is a range nobody reviewing this file can read.
 *
 * \u0009-\u000D -- tab, newline, vertical tab, form feed, carriage return -- are
 * DELIBERATELY excluded. They are whitespace, and deleting them joins the words
 * on either side ("Don\nVito" became "DonVito"). They fall through to the `\s+`
 * collapse below, which turns each run into a single space.
 */
const INVISIBLE = /[\u0000-\u0008\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export const NICKNAME_MAX = 24;
export const EMOJI_MAX = 8;

/**
 * The cleaned nickname, or null to CLEAR it. Empty input is a real edit — it is
 * how someone removes a name they no longer want — so it is never an error.
 */
export function cleanNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  const capped = [...cleaned].slice(0, NICKNAME_MAX).join("");
  return capped.length === 0 ? null : capped;
}

/**
 * The cleaned emoji, or null to clear it.
 *
 * Must contain at least one pictographic character, so this field cannot be
 * used as a second nickname slot that sidesteps the length limit. Sliced by
 * CODE POINT, not by `.length`: most emoji are surrogate pairs, and a raw slice
 * cuts one in half and renders as a replacement glyph.
 */
export function cleanEmoji(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const stripped = input.replace(INVISIBLE, "").trim();
  if (stripped.length === 0) return null;
  if (!/\p{Extended_Pictographic}/u.test(stripped)) return null;
  return [...stripped].slice(0, EMOJI_MAX).join("");
}

/**
 * True when a name carries a link. Names are shown beside a wallet on a public
 * board, so a URL there is an advert or a phishing lure with our UI around it.
 * Deliberately broad ("mr.bean" trips it): a refused name costs one edit, a
 * missed link costs a user.
 */
export function nicknameHasLink(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const s = input.replace(INVISIBLE, "").replace(/[\u3002\uFF0E\uFF61]/g, ".");
  return /(https?:|ftp:|www\.|\/\/)|[\p{L}\p{N}-]+\.[\p{L}]{2,}/iu.test(s);
}
