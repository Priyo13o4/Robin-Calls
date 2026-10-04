import test from "node:test";
import assert from "node:assert/strict";

import { EMOJI_MAX, NICKNAME_MAX, cleanEmoji, cleanNickname } from "@/lib/referrals/profile";

test("an ordinary nickname survives untouched", () => {
  assert.equal(cleanNickname("Don Vito"), "Don Vito");
});

test("empty clears the field rather than failing", () => {
  // Clearing a name is a real edit. Rejecting it would leave someone stuck with
  // a name they no longer want.
  assert.equal(cleanNickname(""), null);
  assert.equal(cleanNickname("   "), null);
  assert.equal(cleanEmoji(""), null);
});

test("invisible characters are stripped, not rejected", () => {
  // A bidi override reverses the rest of the leaderboard row it sits in, and a
  // zero-width run makes two different names render identically. Both get
  // removed — someone pasting a name with a stray character should get their
  // name back, not an error.
  assert.equal(cleanNickname("Vi‮to"), "Vito");
  assert.equal(cleanNickname("Vi​to"), "Vito");
  assert.equal(cleanNickname("﻿Vito"), "Vito");
  assert.equal(cleanNickname("Vito"), "Vito");
});

test("newlines and runs of whitespace collapse to one space", () => {
  assert.equal(cleanNickname("Don\n\nVito"), "Don Vito");
  assert.equal(cleanNickname("Don    Vito"), "Don Vito");
});

test("a nickname is capped by code point, so a long name is trimmed not mangled", () => {
  const long = "a".repeat(100);
  assert.equal(cleanNickname(long)?.length, NICKNAME_MAX);
  // Emoji are surrogate pairs: a `.slice` by string length cuts one in half and
  // renders as a replacement glyph.
  const emojiName = "🎩".repeat(40);
  const cleaned = cleanNickname(emojiName) ?? "";
  assert.equal([...cleaned].length, NICKNAME_MAX);
  assert.ok(!cleaned.includes("�"), "a half-cut surrogate would render as a replacement glyph");
});

test("the emoji field must actually contain an emoji", () => {
  // Otherwise it is a second nickname slot that sidesteps the length limit.
  assert.equal(cleanEmoji("🎩"), "🎩");
  assert.equal(cleanEmoji("not an emoji"), null);
  assert.equal(cleanEmoji("123"), null);
});

test("the emoji field is capped by code point", () => {
  const many = "🎩".repeat(20);
  assert.equal([...(cleanEmoji(many) ?? "")].length, EMOJI_MAX);
});

test("a non-string is null, never coerced", () => {
  assert.equal(cleanNickname(undefined), null);
  assert.equal(cleanNickname(42), null);
  assert.equal(cleanNickname({}), null);
  assert.equal(cleanEmoji(null), null);
});
