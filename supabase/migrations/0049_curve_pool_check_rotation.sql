-- Give the pool-appearance graduation sweep its own rotation clock.
--
-- `poolAppearanceSweep` orders its queue `updated_at ASC` and its docstring
-- claims that "least-recently-swept-first guarantees fair rotation". Nothing
-- ever marked a row as swept, so the rotation never advanced: measured on
-- production 2026-08-05, the same 20 flap-v1 rows (all at progress_bps = 0)
-- had been sitting at the head of the queue for 2.0 days, re-checked once a
-- minute — ~57,600 pool discoveries returning the same answer — while every
-- other eligible token, including all five flap tokens above 50% progress,
-- was never checked at all. CLAUDE.md §8.10: the ordering looked correct, so
-- the missing half of it was invisible.
--
-- Why a dedicated column instead of bumping `updated_at`: `recordStalledCurves`
-- keys on `coalesce(last_trade_at, created_at, updated_at) < cutoff`. A sweep
-- that touched `updated_at` would hold that coalesce permanently fresh for any
-- row whose first two columns are NULL, and those tokens could then never
-- stall. Rotation state and staleness state are different facts; they get
-- different columns.
--
-- NULL means "never swept" and sorts first under NULLS FIRST, so every row is
-- checked once before any row is checked twice.

alter table curve_tokens
  add column if not exists last_pool_check_at timestamptz;

-- One index per sweep lane, each predicate a VERBATIM copy of that lane's
-- WHERE clause in readCurvingTokensForSweep. Postgres will only use a partial
-- index when it can prove the query's restriction implies the index
-- predicate, and its prover is far more literal than it looks. Measured here
-- on PG 18.4 against a 190k-row table shaped like production (12.5k CURVING,
-- 126 of them with progress):
--
--   query shape                                 plan            buffers   time
--   status inside an OR (a recovery draft)      Seq Scan          1,959   9.94ms
--   one index, status='CURVING' only            Bitmap Heap       1,971   7.26ms
--   fast lane, index ... and progress_bps > 0   Bitmap Index        127   0.29ms
--   slow lane, index ... and progress_bps = 0   Seq Scan          2,160  15.2 ms
--   slow lane, index ... and progress_bps <= 0  Index Scan           14   0.40ms
--
-- Two traps are visible in that table, and both are silent — the query returns
-- correct rows either way, it just scans the whole table once a minute.
--
--  1. Put the status test inside an OR and no index applies at all.
--  2. The slow lane's SQL is `not (progress_bps > 0)`, i.e. `<= 0`, and an
--     index written `= 0` is NOT used for it. Note carefully why, because the
--     obvious explanation is wrong: `curve_tokens_progress_bps_check` already
--     constrains the column to 0..10000, so `<= 0` and `= 0` are in fact the
--     same set of rows. Postgres still refuses — `predicate_implied_by`
--     reasons only from the query's own restriction clauses and never
--     consults table constraints. Verified with the CHECK in place: a `= 0`
--     index still produced a seq scan. So tightening or adding a constraint
--     will not help; the index predicate simply has to match the query's
--     expression, which is why it reads `<= 0` below.
--
-- If a lane's WHERE clause changes, change its index predicate in the same
-- commit or the sweep quietly starts seq-scanning ~78MB every 60 seconds.
create index if not exists curve_tokens_pool_sweep_fast_idx
  on curve_tokens (last_pool_check_at nulls first)
  where status = 'CURVING' and progress_bps > 0;

create index if not exists curve_tokens_pool_sweep_slow_idx
  on curve_tokens (last_pool_check_at nulls first)
  where status = 'CURVING' and progress_bps <= 0;
