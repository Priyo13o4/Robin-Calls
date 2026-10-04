import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * "We could not reach the chain" must never be published for a read that is
 * still in flight.
 *
 * The bug: `useSaleData` exposed only `live`, which was false BOTH before the
 * first client read had settled and after one had failed. /token-sale keyed its
 * error banner on `!live`, so every ordinary page load flashed "Couldn't reach
 * the chain just now" — an error message for a request that had not finished,
 * sitting next to a vault panel that was rendering fine. §4 at the presentation
 * layer: not-yet is not a failure.
 *
 * Pinned as source text because the states only differ across an async
 * boundary, and the repo's suite has no DOM or renderer to drive one. The
 * claims below are the two that actually decide what a reader sees.
 */

const hook = readFileSync(join(process.cwd(), "lib", "sale", "useSaleData.ts"), "utf8");
const page = readFileSync(join(process.cwd(), "app", "token-sale", "SalePageClient.tsx"), "utf8");

test("the hook distinguishes not-yet from failed", () => {
  assert.match(
    hook,
    /"loading"\s*\|\s*"live"\s*\|\s*"stale"/,
    "useSaleData must expose three load states, not a live boolean",
  );
});

test('only a read that actually ran and threw may set "stale"', () => {
  // The whole fix in one assertion. `setStatus("stale")` belongs in the catch
  // and nowhere else — setting it anywhere reachable before a read completes
  // reintroduces the flash exactly as before.
  const occurrences = hook.match(/setStatus\("stale"\)/g) ?? [];
  assert.equal(occurrences.length, 1, 'setStatus("stale") must appear exactly once');

  const catchIndex = hook.indexOf("} catch {");
  const staleIndex = hook.indexOf('setStatus("stale")');
  const finallyIndex = hook.indexOf("} finally {");
  assert.ok(catchIndex !== -1 && finallyIndex !== -1, "refresh() no longer has the expected try/catch/finally");
  assert.ok(
    staleIndex > catchIndex && staleIndex < finallyIndex,
    '"stale" is set outside the catch — it would fire without a failed read',
  );
});

test("a missing contract address is not a failed read", () => {
  // No address to point at is configuration, not an unreachable chain. The
  // early return must leave the status at "loading".
  const refreshStart = hook.indexOf("const refresh = useCallback");
  const body = hook.slice(refreshStart, hook.indexOf("}, [addr, client, walletAddress])", refreshStart));
  const earlyReturn = body.slice(0, body.indexOf("return;"));
  assert.match(earlyReturn, /setStatus\("loading"\)/, "the no-address branch must not leave a stale status behind");
});

test("the page's error notice keys on the failure, not on the absence of a success", () => {
  assert.match(
    page,
    /status === "stale"/,
    'the "couldn\'t reach the chain" notice must key on status === "stale"',
  );
  assert.doesNotMatch(
    page,
    /\{sale && !live && \(/,
    '`sale && !live` is back — that is true during the ordinary first paint',
  );
});

/**
 * The reader is not an operator. A partial read named the exact fields that
 * faulted ("feeAddress1, feeAddress2, feeAddress1Bps, …") in a banner on the
 * public sale page, which is both unactionable and reads as broken software.
 * The field list belongs in the console; the page gets one plain sentence.
 * The admin panel is deliberately exempt: there, the names ARE the answer.
 */
test("the public page never prints which internal fields faulted", () => {
  assert.doesNotMatch(
    page,
    /faults\.join/,
    "the fault field list is being rendered to visitors again",
  );
  assert.doesNotMatch(
    page,
    /refused some fields/,
    "the leaky banner copy is back on the public page",
  );
  // `faults` may still be READ here — it decides whether to notify at all, and
  // travels to the console as `debug`. What it may not do is become copy.
  assert.match(
    page,
    /console\.warn\("\[sale\] partial read"/,
    "faults must reach the console, or nobody can diagnose a partial read",
  );
});

test("chain trouble is announced through the shared toast, not an inline banner", () => {
  assert.match(
    page,
    /from "@\/components\/ui\/use-toast"/,
    "the sale page no longer raises its notice through the toast store",
  );
  // One id, so a read that fails on every retry updates one row rather than
  // stacking one per attempt (§8 #4: a repeated transient must not compound).
  assert.match(page, /id: CHAIN_TOAST_ID/, "the chain toast is no longer keyed to a stable id");
  assert.match(
    page,
    /duration: null/,
    "chain trouble must not auto-dismiss while it is still true",
  );
});

test("a load in progress says so, rather than saying nothing or saying failure", () => {
  assert.match(page, /status === "loading" &&/, "there is no in-flight state for the reader to see");
});


/**
 * The Retry action in the chain-trouble toast must actually re-read.
 *
 * It was wired to the plain `refresh`, which drops the call whenever a poll is
 * already running (`if (inFlight.current) return`). The 15s poll is short and a
 * FAILING read is slow, so the collision window is widest during exactly the
 * condition the toast exists for: the button did nothing at the moment it was
 * most likely to be pressed, and said nothing either way.
 */
test("Retry forces a read instead of joining the in-flight one", () => {
  assert.match(
    hook,
    /opts\?: \{ force\?: boolean \}/,
    "refresh no longer takes a force option, so Retry cannot bypass the guard",
  );
  assert.match(
    hook,
    /if \(inFlight\.current > 0 && !opts\?\.force\) return;/,
    "the single-flight guard no longer exempts a forced read (§5)",
  );
  assert.match(
    page,
    /refreshRef\.current\(\{ force: true \}\)/,
    "the toast's Retry is back to the droppable refresh",
  );
});

test("a superseded read cannot overwrite a fresher one", () => {
  // Forcing allows two reads at once, so ordering by START is what stops a slow
  // older poll from landing on top of the fresh result the user just asked for.
  assert.match(hook, /const mine = \+\+seq\.current;/, "the read-ordering guard is gone");
  const writes = hook.match(/if \(seq\.current !== mine\) return;/g) ?? [];
  assert.equal(writes.length, 2, "both the success and failure writes must check they are still the latest read");
});

test("the reader can tell a pressed Retry from a dead button", () => {
  // On a failed retry the toast is replaced with identical text, so without a
  // pending label a working button and a broken one look the same.
  assert.match(page, /refreshing \? "Checking/, "the Retry action has no pending state");
});
