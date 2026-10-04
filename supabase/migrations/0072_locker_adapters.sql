-- 0072 — A1 (KNOWN-PROBLEMS L58): lock terms as data.
--
-- Seeded dispatch table, NOT a generic reader. Probed all 17 contracts ever
-- named `largestPuller` against 27 candidate signatures (plan doc, "A1 is an
-- ADAPTER REGISTRY"): no shared lock interface exists across lockers, so this
-- is registry curation like `launchpads`/`trusted_address` — a row per known
-- locker family, seeded once, extended from /admin when a new locker appears.
--
-- A row with no working adapter (see lib/dex/lock-terms.ts's dispatch — only
-- 'uncx-v3' has one) still resolves lockTerms.status = 'unreadable' rather
-- than silently succeeding: seeding the address is not a claim that we can
-- read it, only that we know what it is.

create table if not exists locker_adapters (
  address        text primary key
                 check (address = lower(address) and address ~ '^0x[0-9a-f]{40}$'),
  chain_id       bigint  not null default 4663,
  family         text    not null,     -- 'uncx-v3' | 'lplocker-v3' | ...
  label          text    not null,
  enabled        boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into locker_adapters (address, family, label, notes) values
  ('0xf28704c691290547924e2129d407da36bda8ce0f','uncx-v3','UNCX_LiquidityLocker_UniV3',
   'Fully verified, OZ-audited, published interface. getLock/getLocksLength. Chain-verified 2026-08-28: getLocksLength()=8, ETERNAL_LOCK()=type(uint256).max.'),
  ('0xa496a35a9fa24b388fe4affa013c106a3ae54bd9','lplocker-v3','LP Locker V3',
   'Answers locks(uint256). ABI unconfirmed — no adapter implemented yet; resolves unreadable until one is written and fixtured.')
on conflict (address) do update
  set family = excluded.family, label = excluded.label, updated_at = now();
