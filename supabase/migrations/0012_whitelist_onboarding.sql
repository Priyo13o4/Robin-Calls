-- ─────────────────────────────────────────────────────────────
-- RobinCalls — whitelist onboarding (PRD: docs/prds/whitelist-onboarding-prd.md)
--
-- Two tables:
--   whitelist_members  — one row per whitelisted user, keyed on wallet_address
--   whitelist_events   — append-only audit trail for debugging drop-off
--
-- RLS deviates from the site's default "world-readable" convention
-- (supabase/README.md) on purpose: these rows are PII (wallet address bound
-- to a self-reported X handle), not a public directory. Same exception 0004
-- makes for the Better Auth tables — RLS enabled, NO policies, so the
-- anon/authenticated PostgREST roles (the sb_publishable key, which ships to
-- the browser) get zero access. Only the server's supabaseAdmin() (secret
-- key) can read or write; the whitelist API routes are the sole path in.
-- ─────────────────────────────────────────────────────────────

-- ── whitelist_members ──
create table if not exists public.whitelist_members (
  id             bigint generated always as identity primary key,
  wallet_address text not null unique
    check (wallet_address = lower(wallet_address)),

  -- X identity (nullable until step 1 completes). V1 links a self-reported
  -- handle only — no OAuth, no verified follow/like/repost (see PRD §12).
  twitter_username      text
    check (twitter_username is null or twitter_username ~ '^[A-Za-z0-9_]{1,15}$'),
  twitter_user_id       text,           -- populated by OAuth when available (V2)
  twitter_connected_at  timestamptz,
  twitter_oauth_provider text,          -- future multi-provider support (V2)

  -- policy versioning — lets you tighten social verification later
  -- without a messy migration (PRD §12)
  social_steps_policy_version text not null default '1.0',

  -- overall status
  whitelist_status text not null default 'pending'
    check (whitelist_status in ('pending', 'approved', 'rejected', 'revoked')),

  -- per-step progress (3-step collapsed flow)
  step_1_status text not null default 'not_started'  -- Connect X
    check (step_1_status in ('not_started', 'in_progress', 'completed', 'failed')),
  step_2_status text not null default 'not_started'  -- Social Tasks (engage + share)
    check (step_2_status in ('not_started', 'in_progress', 'completed', 'failed')),
  step_3_status text not null default 'not_started'  -- Connect Wallet + sign
    check (step_3_status in ('not_started', 'in_progress', 'completed', 'failed')),

  -- timestamps
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  approved_at timestamptz
);

-- Lookup by wallet (primary key for gating checks)
create index if not exists whitelist_members_wallet_idx
  on public.whitelist_members (wallet_address);

-- Lookup by twitter handle (dedup / admin search)
create index if not exists whitelist_members_twitter_idx
  on public.whitelist_members (twitter_username)
  where twitter_username is not null;

-- Filter by status (admin dashboard queries)
create index if not exists whitelist_members_status_idx
  on public.whitelist_members (whitelist_status);

-- ── whitelist_events (audit trail) ──
create table if not exists public.whitelist_events (
  id             bigint generated always as identity primary key,
  wallet_address text,
  event_type     text not null,    -- x_connected, social_tasks_completed,
                                   -- wallet_connected, wallet_signed, approved,
                                   -- status_changed
  payload_json   jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists whitelist_events_wallet_idx
  on public.whitelist_events (wallet_address)
  where wallet_address is not null;

create index if not exists whitelist_events_type_idx
  on public.whitelist_events (event_type);

create index if not exists whitelist_events_created_idx
  on public.whitelist_events (created_at desc);

-- Whitelist data is only reachable through the private application DB
-- connection; this self-hosted baseline has no Supabase/PostgREST RLS roles.
