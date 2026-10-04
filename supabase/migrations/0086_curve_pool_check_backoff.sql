-- 0086 — pool-appearance sweep backoff
--
-- Measured 2026-09-05: the sweep's eligible set is SIXTEEN rows against a
-- budget of 20/tick, so every one of them is re-checked every 60 seconds —
-- 1,440 `discoverCustodyPools` fan-outs per token per day, for zero
-- graduations. The `last_pool_check_at` rotation was built for a 12,486-row
-- tail (the fast/slow split in lib/config/curves.ts); that tail is now 0 rows,
-- so the rotation cannot throttle anything and there is no backoff at all.
--
-- This adds the attempt counter a backoff needs. The counter is reset (not
-- just stopped) when a pool IS found, so a token that graduates and is later
-- re-checked for any reason starts from a fast cadence again.
alter table "curve_tokens"
  add column if not exists "pool_check_attempts" integer not null default 0;

comment on column "curve_tokens"."pool_check_attempts" is
  'Consecutive pool-appearance checks that found no pool. Drives the sweep backoff in lib/data/curves.ts::readCurvingTokensForSweep. Reset to 0 when a pool is found.';

-- The sweep reads `status='CURVING'` + progress gate ordered by the rotation
-- clock; the backoff adds `pool_check_attempts` to that ORDER BY's inputs, so
-- it belongs in the same partial index rather than a second one.
create index if not exists "curve_tokens_pool_sweep_backoff_idx"
  on "curve_tokens" ("last_pool_check_at" asc nulls first, "pool_check_attempts")
  where status = 'CURVING';
