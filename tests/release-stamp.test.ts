import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── KNOWN-PROBLEMS F3a: `release` was null on every error row ever written ──
//
// The reporter read `VERCEL_GIT_COMMIT_SHA`, which Vercel injects at build time
// and which this project sets NOWHERE — not in .env.production, not in either
// compose file, not in the workflows. The fallback always won, so no fault in
// the database could be attributed to the build that produced it.
//
// The defect was never in the reader. It was that nothing SET the value, which
// is why the whole chain is asserted here rather than just the `??` expression:
// a test of the reader alone passes in exactly the broken state.

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

test("the reporter stamps the release from a variable this project actually sets", () => {
  const src = read("../lib/observability/reporter.ts");
  assert.match(src, /release: process\.env\.APP_GIT_SHA/);
  // The READ, not the mention: the comment above that line names the old
  // variable on purpose, so the next person can find why it went away.
  assert.doesNotMatch(
    src,
    /process\.env\.VERCEL_GIT_COMMIT_SHA/,
    "Vercel injects that at build time and nothing here does — it can only ever be null",
  );
});

test("the deploy computes the SHA, and compose hands it to the app container", () => {
  // Both halves, because either one alone leaves `release` exactly as broken as
  // before and neither would fail a test of the other.
  assert.match(
    read("../scripts/deploy-remote.sh"),
    /APP_GIT_SHA=\$\(git rev-parse HEAD\)[\s\S]*export APP_GIT_SHA/,
    "deploy-remote.sh must derive and export the deployed commit",
  );
  assert.match(
    read("../docker-compose.yml"),
    /APP_GIT_SHA: \$\{APP_GIT_SHA:-unknown\}/,
    "the app service must pass it through, defaulting to a legible 'unknown'",
  );
});
