-- Migration 0101: swap_plan_runs
-- Lightweight durable swap-plan request log for admin diagnostics.
-- One row per validated /api/swap/plan request.

create table if not exists public.swap_plan_runs (
  id bigint primary key generated always as identity,
  request_id text not null,
  created_at timestamptz not null default now(),
  account text not null,
  token_in text not null,
  token_out text not null,
  amount_in text not null,
  status text not null,
  stage text,
  code text,
  duration_ms integer not null,
  metadata jsonb
);

create unique index if not exists swap_plan_runs_request_id_key
  on public.swap_plan_runs (request_id);

create index if not exists swap_plan_runs_created_at_idx
  on public.swap_plan_runs (created_at desc, id desc);

create index if not exists swap_plan_runs_account_idx
  on public.swap_plan_runs (account, created_at desc);

create index if not exists swap_plan_runs_token_in_idx
  on public.swap_plan_runs (token_in, created_at desc);

create index if not exists swap_plan_runs_token_out_idx
  on public.swap_plan_runs (token_out, created_at desc);

grant select, insert, delete on public.swap_plan_runs to robincalls_app;
grant usage, select on sequence public.swap_plan_runs_id_seq to robincalls_app;
