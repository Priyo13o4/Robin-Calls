import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// KNOWN-PROBLEMS L97. Pons V2's `TokenLaunched` has no `creator` field — only
// `deployer`, whoever sent the deploy call. Measured on chain 2026-09-05 over
// every Pons token carrying a verdict: 21 of 59 stored the wrong person, and in
// all 21 the stored address was exactly the event's `deployer`. One of them was
// Multicall3. The published sentences were three exonerations ("no prior
// launches on record", "funding lineage is clean") of someone who did not
// launch the token, while the real launcher was never checked at all.
//
// A behavioural test cannot reach this: the adapter's failure is that it never
// ASKS the factory. So these assert the wiring (§8 #10) — that the subject is
// read from protocol state and never from the event's actor (§8 #19).

const src = readFileSync(new URL("../lib/launches/modules/pons-v2.ts", import.meta.url), "utf8");
const records = readFileSync(new URL("../lib/launches/pons-v2-records.ts", import.meta.url), "utf8");

test("the decoded draft never takes the event's deployer as creator", () => {
  assert.ok(!/creatorAddress:\s*(a\.)?deployer/.test(src), "TokenLaunched's `deployer` is the deploy caller");
  assert.match(src, /creatorAddress: null,/);
});

test("the creator is read from the factory's own record", () => {
  // Record deployer or fee recipient, whichever is a person; never the tx caller (L141, L173).
  assert.match(src, /const recFeeRecipient =\s*val\.creatorFeeRecipient/);
  assert.match(src, /creatorAddress = recDeployer;/);
  assert.match(src, /creatorAddress = recFeeRecipient;/);
});

test("an unreadable factory record leaves the creator UNKNOWN, not the caller", () => {
  // §4: enrich only overwrites on a successful read, and no fallback names the caller.
  const enrich = src.slice(src.indexOf("async enrich"));
  assert.ok(enrich.length > 0, "enrich must be findable");
  assert.match(enrich, /if \(rec\?\.status === "success" && rec\.value && rec\.value\.exists\)/);
  assert.ok(!/\?\?\s*(d\.detail\??\.)?deployer/.test(enrich), "no fallback to the deploy caller");
});

test("the launch record carries both identities so they can be told apart", () => {
  const iface = records.slice(records.indexOf("export interface PonsV2LaunchRecord"));
  const body = iface.slice(0, iface.indexOf("}"));
  assert.match(body, /creatorFeeRecipient: Address;/);
  assert.match(body, /deployer: Address;/);
});

test("a dev buy is matched against either identity", () => {
  // L141: through the Pons V2 router the creator is `recipient`, so both topics count.
  assert.match(src, /x === creator \|\| x === deployer/);
  assert.match(src, /isCreator\(buyer\) \|\| isCreator\(recipient\)/);
});

test("the backfill for the 21 wrong rows is guarded on the value it replaces", () => {
  const sql = readFileSync(
    new URL("../scripts/backfill-l97-pons-creator.sql", import.meta.url),
    "utf8",
  );
  const updates = sql.match(/^update curve_tokens set creator_address/gm) ?? [];
  assert.equal(updates.length, 21);
  // Re-runnable and non-destructive: every statement names the old value, so a
  // row already corrected — by this script or by a resync — is left alone.
  assert.equal((sql.match(/and lower\(creator_address\) = '0x/g) ?? []).length, 21);
});
