-- 0075: curve-poll per-tick RPC bookkeeping & run tracking (plan doc §4).
--
-- Mirrors scan_runs's provider_calls, multicall_batches, multicall_batched_calls,
-- and rpc_provider_switches columns so the same query shape works for both user
-- scans and background curve polling.
--
-- Shape: {"<provider-id>": {"n": attempts, "err": transport-errors, "ms": latency}}

create table if not exists curve_poll_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  duration_ms integer,
  ok boolean not null default true,
  provider_calls jsonb,
  rpc_provider_switches integer default 0,
  multicall_batches integer default 0,
  multicall_batched_calls integer default 0,
  multicall_subcall_failures integer default 0,
  multicall_fallback_count integer default 0,
  logical_calls integer default 0,
  physical_attempts integer default 0,
  total_latency_ms integer default 0,
  method_counts jsonb,
  pad_summaries jsonb,
  reconciled_graduations integer default 0,
  pool_graduations integer default 0,
  confirmed_rugs integer default 0,
  stalled integer default 0,
  degraded text[] default '{}'
);

create index if not exists curve_poll_runs_started_at_idx
  on curve_poll_runs (started_at desc);

comment on table curve_poll_runs is
  'Per-tick execution history and RPC provider usage for the background curve-poll job. Mirrors scan_runs metrics.';
