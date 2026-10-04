import test from "node:test";
import assert from "node:assert/strict";
import { staleBuildAdvice } from "../lib/agent/client-tools";

/**
 * Observed in the local smoke stack, 2026-08-06:
 *
 *   {"ok": false, "transient": true,
 *    "error": "Failed to load chunk /_next/static/chunks/2o9_hk00kazod.js from module 531029"}
 *
 * The audit was fine — the same address audited cleanly on a reloaded page
 * seconds later. The tab had simply been open across a rebuild, and
 * `run_contract_audit` imports its analysis lazily, so the chunk it wanted had
 * been replaced by a differently-named one.
 *
 * What made it worth fixing is not the failure but the ADVICE. Every client
 * tool failure is `transient`, the model reads transient as retryable, and it
 * told the user to "try again in a moment" — for a condition that no amount of
 * waiting resolves. The page has to reload.
 */

test("a chunk-load failure is recognised and answered with a reload, not a retry", () => {
  const raw = "Failed to load chunk /_next/static/chunks/2o9_hk00kazod.js from module 531029";
  const advice = staleBuildAdvice(raw);

  assert.ok(advice, "the exact error seen in production was not recognised");
  assert.match(advice, /reload/i, "must tell the user the one action that can work");
  assert.doesNotMatch(
    advice,
    /try again in a moment|wait a moment/i,
    "must not repeat the advice that can never succeed",
  );
  assert.ok(advice.includes(raw), "the raw text has to survive into the exported transcript");
  assert.match(advice, /not a finding about the contract/i, "our outage must never read as evidence");
});

test("the other webpack/vite phrasings of the same failure are covered", () => {
  for (const raw of [
    "ChunkLoadError: Loading chunk 4821 failed.",
    "error loading dynamically imported module: /_next/static/chunks/abc.js",
    "Importing a module script failed.",
  ]) {
    assert.ok(staleBuildAdvice(raw), `unrecognised: ${raw}`);
  }
});

test("an ordinary RPC fault is left exactly as it was", () => {
  // The branch must be narrow. A rate limit or a revert has to keep its own
  // words — rewriting those into "reload the page" would be a second wrong
  // instruction, in the opposite direction.
  for (const raw of [
    "HTTP request failed. Status: 429 Too Many Requests",
    "The contract function \"facets\" reverted.",
    "Endpoint is on chain 1, not Robinhood Chain (4663).",
    "timed out while waiting for a response",
  ]) {
    assert.equal(staleBuildAdvice(raw), null, `wrongly claimed a stale build: ${raw}`);
  }
});
