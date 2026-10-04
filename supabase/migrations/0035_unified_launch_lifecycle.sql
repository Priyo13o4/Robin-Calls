-- Unified hot-launch lifecycle (docs/ways-of-work/plan/tracker/
-- unified-hot-launch-lifecycle/implementation-plan.md, phases 2-4).
--
-- Additive only. tracked_launches and curve_tokens keep running unchanged —
-- they still back /api/curves' whitelist-depth reads and the legacy tracker
-- writes during this rollout. This migration adds the normalized feed the
-- Watchlist reads from: one row per token address across both direct-DEX and
-- launchpad discovery, a compact tombstone so an expired token is never
-- re-admitted, and curve-specific detail split out of the main row.
--
-- Formal migration/shadow-validation (retiring tracked_launches/curve_tokens
-- to a compatibility view) is explicitly out of scope for this pass — the
-- backfill below is a one-time seed of currently-active (<7 day) rows so the
-- new tabs aren't empty on first deploy, not a data-ownership handoff.

alter table public.launchpads add column if not exists venue_model text;

-- Existing adapters map 1:1 to a venue model today: curve-events-v1/hood-v1/
-- flap-v1 are true bonding curves; pons-v1 creates its DEX pool at launch and
-- is restricted (not curve-only) until its graduation oracle flips. This is
-- admin-reviewed registry data, not inferred from pool existence at read time.
update public.launchpads set venue_model = case adapter
  when 'pons-v1' then 'DEX_RESTRICTED'
  else 'BONDING_CURVE'
end where venue_model is null;

alter table public.launchpads alter column venue_model set not null;
alter table public.launchpads add constraint launchpads_venue_model_check
  check (venue_model = ANY (ARRAY['BONDING_CURVE'::text, 'DEX_RESTRICTED'::text]));

create table public.launch_candidates (
  token_address text primary key,
  launchpad_id bigint references public.launchpads(id) on delete set null,
  source_kind text not null,
  venue_model text,
  lifecycle_state text not null default 'CANDIDATE',
  pool_address text,
  token_name text,
  token_symbol text,
  liquidity_usd numeric,
  volume_24h_usd numeric,
  progress_bps integer,
  created_at timestamptz not null,
  surfaced_at timestamptz,
  graduated_at timestamptz,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint launch_candidates_token_address_check check (token_address = lower(token_address)),
  constraint launch_candidates_pool_address_check check (pool_address is null or pool_address = lower(pool_address)),
  constraint launch_candidates_source_kind_check check (source_kind = ANY (ARRAY['DIRECT_DEX'::text, 'LAUNCHPAD'::text])),
  constraint launch_candidates_venue_model_check check (venue_model is null or venue_model = ANY (ARRAY['BONDING_CURVE'::text, 'DEX_RESTRICTED'::text])),
  constraint launch_candidates_lifecycle_state_check check (lifecycle_state = ANY (ARRAY['CANDIDATE'::text, 'SURFACED'::text, 'GRADUATED'::text, 'EXPIRED'::text])),
  constraint launch_candidates_progress_bps_check check (progress_bps is null or (progress_bps >= 0 and progress_bps <= 10000)),
  -- Independent of client input: the write path derives expires_at the same
  -- way, but a bad row can never even reach the table with a stretched TTL.
  constraint launch_candidates_expires_at_check check (expires_at = created_at + interval '7 days')
);

create index launch_candidates_feed_idx on public.launch_candidates
  using btree (venue_model, lifecycle_state, created_at desc);
create index launch_candidates_expires_idx on public.launch_candidates
  using btree (expires_at);

-- No RLS/policy statements: this project is self-hosted Postgres (no
-- anon/authenticated Supabase roles exist here), matching every other
-- migration written since the self-hosting cutover (e.g. 0014, 0034). The
-- app's single DB role reads these tables directly.

create table public.curve_token_state (
  token_address text primary key references public.launch_candidates(token_address) on delete cascade,
  raised_wei numeric not null default '0',
  target_wei numeric,
  buys integer not null default 0,
  sells integer not null default 0,
  metadata_uri text,
  last_trade_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.launch_tombstones (
  token_address text primary key,
  source_kind text not null,
  launchpad_id bigint,
  original_created_at timestamptz not null,
  expired_at timestamptz not null default now(),
  constraint launch_tombstones_token_address_check check (token_address = lower(token_address))
);

-- One-time backfill: only rows still inside their 7-day active window,
-- computed off the same authoritative-creation-time rule the app uses.
-- Older rows are left exactly where they are in the source tables — this is
-- not a retention pass, so nothing here is tombstoned or deleted.
insert into public.launch_candidates
  (token_address, launchpad_id, source_kind, venue_model, lifecycle_state, pool_address,
   token_name, token_symbol, liquidity_usd, volume_24h_usd, progress_bps,
   created_at, surfaced_at, expires_at, updated_at)
select
  tl.token_address, null, 'DIRECT_DEX', null, 'SURFACED', tl.pool_address,
  tl.token_name, tl.token_symbol, tl.liquidity_usd, tl.volume_24h_usd, null,
  coalesce(tl.pool_created_at, tl.surfaced_at), tl.surfaced_at,
  coalesce(tl.pool_created_at, tl.surfaced_at) + interval '7 days', tl.updated_at
from public.tracked_launches tl
where coalesce(tl.pool_created_at, tl.surfaced_at) > now() - interval '7 days'
on conflict (token_address) do nothing;

insert into public.launch_candidates
  (token_address, launchpad_id, source_kind, venue_model, lifecycle_state, pool_address,
   token_name, token_symbol, progress_bps, created_at, surfaced_at, graduated_at, expires_at, updated_at)
select
  ct.token_address, ct.launchpad_id, 'LAUNCHPAD', lp.venue_model,
  case ct.status when 'GRADUATED' then 'GRADUATED' else 'SURFACED' end,
  ct.dex_pool_address, ct.name, ct.symbol, ct.progress_bps,
  coalesce(ct.created_at, ct.updated_at), coalesce(ct.created_at, ct.updated_at), ct.graduated_at,
  coalesce(ct.created_at, ct.updated_at) + interval '7 days', ct.updated_at
from public.curve_tokens ct
join public.launchpads lp on lp.id = ct.launchpad_id
where coalesce(ct.created_at, ct.updated_at) > now() - interval '7 days'
  and ct.status != 'STALLED'
on conflict (token_address) do nothing;

insert into public.curve_token_state
  (token_address, raised_wei, target_wei, buys, sells, metadata_uri, last_trade_at, updated_at)
select ct.token_address, ct.raised_wei, ct.target_wei, ct.buys, ct.sells, ct.metadata_uri, ct.last_trade_at, ct.updated_at
from public.curve_tokens ct
join public.launch_candidates lc on lc.token_address = ct.token_address
on conflict (token_address) do nothing;
