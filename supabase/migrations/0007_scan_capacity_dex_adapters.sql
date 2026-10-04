-- Scan capacity, canonical receipts, and modular DEX adapters — Phase 0 schema.
-- (docs/scan-capacity-and-dex-adapters-prd.md §16, §20.3)
--
-- Everything here is additive and idempotent. No existing row's hash inputs
-- change: new verdict columns are outside the historical canonical payload,
-- and old rows are backfilled to completeness = 'legacy'.

-- ─────────────────────────────────────────────────────────────
-- 1. verdicts: receipt-policy metadata (§16.1)
-- ─────────────────────────────────────────────────────────────
alter table public.verdicts
  add column if not exists result_fingerprint text,
  add column if not exists completeness text,
  add column if not exists receipt_policy_version text,
  add column if not exists dex_protocols text[] not null default '{}',
  add column if not exists primary_pool_address text,
  add column if not exists scan_started_at timestamptz;

-- Historical rows predate the receipt policy; never rewrite their hashes.
update public.verdicts set completeness = 'legacy' where completeness is null;

-- New writes must declare what they are. (Not NOT NULL: legacy tooling and
-- the Phase-1 shadow period still insert without the column.)
alter table public.verdicts
  drop constraint if exists verdicts_completeness_check;
alter table public.verdicts
  add constraint verdicts_completeness_check
  check (completeness is null or completeness in ('complete', 'partial', 'legacy'));

-- Latest-state lookups (§16.4).
create index if not exists verdicts_token_created_idx
  on public.verdicts (token_address, created_at desc);
create index if not exists verdicts_token_fingerprint_idx
  on public.verdicts (token_address, result_fingerprint, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- 2. Hash-chain fork guard (§16.5)
--    Two appends can never link to the same head. The append routine
--    re-reads the head and retries on unique violation.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  dup_count bigint;
begin
  select count(*) into dup_count from (
    select prev_hash from public.verdicts
    group by prev_hash having count(*) > 1
  ) d;
  if dup_count > 0 then
    raise exception
      'RC_LEDGER_FORKED: % duplicate prev_hash value(s) already exist in public.verdicts — the chain is forked and must be repaired before the fork guard can be installed',
      dup_count;
  end if;
end $$;

create unique index if not exists verdicts_prev_hash_unique_idx
  on public.verdicts (prev_hash);

-- ─────────────────────────────────────────────────────────────
-- 3. token_scan_state: one mutable pointer row per token (§16.2)
--    Cache/index only — the verdict row remains the source of truth.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.token_scan_state (
  token_address text primary key,
  latest_verdict_id bigint references public.verdicts (id),
  result_fingerprint text,
  last_complete_scan_at timestamptz,
  last_receipt_at timestamptz,
  dex_protocols text[] not null default '{}',
  primary_pool_address text,
  updated_at timestamptz not null default now()
);

create index if not exists token_scan_state_last_scan_idx
  on public.token_scan_state (last_complete_scan_at);
create index if not exists token_scan_state_latest_verdict_idx
  on public.token_scan_state (latest_verdict_id);

-- ─────────────────────────────────────────────────────────────
-- 4. market_snapshots: bounded, auditable monitoring buckets (§16.3)
--    User scans stop inserting here in Phase 2; monitoring jobs write one
--    idempotent row per token per bucket against a pinned pool.
-- ─────────────────────────────────────────────────────────────
alter table public.market_snapshots
  add column if not exists bucket_at timestamptz,
  add column if not exists provider text,
  add column if not exists observation_status text;

-- Partial unique: legacy per-scan rows have bucket_at IS NULL and stay valid.
create unique index if not exists market_snapshots_token_bucket_idx
  on public.market_snapshots (token_address, bucket_at)
  where bucket_at is not null;

-- ─────────────────────────────────────────────────────────────
-- 5. slow_rug_watch: pinned material pool (§11.8)
--    A provider changing its "best pool" must not fake a liquidity drain.
-- ─────────────────────────────────────────────────────────────
alter table public.slow_rug_watch
  add column if not exists pinned_pool_address text;

-- ─────────────────────────────────────────────────────────────
-- 6. app_error_events: sanitized application errors (§20.3)
--    One row per actual error occurrence. Admin-only; retention-bounded.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.app_error_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  severity text not null check (severity in ('WARN', 'ERROR', 'FATAL')),
  category text not null,             -- 'rpc' | 'market' | 'explorer' | 'db' | 'scan' | 'auth' | 'admin' | 'job' | 'client'
  code text not null,                 -- stable machine code, e.g. RC_RPC_TIMEOUT
  message text not null,              -- human-readable, sanitized
  fingerprint text not null,          -- code + normalized location, for recurrence grouping
  release text,                       -- app release/commit if known
  runtime text,                       -- 'node' | 'edge' | 'browser'
  route text,                         -- request route or job name
  operation text,                     -- logical operation, e.g. 'honeypot.deepPass'
  request_id text,
  scan_id text,
  token_address text,
  provider_id text,                   -- RPC/market provider id, never a URL
  dex_adapter text,                   -- 'uniswap-v2' | 'uniswap-v3'
  http_status integer,
  retryable boolean,
  request_outcome text,               -- 'completed' | 'degraded' | 'failed'
  stack text,                         -- sanitized, truncated
  details jsonb,                      -- redacted, capped at APP_ERROR_DETAIL_MAX_BYTES
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text
);

-- Admin access patterns (§20.3).
create index if not exists app_error_events_cursor_idx
  on public.app_error_events (occurred_at desc, id desc);
create index if not exists app_error_events_severity_idx
  on public.app_error_events (severity, occurred_at desc);
create index if not exists app_error_events_fingerprint_idx
  on public.app_error_events (fingerprint, occurred_at desc);
create index if not exists app_error_events_unresolved_idx
  on public.app_error_events (occurred_at desc)
  where resolved_at is null and severity in ('ERROR', 'FATAL');

-- ─────────────────────────────────────────────────────────────
-- 7. scan_runs: one bounded summary row per fresh pipeline (§20.3)
--    Never one row per RPC call — counters live in this row.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.scan_runs (
  id bigint generated always as identity primary key,
  scan_id text not null unique,
  request_id text,
  token_address text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  outcome text,                       -- 'complete' | 'partial' | 'rejected' | 'failed'
  source text,                        -- 'fresh' | 'cache' | 'database' | 'stale-fallback'
  receipt_action text,                -- 'appended' | 'reused' | 'none'
  verdict_id bigint references public.verdicts (id),
  score integer,
  tier text,
  dex_protocols text[] not null default '{}',
  adapter_outcomes jsonb,             -- per-adapter normalized states
  provider_states jsonb,              -- per-provider ProviderState
  rpc_logical_calls integer not null default 0,
  rpc_physical_attempts integer not null default 0,
  rpc_expected_reverts integer not null default 0,
  rpc_provider_switches integer not null default 0,
  rpc_method_counts jsonb,            -- {"eth_call": 12, ...}
  rpc_total_latency_ms integer,
  rpc_budget_exceeded boolean not null default false,
  error_code text,                    -- terminal RC_* code when outcome = 'failed'
  evidence_bytes integer              -- serialized verdict payload size
);

create index if not exists scan_runs_token_idx
  on public.scan_runs (token_address, started_at desc);
create index if not exists scan_runs_outcome_idx
  on public.scan_runs (outcome, started_at desc);
create index if not exists scan_runs_budget_idx
  on public.scan_runs (rpc_budget_exceeded, started_at desc);
create index if not exists scan_runs_cursor_idx
  on public.scan_runs (started_at desc, id desc);
create index if not exists scan_runs_verdict_idx
  on public.scan_runs (verdict_id);

-- ─────────────────────────────────────────────────────────────
-- 8. Operational tables are exposed only through the private application DB
--    connection. This self-hosted deployment has no PostgREST/RLS roles.
-- ─────────────────────────────────────────────────────────────
