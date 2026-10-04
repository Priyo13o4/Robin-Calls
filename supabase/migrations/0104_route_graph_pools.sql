-- Migration 0104: route graph pool tables and depth cache.
-- V2 and V3-style pools for the route graph (V4 stays in v4_pools).

create table if not exists public.swap_pools (
  pool text primary key constraint swap_pools_pool_lower check (pool = lower(pool)),
  protocol text not null constraint swap_pools_protocol_check check (protocol in ('v2', 'v3')),
  dex text not null,
  factory text not null constraint swap_pools_factory_lower check (factory = lower(factory)),
  token0 text not null constraint swap_pools_token0_lower check (token0 = lower(token0)),
  token1 text not null constraint swap_pools_token1_lower check (token1 = lower(token1)),
  fee integer,
  tick_spacing integer,
  created_block bigint,
  recorded_at timestamptz not null default now()
);

create index if not exists swap_pools_token0_idx on public.swap_pools (token0);
create index if not exists swap_pools_token1_idx on public.swap_pools (token1);
create index if not exists swap_pools_recorded_idx on public.swap_pools (recorded_at, pool);

create table if not exists public.pool_depth (
  pool_id text primary key constraint pool_depth_pool_id_lower check (pool_id = lower(pool_id)),
  protocol text not null constraint pool_depth_protocol_check check (protocol in ('v2', 'v3', 'v4')),
  liquidity numeric,
  reserve0 numeric,
  reserve1 numeric,
  sqrt_price_x96 numeric,
  -- Raw token0 / token1 the pool pays out before its price moves 2% (V3/V4: tick walk), and
  -- their USD value. One-sided pools pay one side only, so a single number cannot rank both ways.
  out0 numeric,
  out1 numeric,
  depth0_usd numeric,
  depth1_usd numeric,
  -- greatest(depth0_usd, depth1_usd): the floor and its index. NULL = unpriced, never 0.
  depth_usd numeric,
  read_at timestamptz,
  dead_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists pool_depth_depth_usd_idx on public.pool_depth (depth_usd) where dead_at is null;
