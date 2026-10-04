-- ─────────────────────────────────────────────────────────────
-- Phase 1.5 (Tracker) + Phase 2 (Directory) — PRD §3 site map.
-- Same conventions as 0001: bigint identity, timestamptz, text,
-- RLS on, indexed filter columns, writes only via server secret key.
-- ─────────────────────────────────────────────────────────────

-- ── directory_platforms: curated index of Robinhood Chain platforms (§Prompt 7) ──
create table if not exists public.directory_platforms (
  id bigint generated always as identity primary key,
  name text not null,
  url text not null,
  description text,
  category text not null check (category in ('LAUNCHPAD', 'AGENT', 'ANALYTICS', 'INFRA')),
  has_mcp boolean not null default false,
  has_agent boolean not null default false,
  -- submissions land as 'pending'; only 'published' rows are ever shown
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  contact text,
  submitted_from text,             -- coarse source note, never PII
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists directory_status_category_idx
  on public.directory_platforms (status, category);

-- ── tracked_launches: tokens that crossed a traction threshold (§7.7) ──
create table if not exists public.tracked_launches (
  id bigint generated always as identity primary key,
  token_address text not null unique,
  token_symbol text,
  token_name text,                      -- human-readable project name
  launchpad text,                  -- NOXA / HOOD.FUN / ROBINFUN / unknown
  pool_address text,
  trigger_metric text not null check (trigger_metric in ('LIQUIDITY', 'VOLUME')),
  trigger_value numeric,
  trigger_label text,              -- e.g. '$41,200 LIQUIDITY'
  liquidity_usd numeric,
  volume_24h_usd numeric,
  pool_created_at timestamptz,
  last_score integer,              -- score if a verdict already exists
  surfaced_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracked_launches_surfaced_at_idx
  on public.tracked_launches (surfaced_at desc);

-- This database is private to the application network; access control lives at
-- the application role and network boundary, not in Supabase/PostgREST RLS.
