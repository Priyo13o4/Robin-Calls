-- Unified trusted-address registry and RWA verification state (RWA PRD §4).
-- Addresses are stored lowercase to make chain comparisons deterministic.

alter table public.registry
  add column if not exists verify_status text not null default 'unchecked'
    check (verify_status in ('ok', 'failed', 'unchecked', 'unprobeable')),
  add column if not exists verified_at timestamptz;

create table if not exists public.trusted_address (
  id uuid primary key default gen_random_uuid(),
  address text not null check (address = lower(address) and address ~ '^0x[0-9a-f]{40}$'),
  chain_id integer not null default 4663,
  category text not null check (category in (
    'dex-factory', 'dex-router', 'dex-quoter', 'dex-position-manager',
    'dex-pool-manager', 'dex-state-view', 'permit2', 'lp-locker',
    'burn-address', 'infra-asset', 'rwa-beacon', 'rwa-impl', 'rwa-factory',
    'rwa-vault', 'rwa-operator', 'bridge-system-owner', 'trusted-proxy'
  )),
  subtype text,
  label text not null check (length(trim(label)) >= 2),
  dex_id text,
  metadata jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  verified_at timestamptz,
  verify_status text not null default 'unchecked'
    check (verify_status in ('ok', 'failed', 'unchecked', 'unprobeable')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (address, chain_id)
);

create index if not exists trusted_address_enabled_category_idx
  on public.trusted_address (category, dex_id) where enabled;

-- The registry is served through the private application DB connection; no
-- Supabase/PostgREST RLS roles are part of the self-hosted baseline.

create or replace function public.set_trusted_address_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trusted_address_updated_at on public.trusted_address;
create trigger trusted_address_updated_at before update on public.trusted_address
  for each row execute function public.set_trusted_address_updated_at();

-- Existing canonical RWA basket was independently verified against the beacon
-- model on 2026-07-19; runtime still re-verifies on each cache refresh.
update public.registry
set verify_status = 'ok', verified_at = coalesce(verified_at, now())
where category in ('stock-token', 'etf');

insert into public.trusted_address
  (address, chain_id, category, subtype, label, dex_id, metadata, enabled, verify_status, verified_at, created_by)
values
  ('0xe10b6f6b275de231345c20d14ab812db62151b00', 4663, 'rwa-beacon', null, 'Robinhood stock beacon', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2', 4663, 'rwa-impl', null, 'Stock implementation', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x4783c67b63de2b358ac5951a7d41f47a38f3c046', 4663, 'rwa-factory', null, 'Robinhood stock token factory', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x2f4579ca81717d3d61bf8b6f06571877bbe54a07', 4663, 'rwa-vault', null, 'Robinhood omnibus custody vault', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x49ef9869fc358b6e755c722ea8514a574bd8ce8e', 4663, 'rwa-vault', null, 'Robinhood StockVault', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x94bab9693ba2f6358507effcbd372b0660afff9d', 4663, 'rwa-vault', null, 'Robinhood Escrow', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0xef5ca6b3c55230b630b9867a05518d882293cbd4', 4663, 'rwa-operator', null, 'Robinhood custody relayer', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0xa3acd31afb851b4eb9dad00f5204c01d924267df', 4663, 'bridge-system-owner', null, 'Orbit bridge admin', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x0bd7d308f8e1639fab988df18a8011f41eacad73', 4663, 'infra-asset', null, 'Wrapped Ether', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x5fc5360d0400a0fd4f2af552add042d716f1d168', 4663, 'infra-asset', null, 'USDG', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x0000000000000000000000000000000000000000', 4663, 'burn-address', null, 'Zero address', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x000000000000000000000000000000000000dead', 4663, 'burn-address', null, 'Dead address', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x8366a39cc670b4001a1121b8f6a443a643e40951', 4663, 'dex-pool-manager', null, 'Uniswap V4 PoolManager', 'uniswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7', 4663, 'dex-quoter', null, 'Uniswap V3 QuoterV2', 'uniswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f', 4663, 'dex-factory', null, 'Uniswap V2 factory', 'uniswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x89e5db8b5aa49aa85ac63f691524311aeb649eba', 4663, 'dex-router', null, 'Uniswap V2 Router02', 'uniswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x8876789976decbfcbbbe364623c63652db8c0904', 4663, 'dex-router', null, 'Uniswap Universal Router', 'uniswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x000000000022d473030f116ddee9f6b43ac78ba3', 4663, 'permit2', null, 'Permit2', null, '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0xe52abd50ad151ecdf56427effd715e703696a6b1', 4663, 'dex-factory', null, 'Sushi V2 factory', 'sushiswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x9a55d3d0c0f09859c7869510f53ed0a30b340766', 4663, 'dex-router', null, 'Sushi V2 Router02', 'sushiswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0xe51960f1b45f1c9fb6d166e6a884f866fc70433b', 4663, 'dex-factory', null, 'Sushi V3 factory', 'sushiswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x1e406484f1f204b23ce84b9901c0171a738fd406', 4663, 'dex-router', null, 'Sushi V3 SwapRouter', 'sushiswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x3e290e5e01818002a0b672148bdc7514d861c7b3', 4663, 'dex-quoter', null, 'Sushi V3 QuoterV2', 'sushiswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x51d0e5188afe12d502e29d982d20c190e7816107', 4663, 'dex-position-manager', null, 'Sushi V3 position manager', 'sushiswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e', 4663, 'dex-factory', null, 'Pancake V2 factory', 'pancakeswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x8cfe327cec66d1c090dd72bd0ff11d690c33a2eb', 4663, 'dex-router', null, 'Pancake V2 Router02', 'pancakeswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865', 4663, 'dex-factory', null, 'Pancake V3 factory', 'pancakeswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x1b81d678ffb9c0263b24a97847620c99d213eb14', 4663, 'dex-router', null, 'Pancake V3 SwapRouter', 'pancakeswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x8553aa1615549a86882151784b329b017aa7c832', 4663, 'dex-quoter', null, 'Pancake V3 QuoterV2', 'pancakeswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027'),
  ('0x46a15b0b27311cedf172ab29e4f4766fbe7f4364', 4663, 'dex-position-manager', null, 'Pancake V3 position manager', 'pancakeswap', '{}'::jsonb, true, 'ok', now(), 'migration-0027')
on conflict (address, chain_id) do update set
  category = excluded.category, subtype = excluded.subtype, label = excluded.label,
  dex_id = excluded.dex_id, metadata = excluded.metadata, enabled = excluded.enabled,
  verify_status = excluded.verify_status, verified_at = excluded.verified_at,
  created_by = excluded.created_by;

-- Preserve existing reviewed lockers in the unified cache without deleting the
-- legacy table; old admin links continue to be safe during rollout.
insert into public.trusted_address
  (address, chain_id, category, subtype, label, enabled, verify_status, verified_at, created_by)
select address, 4663, 'lp-locker', kind, label, enabled, 'ok', now(), coalesce(added_by, 'legacy-locker-migration')
from public.trusted_lockers
on conflict (address, chain_id) do update set
  category = 'lp-locker', subtype = excluded.subtype, label = excluded.label,
  enabled = excluded.enabled, verify_status = 'ok', verified_at = excluded.verified_at;
