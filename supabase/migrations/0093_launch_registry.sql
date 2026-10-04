-- 0093 — launch registry (docs/ways-of-work/plan/launchpad-tracking/ARCHITECTURE.md §6, §10).
--
-- Identity from events, written once. Progress read from contract state. Labels
-- (Bonding, DEX, stalled) are computed when reading, so no status is stored.
-- Replaces curve_tokens / launch_candidates / launch_tombstones /
-- curve_launch_origins as the tracker's source of truth. Those tables are KEPT
-- (no DROP): git restores code, never rows. Attribution is copied below by SQL.

-- ── Launcher families ─────────────────────────────────────────────────────────
alter table launchpads drop constraint if exists launchpads_adapter_check;

-- Operator decision 2026-09-13: stoxes removed; stonksafe never indexed a launch
-- and has no chain activity. Both rows hold zero tokens, checked here.
delete from launchpads l
where l.slug in ('stoxes', 'stonksafe')
  and not exists (select 1 from curve_tokens c where c.launchpad_id = l.id)
  and not exists (select 1 from curve_launch_origins o where o.launchpad_id = l.id);

alter table launchpads add constraint launchpads_adapter_check check (adapter = any (array[
  'pons-v2', 'pons-v1', 'flap-v1', 'curve-events-v1', 'cashcat-v1', 'party-v1',
  'doppler-multicurve', 'pair-v5'
]));

insert into launchpads (slug, name, curve_address, adapter, config, enabled, venue_model, notes)
values
  ('doppler', 'Doppler', '0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544', 'doppler-multicurve',
   '{"airlock":"0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862","tokenFactory":"0x1b37d3a72082029c44b35b604ea473617580b69a","longRouter":"0x1eef016f22a943abc7dd11422edee9d235942104","website":"https://long.xyz"}'::jsonb,
   true, 'BONDING_CURVE', 'DopplerHookInitializer (Sourcify match). The curve is hook-owned liquidity inside a V4 pool.'),
  ('pair', 'PAIR', '0x8660a7f019c7943b0b0a91b8e39aff3b6db6ae62', 'pair-v5',
   '{"hook":"0x438b86c71840c3b4df3f839aed6bb889e2d780c0","implementation":"0x8000b64b62837a1511e302c62354e1bc39b5641a"}'::jsonb,
   true, 'BONDING_CURVE', 'PairLaunchpadV5Upgradeable proxy, read from the hook''s launchpad().')
on conflict (slug) do nothing;

-- ── Registry ──────────────────────────────────────────────────────────────────
create table if not exists launches (
  token_address text primary key check (token_address = lower(token_address)),
  launchpad_id bigint references launchpads (id) on delete restrict,
  family text not null,
  -- From protocol state or the launch event's own field, never tx.from (§8 #19).
  creator_address text check (creator_address is null or creator_address = lower(creator_address)),
  created_block bigint,
  created_at timestamptz,
  launch_tx_hash text,
  venue_kind text not null check (venue_kind in ('CURVE', 'HOOK_CURVE', 'POOL')),
  curve_address text check (curve_address is null or curve_address = lower(curve_address)),
  -- DEX pool address or V4 poolId.
  pool_ref text check (pool_ref is null or pool_ref = lower(pool_ref)),
  quote_token text check (quote_token is null or quote_token = lower(quote_token)),
  quote_symbol text,
  quote_decimals smallint,
  target_quote numeric,
  name text,
  symbol text,
  metadata_uri text,
  -- null = not measured, which is not 0.
  dev_buy_quote numeric,
  detail jsonb,
  source text not null default 'ingest' check (source in ('ingest', 'migrated')),
  -- The old tracker's folded figures, carried so the creator-share check replays
  -- migrated launches bit-identically. Null on every ingested launch.
  legacy_raised_quote numeric,
  legacy_creator_buy_quote numeric,
  legacy_buys integer,
  recorded_at timestamptz not null default now()
);

create index if not exists launches_created_idx on launches (created_at desc, token_address desc);
create index if not exists launches_creator_idx on launches (creator_address) where creator_address is not null;
create index if not exists launches_curve_idx on launches (curve_address) where curve_address is not null;
create index if not exists launches_pool_ref_idx on launches (pool_ref) where pool_ref is not null;
create index if not exists launches_pad_created_idx on launches (launchpad_id, created_at desc);

create table if not exists launch_events (
  id bigint generated always as identity primary key,
  token_address text not null check (token_address = lower(token_address)),
  kind text not null check (kind in ('GRADUATED', 'LOCKED', 'MIGRATED', 'FEE_RECIPIENT_CHANGED', 'CREATOR_BUY')),
  block_number bigint,
  log_index integer,
  tx_hash text,
  occurred_at timestamptz,
  pool_ref text,
  amount numeric,
  detail jsonb,
  source text not null default 'ingest' check (source in ('ingest', 'migrated')),
  recorded_at timestamptz not null default now(),
  unique nulls not distinct (token_address, kind, block_number, log_index)
);
create index if not exists launch_events_token_kind_idx on launch_events (token_address, kind);

create table if not exists v4_pools (
  pool_id text primary key check (pool_id = lower(pool_id)),
  currency0 text not null,
  currency1 text not null,
  fee integer not null,
  tick_spacing integer not null,
  hooks text not null,
  init_block bigint not null,
  init_tx text,
  recorded_at timestamptz not null default now()
);
create index if not exists v4_pools_currency0_idx on v4_pools (currency0);
create index if not exists v4_pools_currency1_idx on v4_pools (currency1);
create index if not exists v4_pools_hooks_idx on v4_pools (hooks);

-- Counts only; tokens under 7 days old; pruned after 8 days.
create table if not exists launch_trade_hourly (
  token_address text not null,
  hour timestamptz not null,
  buys integer not null default 0,
  sells integer not null default 0,
  quote_in numeric not null default 0,
  quote_out numeric not null default 0,
  creator_quote_in numeric not null default 0,
  last_trade_block bigint,
  primary key (token_address, hour)
);
create index if not exists launch_trade_hourly_hour_idx on launch_trade_hourly (hour);

-- Latest readings, overwritten. A faulted read never writes here (§4).
create table if not exists launch_state (
  token_address text primary key,
  fill_bps integer check (fill_bps is null or fill_bps between 0 and 10000),
  quote_balance numeric,
  state_block bigint,
  state_read_at timestamptz,
  liquidity_usd numeric,
  volume_24h_usd numeric,
  buys_24h integer,
  sells_24h integer,
  market_pool_address text,
  market_read_at timestamptz
);
create index if not exists launch_state_fill_idx on launch_state (fill_bps) where fill_bps >= 3300;
create index if not exists launch_state_read_idx on launch_state (state_read_at nulls first);

create table if not exists block_times (
  block_number bigint primary key,
  block_time timestamptz not null
);

create table if not exists ingest_cursors (
  stream text primary key,
  next_block bigint not null,
  updated_at timestamptz not null default now()
);

-- The coverage proof: contiguous windows per stream.
create table if not exists ingest_windows (
  id bigint generated always as identity primary key,
  stream text not null,
  from_block bigint not null,
  to_block bigint not null,
  log_count integer not null,
  rpc_calls integer not null default 0,
  recorded_at timestamptz not null default now()
);
create index if not exists ingest_windows_stream_idx on ingest_windows (stream, from_block);

-- ── Copy past launches (no RPC) ───────────────────────────────────────────────
insert into launches (
  token_address, launchpad_id, family, creator_address, created_block, created_at,
  venue_kind, curve_address, pool_ref, quote_token, quote_symbol, quote_decimals,
  target_quote, name, symbol, metadata_uri, source,
  legacy_raised_quote, legacy_creator_buy_quote, legacy_buys
)
select
  ct.token_address, ct.launchpad_id, lp.adapter, lower(ct.creator_address), ct.created_block, ct.created_at,
  case when lp.adapter in ('pons-v1', 'party-v1', 'cashcat-v1') then 'POOL' else 'CURVE' end,
  coalesce(ct.curve_address, case when lp.adapter in ('flap-v1', 'curve-events-v1') then lp.curve_address end),
  case when lp.adapter in ('pons-v1', 'party-v1', 'cashcat-v1') then lower(ct.dex_pool_address) end,
  lower(ct.quote_token), ct.quote_symbol, ct.quote_decimals,
  ct.target_wei, ct.name, ct.symbol, ct.metadata_uri, 'migrated',
  ct.raised_wei, ct.creator_buy_wei, ct.buys
from curve_tokens ct
join launchpads lp on lp.id = ct.launchpad_id
on conflict (token_address) do nothing;

insert into launches (
  token_address, launchpad_id, family, creator_address, created_block, created_at,
  venue_kind, curve_address, source, legacy_raised_quote, legacy_creator_buy_quote
)
select
  o.token_address, o.launchpad_id, lp.adapter, lower(o.creator_address), o.created_block, o.created_at,
  case when lp.adapter in ('pons-v1', 'party-v1', 'cashcat-v1') then 'POOL' else 'CURVE' end,
  case when lp.adapter in ('flap-v1', 'curve-events-v1') then lp.curve_address end,
  'migrated', o.raised_wei, o.creator_buy_wei
from curve_launch_origins o
join launchpads lp on lp.id = o.launchpad_id
on conflict (token_address) do nothing;

insert into launches (token_address, family, created_at, venue_kind, pool_ref, name, symbol, source)
select lc.token_address, 'direct-dex', lc.created_at, 'POOL', lower(lc.pool_address), lc.token_name, lc.token_symbol, 'migrated'
from launch_candidates lc
where lc.source_kind = 'DIRECT_DEX'
on conflict (token_address) do nothing;

insert into launch_events (token_address, kind, occurred_at, pool_ref, source)
select ct.token_address, 'GRADUATED', coalesce(ct.graduated_at, ct.updated_at), lower(ct.dex_pool_address), 'migrated'
from curve_tokens ct
join launchpads lp on lp.id = ct.launchpad_id
where lp.adapter not in ('pons-v1', 'party-v1', 'cashcat-v1')
  and (ct.status = 'GRADUATED' or ct.dex_pool_address is not null)
on conflict do nothing;

insert into launch_events (token_address, kind, occurred_at, source)
select o.token_address, 'GRADUATED', o.created_at, 'migrated'
from curve_launch_origins o
join launchpads lp on lp.id = o.launchpad_id
where lp.adapter not in ('pons-v1', 'party-v1', 'cashcat-v1') and o.status = 'GRADUATED'
on conflict do nothing;

insert into launch_state (token_address, fill_bps, quote_balance, state_read_at)
select ct.token_address, least(greatest(ct.progress_bps, 0), 10000), ct.raised_wei, ct.updated_at
from curve_tokens ct
where ct.created_at > now() - interval '8 days'
on conflict (token_address) do nothing;

insert into launch_state (token_address, liquidity_usd, volume_24h_usd, buys_24h, sells_24h, market_pool_address, market_read_at)
select lc.token_address, lc.liquidity_usd, lc.volume_24h_usd, lc.buys_24h, lc.sells_24h, lower(lc.pool_address), lc.updated_at
from launch_candidates lc
where lc.created_at > now() - interval '8 days'
  and (lc.liquidity_usd is not null or lc.volume_24h_usd is not null)
on conflict (token_address) do update set
  liquidity_usd = excluded.liquidity_usd,
  volume_24h_usd = excluded.volume_24h_usd,
  buys_24h = excluded.buys_24h,
  sells_24h = excluded.sells_24h,
  market_pool_address = excluded.market_pool_address,
  market_read_at = excluded.market_read_at;

-- ── Jobs ──────────────────────────────────────────────────────────────────────
do $$
declare j text;
begin
  if to_regclass('cron.job') is not null then
    foreach j in array array['robincalls-curve-poll', 'robincalls-tracker-poll', 'robincalls-curve-retention',
                             'robincalls-curve-rug-recheck', 'robincalls-launch-retention'] loop
      if exists (select 1 from cron.job where jobname = j) then
        perform cron.unschedule(j);
      end if;
    end loop;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-launch-ingest', '* * * * *', '/api/jobs/launch-ingest');
    perform public.rc_schedule_job('robincalls-launch-maintenance', '17 * * * *', '/api/jobs/launch-maintenance');
  else
    raise notice 'RC_CRON_SKIPPED: rc_schedule_job or job config absent; schedule robincalls-launch-ingest and robincalls-launch-maintenance manually.';
  end if;
end $$;
