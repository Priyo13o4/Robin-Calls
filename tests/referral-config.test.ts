import test from "node:test";
import assert from "node:assert/strict";

import { positiveBigint, positiveInt } from "@/lib/referrals/config";

test("positiveInt parses valid integers and reports out of range values", () => {
  const invalid: string[] = [];
  assert.equal(positiveInt("5", 3, "test_key", invalid, 1), 5);
  assert.equal(invalid.length, 0);

  assert.equal(positiveInt(undefined, 3, "test_key", invalid, 1), 3);
  assert.equal(invalid.length, 0);

  assert.equal(positiveInt("0", 3, "test_key", invalid, 1), 3);
  assert.deepEqual(invalid, ["test_key"]);

  assert.equal(positiveInt("abc", 3, "test_key2", invalid, 1), 3);
  assert.deepEqual(invalid, ["test_key", "test_key2"]);
});

test("positiveBigint enforces floor and reports zero when min is 1n", () => {
  const invalid: string[] = [];
  const fallback = 100_000_000_000_000_000n;

  // Unset falls back cleanly with nothing in invalidKeys
  assert.equal(positiveBigint(undefined, fallback, "referral_min_referred_wei", invalid, 1n), fallback);
  assert.equal(invalid.length, 0);

  // Above floor parses
  assert.equal(
    positiveBigint("1000", fallback, "referral_min_referred_wei", invalid, 1n),
    1000n,
  );
  assert.equal(invalid.length, 0);

  // Exactly at floor parses
  assert.equal(
    positiveBigint("1", fallback, "referral_min_referred_wei", invalid, 1n),
    1n,
  );
  assert.equal(invalid.length, 0);

  // Zero when floor is 1n must fail and report into invalid
  assert.equal(
    positiveBigint("0", fallback, "referral_min_referred_wei", invalid, 1n),
    fallback,
  );
  assert.deepEqual(invalid, ["referral_min_referred_wei"]);

  // Negative must report into invalid
  assert.equal(
    positiveBigint("-5", fallback, "referral_min_referred_wei", invalid, 1n),
    fallback,
  );
  assert.deepEqual(invalid, ["referral_min_referred_wei", "referral_min_referred_wei"]);

  // Non-numeric string must report into invalid
  assert.equal(
    positiveBigint("not_a_number", fallback, "referral_min_referred_wei", invalid, 1n),
    fallback,
  );
  assert.equal(invalid.length, 3);
});
