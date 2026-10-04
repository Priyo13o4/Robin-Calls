import test from "node:test";
import assert from "node:assert/strict";
import { Citations, validate } from "../lib/agent/citations";

/**
 * Two live failures, from one exported transcript (2026-08-06).
 *
 * The Robin Knight was asked to explain proxy patterns — a general-knowledge
 * question that called no tools, so `Citations` was empty and every number in
 * the answer was "unsupported". Two things then went wrong at once:
 *
 * 1. `EIP-1167` and `EIP-2535` are NAMES. `ALWAYS_ALLOWED` happened to contain
 *    1967, 20, 721 and 1155, so four standards were sayable and the rest were
 *    censored — an allowlist of individual standards, wrong the day the next
 *    one ships.
 * 2. The splitter only broke on `[.!?]` + capital, so a heading and its bullets
 *    were one "sentence". One bad token deleted the section. The user's export
 *    literally ends at a bare `### 4.`
 *
 * What must NOT change: an invented percentage or score still dies. The point
 * is that it costs a line, not a chapter.
 */

const SECTIONS = `### 3. Minimal Proxy / Clone Pattern (EIP-1167)
*   **How it works:** A fixed-size contract that delegatecalls to one implementation.

### 4. Diamond Pattern (EIP-2535)
*   **How it works:** Many facets behind one address, routed per selector.`;

test("standards, versions and type names are identifiers, not measurements", () => {
  const result = validate(
    "A proxy may follow EIP-1167, EIP 2535, ERC-4626 or ERC20, compiled with " +
      "v0.8.28+commit.7893614a, returning uint256 and bytes32 on Uniswap v3.",
    new Citations(),
  );
  assert.deepEqual(result.stripped, [], `stripped: ${JSON.stringify(result.stripped)}`);
});

test("a whole markdown section is not deleted for one number in it", () => {
  const result = validate(SECTIONS, new Citations());
  assert.deepEqual(result.stripped, []);
  assert.match(result.text, /EIP-1167/);
  assert.match(result.text, /EIP-2535/, "the section that used to vanish");
  assert.match(result.text, /routed per selector/, "the text after the heading came back");
});

test("markdown structure survives — headings and bullets stay on their own lines", () => {
  // The rejoin used to normalise every separator to one space, so a passing
  // answer still rendered as a single run-on paragraph.
  const result = validate(SECTIONS, new Citations());
  assert.ok(result.text.includes("\n"), "every newline was flattened away");
  assert.match(result.text, /^### 3\./, "the first heading lost its line");
  assert.ok(
    result.text.split("\n").some((line) => line.trim().startsWith("*")),
    "bullets were merged into the prose",
  );
});

test("an uncited figure still dies, and costs exactly one line", () => {
  const text = `### 1. Custody
*   The pool is held by a locker contract.
*   It holds 77.4% of the supply.
*   The locker is permanent.`;
  const result = validate(text, new Citations());
  assert.equal(result.stripped.length, 1, "one claim, one strip");
  assert.match(result.stripped[0], /77\.4/);
  assert.doesNotMatch(result.text, /77\.4/, "the invented figure survived");
  assert.match(result.text, /held by a locker contract/, "an innocent neighbour was taken with it");
  assert.match(result.text, /locker is permanent/);
});

test("a figure the tools DID return is still allowed through", () => {
  const citations = new Citations();
  citations.addResult({ evidence: { whalePct: 77.4 } });
  const result = validate("The pool holds 77.4% of supply.", citations);
  assert.deepEqual(result.stripped, []);
});

test("an ERC number cannot smuggle a verdict figure past the check", () => {
  // The scrub removes the identifier, not the rest of the sentence — a claim
  // sitting next to a standard reference is still checked.
  const result = validate("Under ERC-20 the pool holds 93.2% of supply.", new Citations());
  assert.equal(result.stripped.length, 1);
  assert.match(result.stripped[0], /93\.2/);
});
