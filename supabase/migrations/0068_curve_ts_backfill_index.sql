-- L36 — the created_at backfill now selects every row WHERE created_at IS NULL
-- AND created_block IS NOT NULL, ranked by progress_bps DESC (the old
-- progress_bps >= 4000 eligibility filter made dust rows permanently
-- ineligible, which is the 91%-NULL population). Without an index that matches
-- the predicate, the per-minute tick pays a parallel seq scan over ~160k rows
-- for the ~5-6 days the backlog takes to drain.
--
-- Partial index shaped EXACTLY like the query's WHERE clause: the planner can
-- use it directly, and it shrinks as rows fill — at steady state (~4,600 new
-- spam launches/day) it holds roughly a day of un-filled rows.

create index if not exists curve_tokens_ts_backfill_idx
  on curve_tokens (progress_bps desc)
  where created_at is null and created_block is not null;
