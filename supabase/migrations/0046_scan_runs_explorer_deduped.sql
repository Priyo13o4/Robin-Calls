-- Count explorer requests served without touching the network (explorer plan §1).
--
-- A scan issues the same explorer read from several independent checks. At
-- ~3.5s per call on the PRO gateway with only 3 concurrency slots, a duplicate
-- is not merely wasted work — it occupies a slot a different call needed, so
-- the cost compounds.
--
-- This is the number that says whether the dedupe (in-flight join + per-scan
-- memo) is actually earning anything, rather than assuming it. Read it against
-- explorer_calls: deduped/(deduped+calls) is the share of reads that cost
-- nothing.
--
-- Separate migration rather than an edit to 0045: that one is already applied
-- in production, and applied migrations are never edited.
--
-- Nullable for the same reason as 0045's columns — a pre-migration row is "not
-- measured", which is a different fact from a measured zero.

alter table public.scan_runs
  add column if not exists explorer_deduped integer;
