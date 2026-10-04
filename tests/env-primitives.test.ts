import test from "node:test";
import assert from "node:assert/strict";
import { firstSet } from "../lib/config/env";

/**
 * `firstSet` exists because of one specific production failure, and these
 * cases are that failure rather than a tour of the function.
 *
 * CI passes a build-arg for every NEXT_PUBLIC_ var whether or not the repo
 * Variable exists, and Dockerfile.prod's `ENV X=$X` turns an unset one into
 * the EMPTY STRING. Every reader that used `??` therefore selected "" and its
 * own fallback, written on the next line, became unreachable.
 */
test("the empty string does not win — that is the whole point", () => {
  assert.equal(firstSet("") ?? "fallback", "fallback");
  assert.equal(firstSet(undefined, "") ?? "fallback", "fallback");
  assert.equal(firstSet("", "") ?? "fallback", "fallback");
  // `??` is what shipped, and this is why it was wrong. Sourced through a
  // function so the compiler cannot narrow the empty string away, which is
  // exactly what it does at the real call sites too.
  const asEnv = (v: string): string | undefined => v;
  assert.equal(asEnv("") ?? "fallback", "", "`??` selects the empty string — the bug this function exists to prevent");
});

test("the first value that is actually set wins, in order", () => {
  assert.equal(firstSet("a", "b"), "a");
  assert.equal(firstSet(undefined, "b"), "b");
  assert.equal(firstSet("", "b"), "b");
  // A server-only var is `undefined` in the browser, so the public one is
  // what survives there — the mechanism lib/config/chain.ts relies on.
  assert.equal(firstSet(undefined, "public"), "public");
});

test("nothing set returns undefined, so `??` can reach a literal fallback", () => {
  assert.equal(firstSet(), undefined);
  assert.equal(firstSet(undefined, ""), undefined);
});

test("whitespace and \"false\" are values, not absence", () => {
  // Absence is what this detects; it must not start judging content.
  assert.equal(firstSet(" "), " ");
  assert.equal(firstSet("false"), "false");
  assert.equal(firstSet("0"), "0");
});
