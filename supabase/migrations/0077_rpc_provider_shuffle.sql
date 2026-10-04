-- RPC pool reorder + concurrency raise (docs/prds/rpc-cost-and-reliability-plan.md
-- §2/§3, live-probed 2026-08-30). A DATA change to an already-existing,
-- operator-editable table (migration 0061) — not a schema change, and
-- deliberately idempotent (plain UPDATEs keyed on `id`) so it is safe to
-- re-run and a no-op on any environment that has not seeded these rows yet
-- (0061's "the empty table is not an empty pool" doctrine: an UPDATE against
-- zero matching rows changes nothing, it does not mean providers are gone).
--
-- WHY. Every enabled provider was capped at max_concurrent_requests=4
-- (process-local, admission.ts), which is what produced the 46-54
-- provider-switches-per-scan / simultaneous-SATURATED pattern — the pool
-- wasn't unhealthy, a 4-in-flight ceiling was just being hit by curve-poll's
-- own per-tick fan-out. And alchemy-tertiary (sort_order 30) was tried BEFORE
-- goldsky-edge/robinhood-public (40/50), even though a live probe that day
-- showed 20/20 concurrent robinhood-public calls with 0 errors and no
-- Alchemy-identifying response headers on either — no observed reason for
-- Alchemy, the scarce metered one, to go first.
--
-- New order (ascending sort_order = tried first): robinhood-public,
-- goldsky-edge, then alchemy-tertiary as the fallback it already was.
-- robinhood-public ranks ahead of goldsky-edge on the day's evidence: a full
-- 20-concurrent burst test at 0 errors, vs. goldsky-edge's lighter 3-call
-- sample and its own already-configured max_requests_per_second=8 ceiling.
--
-- New concurrency caps: raised for the two providers whose OWN probe showed
-- headroom; Alchemy's stays at 4 — it is still the scarce, metered one, and
-- nothing here claims to have tested more from it. These are starting
-- values, not a settled answer — the curve_poll_runs bookkeeping (migration
-- 0075) is what turns "raised because the probe suggested headroom" into
-- "raised to the number the actual measured error rate supports."

update rpc_endpoints set
  sort_order = 25,
  max_concurrent_requests = 16,
  updated_at = now(),
  updated_by = 'migration_0077_rpc_provider_shuffle'
where id = 'robinhood-public';

update rpc_endpoints set
  sort_order = 26,
  max_concurrent_requests = 8,
  updated_at = now(),
  updated_by = 'migration_0077_rpc_provider_shuffle'
where id = 'goldsky-edge';

-- alchemy-tertiary's sort_order (30) is already after both new values above —
-- left unchanged so this migration touches only the two rows the plan
-- doc's evidence actually supports changing.
