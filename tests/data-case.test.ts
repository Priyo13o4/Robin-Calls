import test from "node:test";
import assert from "node:assert/strict";
import { snakeToCamel, camelToSnake, rowToSnakeCase } from "../lib/data/case";

/**
 * These pin the bug that broke whitelist onboarding: the write path converted
 * `step_3_status` to `step_3Status` (not a column — Drizzle drops it silently)
 * and the read path converted `step3Status` to `step3_status` (callers read
 * `step_3_status`). Both directions failed quietly, so step completion was
 * never stored and auto-approval could never fire.
 */

// The real whitelist_members column list, as Drizzle names it.
const WHITELIST_MEMBER_COLUMNS = [
  "id",
  "walletAddress",
  "twitterUsername",
  "twitterUserId",
  "twitterConnectedAt",
  "twitterOauthProvider",
  "socialStepsPolicyVersion",
  "whitelistStatus",
  "step1Status",
  "step2Status",
  "step3Status",
  "createdAt",
  "updatedAt",
  "approvedAt",
  "xFollowed",
  "xLiked",
  "xPosted",
  "xPostedTweetId",
  "telegramUserId",
  "telegramUsername",
  "telegramFirstName",
  "telegramConnectedAt",
  "telegramChatMember",
  "telegramMembershipCheckedAt",
  "eligible",
] as const;

test("camelToSnake and snakeToCamel are exact inverses over every whitelist column", () => {
  for (const column of WHITELIST_MEMBER_COLUMNS) {
    const snake = camelToSnake(column);
    assert.equal(
      snakeToCamel(snake),
      column,
      `round-trip failed: ${column} -> ${snake} -> ${snakeToCamel(snake)}`
    );
  }
});

test("digit-bearing step columns convert to the names callers actually use", () => {
  // The API contract at /api/whitelist reads these exact snake_case keys.
  assert.equal(camelToSnake("step1Status"), "step_1_status");
  assert.equal(camelToSnake("step2Status"), "step_2_status");
  assert.equal(camelToSnake("step3Status"), "step_3_status");

  assert.equal(snakeToCamel("step_1_status"), "step1Status");
  assert.equal(snakeToCamel("step_2_status"), "step2Status");
  assert.equal(snakeToCamel("step_3_status"), "step3Status");
});

test("the leading-x and multiword columns still convert correctly", () => {
  assert.equal(camelToSnake("xPostedTweetId"), "x_posted_tweet_id");
  assert.equal(snakeToCamel("x_posted_tweet_id"), "xPostedTweetId");
  assert.equal(camelToSnake("telegramMembershipCheckedAt"), "telegram_membership_checked_at");
  assert.equal(camelToSnake("walletAddress"), "wallet_address");
  assert.equal(camelToSnake("id"), "id");
});

test("rowToSnakeCase converts a whole row's keys", () => {
  const row = rowToSnakeCase({ walletAddress: "0xabc", step3Status: "completed", eligible: true });

  assert.deepEqual(row, {
    wallet_address: "0xabc",
    step_3_status: "completed",
    eligible: true,
  });
});
