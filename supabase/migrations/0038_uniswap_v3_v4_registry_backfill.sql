-- Backfill the Uniswap V3 + V4-periphery rows that migration 0027 dropped.
--
-- 0027 seeded the DB trusted_address registry as a SUBSET of lib/config/
-- trusted-addresses.ts `envSeed()`: it shipped the Uniswap V2 factory/router,
-- V3 quoter, and V4 PoolManager, but omitted the Uniswap **V3 factory**, V3
-- position manager, V3 SwapRouter, and the V4 StateView/Quoter/PositionManager.
--
-- In production the DB wins (the cache primes from trusted_address; env is only
-- a fallback), so `role("uniswap","dex-factory","v3")` resolved to null,
-- `uniswap.v3` was null, and `v3Factories()` never included Uniswap. Result:
-- discoverCustodyPools NEVER queried the Uniswap V3 factory, so every token
-- whose deepest pool is a Uniswap V3 pool (CashCat 0x020bfc…, Swole Doge
-- 0xdb8739…, and others) had that pool made invisible to custody + materiality.
-- The V4 singleton's aggregate token balance then falsely headlined as
-- "100% of pooled liquidity". SushiSwap/PancakeSwap V3 were unaffected (their
-- factory rows were present); the primary honeypot sim was unaffected (it reads
-- the env SWAP_ROUTER_ADDRESS, not the registry).
--
-- All six addresses are chain-4663 verified: the V3 factory answers getPool for
-- CashCat's four fee tiers, and the V3 PositionManager and SwapRouter both
-- return .factory() == 0x1f7d7550…. metadata.protocol is set so role() matches
-- on metadata as well as the "V3"/"V4" label token (belt and suspenders).
--
-- Idempotent: ON CONFLICT (address, chain_id) re-enables and re-labels, so this
-- also repairs any half-saved rows from an admin-console attempt.

insert into public.trusted_address
  (address, chain_id, category, subtype, label, dex_id, metadata, enabled, verify_status, verified_at, created_by)
values
  ('0x1f7d7550b1b028f7571e69a784071f0205fd2efa', 4663, 'dex-factory',          null, 'Uniswap V3 factory',          'uniswap', '{"protocol":"v3"}'::jsonb, true, 'ok', now(), 'migration-0038'),
  ('0x73991a25c818bf1f1128deaab1492d45638de0d3', 4663, 'dex-position-manager', null, 'Uniswap V3 position manager', 'uniswap', '{"protocol":"v3"}'::jsonb, true, 'ok', now(), 'migration-0038'),
  ('0xcaf681a66d020601342297493863e78c959e5cb2', 4663, 'dex-router',           null, 'Uniswap V3 SwapRouter',       'uniswap', '{"protocol":"v3"}'::jsonb, true, 'ok', now(), 'migration-0038'),
  ('0xf3334192d15450cdd385c8b70e03f9a6bd9e673b', 4663, 'dex-state-view',       null, 'Uniswap V4 state view',       'uniswap', '{"protocol":"v4"}'::jsonb, true, 'ok', now(), 'migration-0038'),
  ('0x8dc178efb8111bb0973dd9d722ebeff267c98f94', 4663, 'dex-quoter',           null, 'Uniswap V4 quoter',           'uniswap', '{"protocol":"v4"}'::jsonb, true, 'ok', now(), 'migration-0038'),
  ('0x58daec3116aae6d93017baaea7749052e8a04fa7', 4663, 'dex-position-manager', null, 'Uniswap V4 position manager', 'uniswap', '{"protocol":"v4"}'::jsonb, true, 'ok', now(), 'migration-0038')
on conflict (address, chain_id) do update set
  category      = excluded.category,
  label         = excluded.label,
  dex_id        = excluded.dex_id,
  metadata      = excluded.metadata,
  enabled       = true,
  verify_status = 'ok',
  verified_at   = now();
