-- L106 — the launcher-vs-relayer count reads the ARCHIVE as well as the live
-- table, because retention ages out exactly a relayer's history and counting
-- only `curve_tokens` would shrink a relayer back toward "a person".
--
-- `curve_launch_origins.creator_address` had no index: measured on prod
-- 2026-09-05 the count was a parallel seq scan over 266k rows at 155ms, and the
-- archive grows continuously (5,000/hr). That cost lands on every scan of a
-- pad-launched token and gets worse forever, so the index is part of the fix,
-- not an optimisation.
--
-- CONCURRENTLY is deliberately NOT used: it cannot run inside the deploy's
-- transaction, and this table is append-only from a background job, so the
-- brief lock is cheaper than a half-built index nothing notices.
create index if not exists curve_launch_origins_creator_idx
  on curve_launch_origins (creator_address);
