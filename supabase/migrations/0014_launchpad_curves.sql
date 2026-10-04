-- ─────────────────────────────────────────────────────────────
-- 0014 — Launchpad Curve Aggregator (docs/prds/launchpad-aggregator-prd.md)
--
-- Two tables:
--   launchpads   — admin-curated registry of bonding-curve contracts to index
--   curve_tokens — per-token curve state ("graduating soon" feed rows)
--
-- RLS follows the internal-state pattern (0009): enabled, NO policies. The
-- feed is served by /api/curves which enforces the top-6 public / whitelist
-- premium gate — a public read policy here would let anyone with the
-- publishable key read every row and bypass that gate entirely.
--
-- The per-launchpad getLogs cursor lives ON the launchpads row
-- (last_processed_block) rather than in factory_cursor: factory_cursor's
-- protocol check is V2/V3-specific and a registry row is the natural home.
--
-- Cron: robincalls-curve-poll every 5 minutes, guarded — skipped with a
-- notice when 0010's rc_schedule_job helper or job config are absent,
-- so this migration lands cleanly on databases where cron was never set up.
-- ─────────────────────────────────────────────────────────────

-- ── launchpads: the registry ──
create table if not exists public.launchpads (
  id            bigint generated always as identity primary key,
  slug          text not null unique check (slug = lower(slug)),
  name          text not null,
  curve_address text not null unique
    check (curve_address = lower(curve_address) and curve_address ~ '^0x[0-9a-f]{40}$'),

  -- adapter preset implemented in lib/tracker/curves/adapters/.
  --   curve-events-v1 — pump.fun-clone singleton, unverified OK: TokenCreated/
  --                     Buy/Sell events carry the running real-ETH reserve.
  --   hood-v1         — verified HoodCustomLaunchpad: progressBps() view +
  --                     TokenCreated/Trade/Graduated events.
  adapter text not null check (adapter in ('curve-events-v1', 'hood-v1', 'flap-v1', 'pons-v1')),

  -- preset-specific knobs, e.g. {"targetWeiOverride": "2130000000000000000"}.
  config jsonb not null default '{}'::jsonb,

  enabled boolean not null default false,
  notes   text,

  -- resumable getLogs bookmark (mirrors factory_cursor semantics)
  last_processed_block bigint not null default 0,

  -- result of the last admin auto-verification probe (shape in probe.ts)
  last_probe jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── curve_tokens: per-token curve state ──
create table if not exists public.curve_tokens (
  token_address text primary key
    check (token_address = lower(token_address)),
  launchpad_id  bigint not null references public.launchpads(id) on delete cascade,

  name            text,
  symbol          text,
  metadata_uri    text,
  creator_address text,
  created_block   bigint,
  created_at      timestamptz,

  -- curve fill. raised_wei is the launchpad's own running real-reserve figure
  -- (robinfun newRealEth / hood getCurve), NOT a sum we compute — sells lower it.
  raised_wei   numeric not null default 0,
  target_wei   numeric,
  progress_bps integer not null default 0 check (progress_bps between 0 and 10000),

  buys            integer not null default 0,
  sells           integer not null default 0,
  -- creator self-buy signal: wei the creator has put into their own curve
  creator_buy_wei numeric not null default 0,
  last_trade_at   timestamptz,

  status text not null default 'CURVING'
    check (status in ('CURVING', 'GRADUATED', 'STALLED')),
  dex_pool_address text,
  graduated_at     timestamptz,

  updated_at timestamptz not null default now()
);

-- feed query: status = CURVING, progress band, sorted by progress desc
create index if not exists curve_tokens_feed_idx
  on public.curve_tokens (status, progress_bps desc);
create index if not exists curve_tokens_pad_idx
  on public.curve_tokens (launchpad_id, status);
-- creator risk context (prior launches by the same wallet)
create index if not exists curve_tokens_creator_idx
  on public.curve_tokens (creator_address)
  where creator_address is not null;

-- ── Seed the launchpads verified on-chain (PRD §2) ──
insert into public.launchpads (slug, name, curve_address, adapter, config, enabled, notes)
values
  (
    'robinfun', 'robin.fun',
    '0xd861cb5dc71a0171e8f0f6586cadb069f3a35e4d',
    'curve-events-v1',
    -- targetParam: which TokenCreated uint is the graduation target. "ethA"
    -- (~2.13 ETH) per PRD §6.3 analysis; no robinfun token has graduated yet,
    -- so this awaits empirical confirmation — override via targetWeiOverride.
    '{"targetParam": "ethA"}'::jsonb,
    true,
    'Unverified singleton curve; events decoded + verified on-chain 2026-07-16 (PRD §2.1). 563 tokens at verification time. The 0x7757/0xdfba event pair fires at CREATION (creator token lock), not graduation.'
  ),
  (
    'hoodfun', 'hood.fun',
    '0x5fcc1df0dc020cf454e742e9a8ae2554c37a452c',
    'hood-v1',
    '{}'::jsonb,
    true,
    'Verified HoodCustomLaunchpad (PRD §2.2). progressBps() is authoritative; Graduated/Migrated events carry the handoff. 3,072 tokens / 15 graduations at verification time.'
  ),
  (
    'flapsh', 'flap.sh',
    '0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09',
    'flap-v1',
    '{"website": "https://flap.sh"}'::jsonb,
    true,
    'flap.sh bonding curve behind a TransparentUpgradeableProxy. Events decoded on-chain 2026-07-19: TokenCreated/Bought/Sold + FlapTokenProgressChanged (WAD ratio).'
  ),
  (
    'pons', 'Pons',
    '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',
    'pons-v1',
    '{"website": "https://ponsfamily.com/launchpad"}'::jsonb,
    true,
    'PonsLaunchFactory (ponsfamily.com/launchpad), verified on-chain 2026-07-19. Direct V3 launcher with a graduation gate: graduationStatus(token) drives progress.'
  )
on conflict (slug) do nothing;

-- ── Cron: every 5 minutes, guarded on 0010 prerequisites ──
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job(
      'robincalls-curve-poll', '*/5 * * * *', '/api/jobs/curve-poll');
  else
    raise notice 'RC_CRON_SKIPPED: rc_schedule_job or job config absent — schedule robincalls-curve-poll manually once cron prerequisites (0010) exist.';
  end if;
end $$;
