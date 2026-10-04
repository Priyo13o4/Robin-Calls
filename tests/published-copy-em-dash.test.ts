import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// ── KNOWN-PROBLEMS L128 ──
//
// CLAUDE.md §10 records an operator decision from 2026-09-06: no em dashes in
// published copy. Nothing enforced it, and 20 sentences across six scoring files
// still carry one.
//
// This is a RATCHET, not a sweep. §10 is explicit that the rewrite is
// opportunistic: a check's sentences get fixed when a bug fix takes you into
// that check, never as a project across six scoring files at once with no
// verdict to trace it against. So each file's current count is pinned here and
// may only ever go DOWN. New copy is held to the rule; old copy decays.
//
// The awkward part is the detector, which is why this is a test and not a grep.
// §4 reserves a STANDALONE "—" as the value placeholder meaning "the chain did
// not answer", and that one must stay: removing it would publish a read failure
// as a number. So the rule is "no em dash inside a sentence", which needs the
// literal extracted rather than the file grepped.

const DIR = new URL("../lib/scanner/checks/", import.meta.url);

/**
 * Strip comments, then take every string literal of more than four words.
 *
 * Four words is the line between prose and a label: `"lp_custody"` and
 * `"live eth_call"` are keys and sources, not sentences a reader is shown.
 */
function publishedSentences(src: string): string[] {
  const noComments = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const out: string[] = [];
  const patterns = [
    /"((?:[^"\\\n]|\\.)*)"/g,
    /'((?:[^'\\\n]|\\.)*)'/g,
    /`((?:[^`\\]|\\.)*)`/g,
  ];
  for (const re of patterns) {
    for (const m of noComments.matchAll(re)) {
      const body = m[1];
      if (body.trim().split(/\s+/).length > 4) out.push(body);
    }
  }
  return out;
}

/** An em dash INSIDE a sentence. The lone §4 placeholder is not one. */
function emDashSentences(src: string): string[] {
  return publishedSentences(src).filter((s) => /\S\s*—|—\s*\S/.test(s.replace(/\$\{[^}]*\}/g, "")));
}

/**
 * The population as measured 2026-09-11, after L137's and L138's passes. Each
 * number may only fall. A file absent from this map must have zero.
 *
 * Do not "fix" a rise by editing the number: the whole value of the ratchet is
 * that new copy cannot add one.
 */
const BASELINE: Record<string, number> = {
  "market-checks.ts": 8,
  // holders-ownership.ts (4) and audit-scoring.ts (2) paid theirs off on
  // 2026-09-11, in the same passes as L136 and L133. Absent means zero, so
  // neither can regain one.
  "custody-materiality.ts": 2,
  "critical-overrides.ts": 2,
  "custody-findings.ts": 1,
};

const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

test("L128: the em-dash population in published copy never grows", () => {
  const rises: string[] = [];
  for (const file of files) {
    const found = emDashSentences(readFileSync(new URL(file, DIR), "utf8"));
    const allowed = BASELINE[file] ?? 0;
    if (found.length > allowed) {
      rises.push(
        `${file}: ${found.length} > ${allowed} allowed. New: ${JSON.stringify(found.slice(0, 3))}`,
      );
    }
  }
  assert.deepEqual(
    rises,
    [],
    `published copy gained an em dash (CLAUDE.md §10). End the sentence and start another, or use a comma or a colon.\n${rises.join("\n")}`,
  );
});

test("L128: the detector actually finds one, and spares the §4 placeholder", () => {
  // §8 #10, for a detector: a regex that matches nothing passes every ratchet
  // it guards. `dangerous-selectors-scope.test.ts` shipped exactly that bug,
  // asserting a subject over an empty list of sentences.
  const sample = `
    const a = "A sentence with an em dash — right here in the middle.";
    const b = "A perfectly ordinary published sentence, no dash at all.";
    const c = "—";
    // a comment with an em dash — which is not published copy
    const d = "short — one";
  `;
  const hits = emDashSentences(sample);
  assert.equal(hits.length, 1, `expected exactly the prose sentence, got ${JSON.stringify(hits)}`);
  assert.match(hits[0], /right here in the middle/);
});

test("L128: a file nobody baselined must be clean", () => {
  // The map is a decaying debt, not an allowlist to extend. A NEW check file
  // starts at zero, and adding its name here would be the rule quietly bending.
  const unknown = files.filter(
    (f) => !(f in BASELINE) && emDashSentences(readFileSync(new URL(f, DIR), "utf8")).length > 0,
  );
  assert.deepEqual(unknown, [], `these files are not in the baseline and carry em dashes: ${unknown}`);
});
