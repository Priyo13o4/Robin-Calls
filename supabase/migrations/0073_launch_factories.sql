-- 0073 — A2 (KNOWN-PROBLEMS L58): the launch-transaction insider buy.
--
-- Seeded registry, same shape as 0072's locker_adapters: a small, curated set
-- of factory contracts whose `TokenLaunched`/`DevBuy` event ABI is known and
-- chain-verified, not a generic reader over every contract named
-- "LaunchFactory" (a Blockscout name search returns 50+ — most are private
-- one-shot deployments of the same template, A4's finding one layer over).
--
-- Chain-verified 2026-08-28 against 0xf592…7e87: 14 TokenLaunched events, 10
-- carry a DevBuy in the SAME transaction hash, 4 do not — the differential the
-- plan's test strategy asks for. Both events are indexed on `token`, so a scan
-- for one specific token is one targeted eth_getLogs per factory, never a
-- genesis walk.

create table if not exists launch_factories (
  address        text primary key
                 check (address = lower(address) and address ~ '^0x[0-9a-f]{40}$'),
  chain_id       bigint  not null default 4663,
  label          text    not null,
  enabled        boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into launch_factories (address, label, notes) values
  ('0xf5927907834199e7042dc56131473161be8a7e87','LaunchFactory',
   'Fully verified. TokenLaunched(token indexed, creator indexed, pool, positionTokenId, name, symbol, antiSnipe); DevBuy(token indexed, creator indexed, ethIn, tokensOut). Chain-verified 2026-08-28: 14 launches, 10/14 carry a same-tx DevBuy.')
on conflict (address) do update
  set label = excluded.label, updated_at = now();
