-- PancakeSwap auxiliary infrastructure addresses (informational).
--
-- These six contracts are the rest of PancakeSwap's V3/V2 deployment on
-- Robinhood Chain (4663), verified from the DEX's own address list. They are
-- seeded as `dex-infra` — a NEW, intentionally inert category that the DEX
-- registry's role() lookup NEVER queries (it only asks for dex-factory /
-- dex-router / dex-quoter / dex-position-manager / dex-pool-manager /
-- dex-state-view). So none of these rows can ever be selected for discovery,
-- custody, or the sell-sim; they exist purely to NAME the contract when a scan
-- encounters it, instead of reporting an "unknown contract".
--
-- The functionally-wired PancakeSwap addresses stay where they are:
--   * V3 SwapRouter  0x1b81d678… -> dex-router   (seed 0027)
--   * V3 QuoterV2    0x8553aa16… -> dex-quoter   (seed 0027)
-- The SmartRouter and MixedRouteQuoterV1 below are deliberately NOT given the
-- dex-router / dex-quoter category: the SmartRouter routes through intermediate
-- pools (wrong for an honest single-pool sell-sim) and the mixed-route quoter is
-- a v2+v3 hybrid. If the Pancake sell-sim is ever wired (KNOWN-PROBLEMS E1), the
-- correct primitives are the existing single-pool SwapRouter/QuoterV2, not these.
--
-- PancakeInterfaceMulticall is Pancake's own frontend multicall helper; it is
-- redundant with canonical Multicall3 (0xcA11…CA11), which already batches reads
-- to every contract on the chain, Pancake pools included. Seeded for labelling
-- only — do NOT route batches through it.

alter table public.trusted_address drop constraint if exists trusted_address_category_check;
alter table public.trusted_address add constraint trusted_address_category_check
  check (category in (
    'dex-factory', 'dex-router', 'dex-quoter', 'dex-position-manager',
    'dex-pool-manager', 'dex-state-view', 'permit2', 'lp-locker',
    'burn-address', 'infra-asset', 'rwa-beacon', 'rwa-impl', 'rwa-factory',
    'rwa-vault', 'rwa-operator', 'bridge-system-owner', 'trusted-proxy',
    'dex-infra'
  ));

insert into public.trusted_address
  (address, chain_id, category, subtype, label, dex_id, metadata, enabled, verify_status, verified_at, created_by)
values
  ('0x41ff9aa7e16b8b1a8a8dc4f0efacd93d02d071c9', 4663, 'dex-infra', 'pool-deployer', 'Pancake V3 PoolDeployer', 'pancakeswap', '{"protocol":"v3"}'::jsonb, true, 'ok', now(), 'migration-0034'),
  ('0x2b792b99ae08483d45d79833408439674c6daf1b', 4663, 'dex-infra', 'mixed-route-quoter', 'Pancake MixedRouteQuoterV1', 'pancakeswap', '{"protocol":"mixed"}'::jsonb, true, 'ok', now(), 'migration-0034'),
  ('0xbc203d7f83677c7ed3f7acec959963e7f4ecc5c2', 4663, 'dex-infra', 'migrator', 'Pancake V3 Migrator', 'pancakeswap', '{"protocol":"v3"}'::jsonb, true, 'ok', now(), 'migration-0034'),
  ('0x9a489505a00ce272eaa5e07dba6491314cae3796', 4663, 'dex-infra', 'tick-lens', 'Pancake V3 TickLens', 'pancakeswap', '{"protocol":"v3"}'::jsonb, true, 'ok', now(), 'migration-0034'),
  ('0x13f4ea83d0bd40e75c8222255bc855a974568dd4', 4663, 'dex-infra', 'smart-router', 'Pancake SmartRouter', 'pancakeswap', '{"protocol":"multi","routes":"v2+v3+stable"}'::jsonb, true, 'ok', now(), 'migration-0034'),
  ('0xcf05fc31a6b693dd0beb76e958ae4bcd490dc985', 4663, 'dex-infra', 'interface-multicall', 'Pancake InterfaceMulticall', 'pancakeswap', '{"note":"redundant-with-multicall3"}'::jsonb, true, 'ok', now(), 'migration-0034')
on conflict (address, chain_id) do update set
  category = excluded.category, subtype = excluded.subtype, label = excluded.label,
  dex_id = excluded.dex_id, metadata = excluded.metadata, enabled = excluded.enabled,
  verify_status = excluded.verify_status, verified_at = excluded.verified_at,
  created_by = excluded.created_by;
