-- ─────────────────────────────────────────────────────────────
-- RobinCalls — initial schema (PRD v4 §8)
-- Conventions (supabase-postgres-best-practices):
--   * bigint identity PKs, timestamptz, text (no varchar(n))
--   * RLS enabled on every table; anon/authenticated get read-only
--   * writes happen only via the secret-key server client (service_role)
--   * every FK and RLS/filter column is indexed
-- ─────────────────────────────────────────────────────────────

-- ── verdicts: the hash-chained permanent record (§7.4) ──
create table if not exists public.verdicts (
  id bigint generated always as identity primary key,
  token_address text not null,
  token_name text,
  token_symbol text,
  score integer not null check (score >= 0 and score <= 100),
  tier text not null check (tier in ('CLEAR', 'CAUTION', 'DANGER', 'CRITICAL')),
  critical_override text,                 -- id of the kill-shot that fired, if any
  score_version text not null,            -- formula version used (§7.4)
  checks jsonb not null,                  -- full per-check results + evidence
  market_snapshot jsonb,                  -- price/liq/vol at scan time
  entry_hash text not null unique,        -- sha256 of canonical payload + prev_hash
  prev_hash text not null,                -- previous entry's hash ('genesis' for #1)
  anchor_tx text,                         -- tx hash of the anchor that covers this entry
  anchored_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists verdicts_token_address_idx on public.verdicts (token_address);
create index if not exists verdicts_created_at_idx on public.verdicts (created_at desc);
create index if not exists verdicts_tier_idx on public.verdicts (tier);

-- ── deployers: persistent memory across sessions (the moat) ──
create table if not exists public.deployers (
  id bigint generated always as identity primary key,
  address text not null unique,
  funder_address text,
  launches_total integer not null default 0,
  launches_dead integer not null default 0,   -- pools that fell under $1k liquidity
  confirmed_rugs integer not null default 0,
  extracted_usd numeric(18,2) not null default 0,
  first_seen_block bigint,
  last_seen_block bigint,
  notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists deployers_funder_address_idx on public.deployers (funder_address);
create index if not exists deployers_confirmed_rugs_idx on public.deployers (confirmed_rugs desc);

-- ── tokens: every token we have ever looked at ──
create table if not exists public.tokens (
  id bigint generated always as identity primary key,
  address text not null unique,
  name text,
  symbol text,
  deployer_id bigint references public.deployers (id),
  launchpad text,                          -- NOXA / HOOD.FUN / ROBINFUN / unknown
  deploy_block bigint,
  deploy_tx text,
  is_dead boolean not null default false,  -- liquidity < $1k
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tokens_deployer_id_idx on public.tokens (deployer_id);
create index if not exists tokens_launchpad_idx on public.tokens (launchpad);

-- ── rugs: Wanted Board rows — gated on §7.6 criteria; precision over recall ──
create table if not exists public.rugs (
  id bigint generated always as identity primary key,
  deployer_id bigint not null references public.deployers (id),
  token_id bigint references public.tokens (id),
  criteria_version text not null,          -- which rug-definition version matched
  extracted_usd numeric(18,2),
  evidence jsonb not null,                 -- machine-checkable evidence bundle (§7.6)
  rugged_at timestamptz,
  rugged_block bigint,
  created_at timestamptz not null default now()
);

create index if not exists rugs_deployer_id_idx on public.rugs (deployer_id);
create index if not exists rugs_token_id_idx on public.rugs (token_id);

-- ── registry: canonical Robinhood assets snapshot (§6) ──
create table if not exists public.registry (
  id bigint generated always as identity primary key,
  asset_name text not null,
  asset_symbol text not null,
  address text not null,
  category text,                            -- stock-token / infra / major asset
  fetched_at timestamptz not null default now(),
  unique (address)
);

create index if not exists registry_symbol_idx on public.registry (asset_symbol);

-- ── market_snapshots: GeckoTerminal poll results (§8) ──
create table if not exists public.market_snapshots (
  id bigint generated always as identity primary key,
  token_address text not null,
  price_usd numeric,
  liquidity_usd numeric,
  volume_24h_usd numeric,
  buys_24h integer,
  sells_24h integer,
  fdv_usd numeric,
  pool_address text,
  pool_created_at timestamptz,
  ts timestamptz not null default now()
);

create index if not exists market_snapshots_token_ts_idx
  on public.market_snapshots (token_address, ts desc);

-- ── formula_versions: published scoring formula history (§8, §7.5) ──
create table if not exists public.formula_versions (
  id bigint generated always as identity primary key,
  version text not null unique,
  weights jsonb not null,
  changelog text not null,
  effective_at timestamptz not null default now()
);

-- ── compare_stats: cached counters for landing §4.7 chips ──
create table if not exists public.compare_stats (
  id bigint generated always as identity primary key,
  key text not null unique,               -- verdicts_issued / anchors_onchain / wallets_indicted
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.compare_stats (key, value)
values ('verdicts_issued', 0), ('anchors_onchain', 0), ('wallets_indicted', 0)
on conflict (key) do nothing;

-- ── anchors: each anchoring tx from the Robin wallet ──
create table if not exists public.anchors (
  id bigint generated always as identity primary key,
  head_hash text not null,                -- ledger head covered by this anchor
  up_to_verdict_id bigint not null references public.verdicts (id),
  tx_hash text not null unique,
  block_number bigint,
  created_at timestamptz not null default now()
);

create index if not exists anchors_up_to_verdict_id_idx on public.anchors (up_to_verdict_id);

-- ─────────────────────────────────────────────────────────────
-- Direct-Postgres deployment: the database is private to the Docker network;
-- the Next.js server is the only application connection. There is no PostgREST
-- endpoint and therefore no Supabase `anon`, `authenticated`, or
-- `service_role` database role. Access is enforced by the application role,
-- pgbouncer, nginx, and the private Docker network rather than RLS policies.
-- ─────────────────────────────────────────────────────────────

-- ── seed formula v1.0 (mirrors lib/config/formula.ts) ──
insert into public.formula_versions (version, weights, changelog)
values (
  '1.0',
  '{
    "lp_custody": 18, "deployer_history": 14, "brand_squatting": 12,
    "holder_concentration": 10, "ownership": 10, "liquidity_depth": 10,
    "source_verification": 8, "fdv_liquidity_ratio": 8, "volume_turnover": 6,
    "tax_manipulation": 6, "pool_age": 5, "contract_age": 4,
    "launchpad_provenance": 6, "bytecode_fingerprint": 6
  }'::jsonb,
  'Initial published formula. 14 weighted checks, 5 CRITICAL overrides, industry-standard tier bands.'
)
on conflict (version) do nothing;
