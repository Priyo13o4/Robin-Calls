-- ─────────────────────────────────────────────────────────────
-- RobinCalls — trusted LP lockers move from env to DB, and the scanner
-- starts logging every inconclusive read for manual review.
--
-- 1. trusted_lockers: replaces LP_TRUSTED_LOCKERS / V2_TRUSTED_LOCKERS env
--    vars. Multi-DEX made an env list unmanageable — every new launchpad
--    ships its own locker, and adding one shouldn't need a redeploy. The
--    scanner loads enabled rows at scan start (lib/config/lockers.ts);
--    admins manage rows at /admin/lockers. `kind` drives verdict wording:
--    a permanent locker ("can never be withdrawn") reads very differently
--    from a time-lock ("until the lock expires").
--
-- 2. scan_uncertainties: one row per (token, check, code, subject) where a
--    scan was indefinite — a SKIPped check, an UNKNOWN custody read, an
--    unclassified contract custodian (possible locker), unmeasured pool
--    materiality. Aggregated (times_seen / last_seen_at), not per-scan, so
--    repeat scans bump a counter instead of flooding the queue. Reviewed
--    rows keep counting but stay out of the open queue at /admin/review.
--
-- These tables are reachable only through the private application DB
-- connection; no Supabase/PostgREST RLS roles exist in this baseline.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.trusted_lockers (
  address    text primary key,          -- lowercase 0x…
  label      text not null,             -- human name, e.g. 'StoxesFun V3 Locker'
  kind       text not null default 'timelock'
             check (kind in ('permanent', 'timelock')),
  enabled    boolean not null default true,
  notes      text,
  added_by   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed the locker that surfaced this work (BULL, verdict #128): verified
-- source, no transfer/withdraw/decreaseLiquidity path — principal is
-- permanently locked; only trading fees leave via collect().
insert into public.trusted_lockers (address, label, kind, notes, added_by) values
  (
    '0x134d32ea27ba2abb28cf210b5dc814f33ea570b5',
    'StoxesFun V3 Locker',
    'permanent',
    'stoxes.fun platform locker. Verified source (StoxesFunV3Locker); the position NFT has no exit path — no transferFrom / decreaseLiquidity / withdraw. Fees split creator/buyback via collect().',
    'migration-0024'
  )
on conflict (address) do nothing;

create table if not exists public.scan_uncertainties (
  id              bigint generated always as identity primary key,
  token_address   text not null,
  check_id        text not null,        -- e.g. 'lp_custody', 'honeypot'
  code            text not null,        -- slug, e.g. 'contract-custodian-unclassified'
  subject         text not null default '',  -- the address/pool the doubt is about
  summary         text not null,
  detail          jsonb,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  last_scan_id    text,
  last_verdict_id bigint,
  times_seen      integer not null default 1,
  reviewed_at     timestamptz,
  reviewed_by     text,
  resolution      text,
  constraint scan_uncertainties_key unique (token_address, check_id, code, subject)
);

create index if not exists scan_uncertainties_open_idx
  on public.scan_uncertainties (last_seen_at desc)
  where reviewed_at is null;
create index if not exists scan_uncertainties_token_idx
  on public.scan_uncertainties (token_address, last_seen_at desc);
