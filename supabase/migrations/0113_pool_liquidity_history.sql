-- Durable, per-pool liquidity event history with a contiguous indexed frontier.
create table if not exists public.pool_liquidity_history_cursors (
  protocol text not null check (protocol in ('uniswap-v2', 'uniswap-v3', 'slipstream-cl', 'uniswap-v4')),
  pool text not null,
  indexed_from_block bigint not null check (indexed_from_block >= 0),
  indexed_to_block bigint not null check (indexed_to_block >= -1),
  indexed_to_hash text not null,
  updated_at timestamptz not null default now(),
  primary key (protocol, pool)
);

create table if not exists public.pool_liquidity_history_events (
  protocol text not null check (protocol in ('uniswap-v2', 'uniswap-v3', 'slipstream-cl', 'uniswap-v4')),
  pool text not null,
  block_number bigint not null check (block_number >= 0),
  log_index integer not null check (log_index >= 0),
  tx_hash text not null,
  event_name text not null check (event_name in ('Mint', 'Burn', 'Collect', 'ModifyLiquidity')),
  payload jsonb not null,
  recorded_at timestamptz not null default now(),
  -- One btree serves identity, upsert and the ordered per-pool range read.
  primary key (protocol, pool, block_number, log_index)
);

create table if not exists public.pool_liquidity_history_queue (
  token_address text primary key,
  pools jsonb not null,
  priority_amount numeric not null default 0,
  queued_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token text,
  revision bigint not null default 1 check (revision > 0),
  attempts integer not null default 0 check (attempts >= 0),
  rescan_requested boolean not null default false,
  completed_at timestamptz
);

create index if not exists pool_liquidity_history_queue_priority_idx
  on public.pool_liquidity_history_queue (priority_amount desc, queued_at asc);

grant select, insert, update, delete on public.pool_liquidity_history_cursors to robincalls_app;
grant select, insert, update, delete on public.pool_liquidity_history_events to robincalls_app;
grant select, insert, update, delete on public.pool_liquidity_history_queue to robincalls_app;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-liquidity-history', '*/5 * * * *', '/api/jobs/liquidity-history');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-liquidity-history every five minutes after job configuration is available.';
  end if;
end $$;
