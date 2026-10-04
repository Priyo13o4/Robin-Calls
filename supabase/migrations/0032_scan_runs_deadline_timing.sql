-- Additive scan_runs columns for terminal-cause + upstream phase-timing
-- visibility (Runtime Safety Amendment M14, docs/ways-of-work/plan/
-- contract-audit/full-contract-authority-audit/implementation-plan.md).
-- Driven by a real incident: a 101s scan blew past the 60s maxDuration with
-- no record of where the time went (RPC, explorer, market, DB, Upstash).
-- `scan_runs` already has rpc_* wall-time counters (0031); this adds the
-- real terminal cause plus the missing upstream call groups. Nullable,
-- no data migration, no existing column/scoring/verdict shape changes.

alter table public.scan_runs
  add column if not exists terminal_cause text,   -- mirrors error_code; null on clean success
  add column if not exists explorer_wall_ms integer,
  add column if not exists market_wall_ms integer,
  add column if not exists db_wall_ms integer,
  add column if not exists upstash_wall_ms integer;
