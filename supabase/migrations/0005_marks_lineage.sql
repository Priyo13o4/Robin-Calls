-- ─────────────────────────────────────────────────────────────
-- Phase 3 — The Memory Upgrades (docs/prds/phase3-blockchain-plan.md)
--   * #1 persistent honeypot marks (+ admin pardon audit trail)
--   * #4 wallet-lineage graph: edges, stains, propagation-breaker hubs
--   * serial-clone template registry + tokens.bytecode_hash
--   * slow-rug watch events
--   * formula v1.1 seed row
-- Same conventions as 0001/0003: bigint identity, timestamptz, text,
-- RLS on + world-readable, writes only via the server secret key.
-- ─────────────────────────────────────────────────────────────

-- ── token_marks: permanent marks that outlive live contract state (#1) ──
-- A token flagged as a honeypot is marked forever. The mark caps its future
-- score at DANGER. An admin may LIFT a mark (genuine false positives, audits)
-- with a mandatory public reason; a lifted mark stays visible and re-arms
-- automatically if the trap ever fires again.
create table if not exists public.token_marks (
  id bigint generated always as identity primary key,
  token_address text not null,
  kind text not null default 'honeypot' check (kind in ('honeypot')),
  source_verdict_id bigint references public.verdicts (id),
  evidence jsonb not null default '{}'::jsonb,
  liquidity_usd_at_mark numeric,          -- was anyone actually trapped?
  fired_count integer not null default 1, -- how many times the trap re-fired
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- pardon fields (admin override) — all public
  lifted_at timestamptz,
  lifted_reason text,
  lifted_by text,
  unique (token_address, kind)
);

create index if not exists token_marks_token_idx on public.token_marks (token_address);
create index if not exists token_marks_active_idx
  on public.token_marks (token_address) where lifted_at is null;

-- ── mark_events: append-only audit of every mark action ──
create table if not exists public.mark_events (
  id bigint generated always as identity primary key,
  token_address text not null,
  kind text not null,
  action text not null check (action in ('created', 're-fired', 'lifted', 're-armed')),
  actor text not null default 'system',   -- 'system' or admin username
  reason text,
  verdict_id bigint references public.verdicts (id),
  created_at timestamptz not null default now()
);

create index if not exists mark_events_token_idx on public.mark_events (token_address, created_at desc);

-- ── wallet_edges: immutable "who funded whom" cache (#4) ──
-- The gas that funds a fresh wallet is the umbilical cord back to its operator.
-- Every edge we discover while scanning is cached here so the graph grows as a
-- side effect of normal scans; edges are re-verifiable from the public chain.
create table if not exists public.wallet_edges (
  id bigint generated always as identity primary key,
  funder text not null,
  fundee text not null,
  tx_hash text not null,
  block_number bigint,
  value_wei numeric,
  kind text not null default 'first_fund' check (kind in ('first_fund', 'fund', 'payout')),
  created_at timestamptz not null default now(),
  unique (funder, fundee, tx_hash)
);

create index if not exists wallet_edges_fundee_idx on public.wallet_edges (fundee);
create index if not exists wallet_edges_funder_idx on public.wallet_edges (funder);

-- ── wallet_hubs: propagation breakers (exchanges, faucets, bridges, routers) ──
-- A high fan-out address never transmits guilt — CEX hot wallets fund thousands.
create table if not exists public.wallet_hubs (
  address text primary key,
  label text,
  source text not null default 'auto-fanout' check (source in ('auto-fanout', 'manual')),
  fanout_count integer,
  created_at timestamptz not null default now()
);

-- ── wallet_stains: materialized guilt, recomputed when a rug lands ──
-- hops=1 is a kill-shot at scan time; hops=2 is a heavy weighted deduction.
-- Every stain carries its full tx path so any flag is re-verifiable. Stains
-- are pardonable on the same terms as marks.
create table if not exists public.wallet_stains (
  id bigint generated always as identity primary key,
  address text not null,
  origin_rug_id bigint references public.rugs (id),
  origin_deployer text not null,          -- the confirmed rugger this traces to
  hops smallint not null check (hops between 1 and 2),
  direction text not null check (direction in ('upstream', 'downstream')),
  path jsonb not null default '[]'::jsonb, -- [{from,to,tx_hash,block}] evidence
  active boolean not null default true,
  lifted_reason text,
  lifted_at timestamptz,
  lifted_by text,
  created_at timestamptz not null default now(),
  unique (address, origin_rug_id)
);

create index if not exists wallet_stains_address_active_idx
  on public.wallet_stains (address) where active;
create index if not exists wallet_stains_origin_idx on public.wallet_stains (origin_deployer);

-- ── bytecode_templates: serial-clone registry (Attack of the Clones) ──
-- keccak of runtime bytecode with trailing CBOR metadata stripped, so recompiles
-- of the same source collide. Classifies known-good and known-bad templates and
-- finally populates the bytecode_fingerprint check.
create table if not exists public.bytecode_templates (
  id bigint generated always as identity primary key,
  bytecode_hash text not null unique,
  label text,
  classification text not null default 'unknown'
    check (classification in ('legit-template', 'scam-template', 'unknown')),
  seen_count integer not null default 1,
  first_seen_token text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── slow_rug_watch: gradual-drain suspects (soft-rug monitor) ──
create table if not exists public.slow_rug_watch (
  id bigint generated always as identity primary key,
  token_address text not null,
  reason text not null,               -- 'liquidity-drain' | 'dev-cluster-dump'
  peak_liquidity_usd numeric,
  current_liquidity_usd numeric,
  drain_pct numeric,                  -- 0..1 fraction drained from trailing peak
  dev_cluster_share_delta numeric,    -- change in deployer+lineage supply share
  evidence jsonb not null default '{}'::jsonb,
  cleared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token_address, reason)
);

create index if not exists slow_rug_watch_token_idx on public.slow_rug_watch (token_address);
create index if not exists slow_rug_watch_active_idx
  on public.slow_rug_watch (token_address) where cleared = false;

-- ── tokens.bytecode_hash: serial-clone lookup key ──
alter table public.tokens add column if not exists bytecode_hash text;
create index if not exists tokens_bytecode_hash_idx on public.tokens (bytecode_hash);

-- ─────────────────────────────────────────────────────────────
-- RLS: world-readable, no write policies (server secret key bypasses).
-- ─────────────────────────────────────────────────────────────
-- Access control is provided by the private application DB connection; this
-- baseline intentionally has no Supabase/PostgREST RLS roles or policies.

-- ── new stat counters surfaced on the site ──
insert into public.compare_stats (key, value)
values ('marks_active', 0), ('wallets_stained', 0)
on conflict (key) do nothing;

-- ── formula v1.1 seed (mirrors lib/config/formula.ts) ──
insert into public.formula_versions (version, weights, changelog)
values (
  '1.1',
  '{
    "lp_custody": 18, "deployer_history": 14, "funding_lineage": 12,
    "brand_squatting": 12, "holder_concentration": 10, "ownership": 10,
    "liquidity_depth": 10, "upgradeability": 8, "source_verification": 8,
    "fdv_liquidity_ratio": 8, "dangerous_selectors": 6, "volume_turnover": 6,
    "tax_manipulation": 6, "serial_clone": 6, "launchpad_provenance": 6,
    "pool_age": 5, "contract_age": 4, "bytecode_fingerprint": 6
  }'::jsonb,
  'The Memory Upgrades. New checks: funding_lineage (stained-funds graph), upgradeability (EIP-1967 proxy), dangerous_selectors (hidden mint/pause/blacklist), serial_clone (redeployed rug bytecode). New post-score rule: prior-honeypot mark caps the score at DANGER. funder_rug_history override is now graph-backed.'
)
on conflict (version) do nothing;
