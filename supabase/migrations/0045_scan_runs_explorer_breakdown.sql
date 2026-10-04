-- Split the explorer latency metric so it can be optimized (explorer plan §0).
--
-- `explorer_wall_ms` is a SUM over calls whose timer started before the
-- concurrency gate, so a call that sat queued billed that wait as upstream
-- latency — and with EXPLORER_MAX_CONCURRENCY=3, the same wall-clock second was
-- counted in up to three different calls' totals. Measured on prod 2026-08-01:
-- a 90.6s scan reported 72.6s of "explorer", which is arithmetically impossible
-- as elapsed time and sent the first optimization attempt at the wrong target.
--
-- These three columns make the number actionable:
--   explorer_queue_ms       how much of explorer_wall_ms was OUR queue, not theirs
--   explorer_calls          how many calls (was only inferable by division)
--   explorer_endpoint_counts per-endpoint {n, ms}, ms excluding queue
--
-- explorer_wall_ms keeps its original meaning so historical rows stay
-- comparable; the new columns explain it rather than redefine it.
--
-- Additive and nullable: rows written before this migration read as NULL, which
-- is honestly "not measured" rather than a fabricated zero (CLAUDE.md §8.3 —
-- a real 0 here would mean "no explorer calls", a genuine and different fact).

alter table public.scan_runs
  add column if not exists explorer_queue_ms integer,
  add column if not exists explorer_calls integer,
  add column if not exists explorer_endpoint_counts jsonb;
