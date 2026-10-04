-- Migration 0107: LP position store tables (phase 1).
-- Open positions for tracked pools, updated sequentially from sequencer logs.

create table if not exists lp_tracked_pools (
  pool text primary key,
  protocol text not null check (protocol in ('v3','v4')),
  epoch bigint not null,
  hydrated_through bigint not null,
  reason text not null,
  last_visited_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists lp_positions (
  pool text not null,
  position_key text not null,
  protocol text not null check (protocol in ('v3','v4')),
  manager text,
  token_id numeric,
  holder text,
  tick_lower integer not null,
  tick_upper integer not null,
  liquidity numeric not null check (liquidity > 0),
  updated_block bigint not null,
  primary key (pool, position_key)
);

create index if not exists lp_positions_pool_liq_idx on lp_positions (pool, liquidity desc);
create index if not exists lp_tracked_pools_visited_idx on lp_tracked_pools (last_visited_at);
