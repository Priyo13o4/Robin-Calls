import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ── KNOWN-PROBLEMS L65 / L66 ──
//
// `verifyTrustedAddress` computes keccak256(getCode(addr)) for an lp-locker and
// the admin action returned it to the screen and DROPPED it, so 6 of 8 locker
// rows in prod carry verify_status='ok' with no codehash: an all-clear that
// cannot say which bytecode earned it, and therefore cannot notice the day that
// bytecode changes. Same shape as L70 — computed live, never written down.
//
// WIRING only (§8 #10): the defect is one missing merge at one call site.

test("the admin save persists the MEASURED codehash, not just typed metadata", () => {
  const src = readFileSync("app/admin/(dashboard)/trusted/actions.ts", "utf8");
  const save = src.slice(src.indexOf("const probe = await verifyTrustedAddress"));
  const upsert = save.slice(0, save.indexOf("clearTrustedAddressCache"));
  assert.match(upsert, /measured\.codehash/);
  assert.match(upsert, /codehashVerifiedAt/);
  // The measurement must be applied AFTER the admin's JSON, so a hand-typed
  // codehash cannot beat the one we actually read.
  const spread = upsert.match(/metadata = \{ \.\.\.metadata, codehash: [^}]+\}/);
  assert.ok(spread, "the probe's codehash must override, not be overridden");
});

test("a locker seeded by migration carries its codehash", () => {
  // A row inserted straight at verify_status='ok' never passes through the probe
  // above, so the fingerprint has to be in the seed or it will never exist.
  const sql = readFileSync("supabase/migrations/0078_uncx_locker_trusted_address.sql", "utf8");
  assert.match(sql, /"grantsLockedCredit":true/, "this row does grant an all-clear");
  assert.match(
    sql,
    /"codehash":"0x325ad147a61d60ecaee0e60d066043f956c789a14a341c93429e966f9371d210"/,
    "chain-read 2026-09-01 from 0xf28704c691290547924e2129d407da36bda8ce0f",
  );
});
