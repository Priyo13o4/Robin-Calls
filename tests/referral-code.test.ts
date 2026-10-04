import test from "node:test";
import assert from "node:assert/strict";

import {
  CODE_ALPHABET,
  CODE_LENGTH,
  CODE_PATTERN,
  REFERRAL_QUERY_PARAM,
  deriveReferralCode,
  normaliseCode,
  referralLink,
} from "@/lib/referrals/code";

const WALLET = "0x1111111111111111111111111111111111111111";

test("the alphabet is Crockford base32 — 32 distinct symbols, none of them a lookalike", () => {
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32, "a repeated symbol would make two codes collide");
  // The whole reason for this alphabet: these four are what get confused when a
  // code is read off a phone screen or spoken aloud.
  for (const c of ["I", "L", "O", "U"]) {
    assert.ok(!CODE_ALPHABET.includes(c), `${c} must not be in the alphabet`);
  }
});

test("a derived code is stable, well-formed, and different per wallet", () => {
  const a = deriveReferralCode(WALLET);
  assert.equal(a.length, CODE_LENGTH);
  assert.ok(CODE_PATTERN.test(a), `${a} does not match the shape the DB constraint enforces`);
  assert.equal(a, deriveReferralCode(WALLET), "derivation must be deterministic");
  assert.notEqual(a, deriveReferralCode("0x2222222222222222222222222222222222222222"));
});

test("case does not change a wallet's code — the address is lowercased at the boundary", () => {
  // Addresses arrive checksummed from wallets and lowercased from the database.
  // If those produced different codes, the same wallet would own two.
  assert.equal(deriveReferralCode(WALLET.toUpperCase().replace("0X", "0x")), deriveReferralCode(WALLET));
});

test("the attempt counter yields a different code, for collision resolution only", () => {
  assert.notEqual(deriveReferralCode(WALLET, 0), deriveReferralCode(WALLET, 1));
});

test("normalisation maps the lookalikes rather than rejecting them", () => {
  const code = deriveReferralCode(WALLET);
  assert.equal(normaliseCode(code.toLowerCase()), code);
  assert.equal(normaliseCode(`  ${code}  `), code);
  // O→0 and I/L→1 are Crockford's substitutions. Someone reading a code aloud
  // says "oh", and the listener must land on the same wallet.
  assert.equal(normaliseCode("0BCD2345"), "0BCD2345");
  assert.equal(normaliseCode("OBCD2345"), "0BCD2345");
  assert.equal(normaliseCode("1BCD2345"), "1BCD2345");
  assert.equal(normaliseCode("IBCD2345"), "1BCD2345");
  assert.equal(normaliseCode("LBCD2345"), "1BCD2345");
  // Hyphens and spaces get inserted when people copy by hand.
  assert.equal(normaliseCode("0BCD-2345"), "0BCD2345");
  assert.equal(normaliseCode("0BCD 2345"), "0BCD2345");
});

test("a code that cannot be one is null, never a best-effort guess", () => {
  // The failure this pins: a silently "corrected" code credits the WRONG
  // referrer, which is worse than telling the user it does not exist.
  assert.equal(normaliseCode("short"), null);
  assert.equal(normaliseCode("0BCD23456"), null, "too long");
  assert.equal(normaliseCode("0BCD234!"), null, "symbol outside the alphabet");
  assert.equal(normaliseCode(""), null);
  assert.equal(normaliseCode(null), null);
  assert.equal(normaliseCode(undefined), null);
  assert.equal(normaliseCode(42 as unknown as string), null);
});

test("the share link uses the one parameter name the page reads", () => {
  const link = referralLink("https://robincalls.xyz", "0BCD2345");
  assert.equal(link, "https://robincalls.xyz/token-sale?ref=0BCD2345");
  assert.equal(REFERRAL_QUERY_PARAM, "ref");
  // A trailing slash on the origin must not produce a double slash — the link
  // is pasted into chat apps that will not forgive it.
  assert.equal(referralLink("https://robincalls.xyz/", "0BCD2345"), link);
});

test("derived codes do not collide across a realistic participant count", () => {
  // Not a proof, a smoke alarm: at 5,000 wallets a collision means the
  // derivation is losing entropy somewhere, and the unique index would then be
  // rejecting real users rather than catching a freak event.
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    seen.add(deriveReferralCode(`0x${i.toString(16).padStart(40, "0")}`));
  }
  assert.equal(seen.size, 5000);
});
