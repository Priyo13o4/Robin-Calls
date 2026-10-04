-- 0088 — let the factory-event indexer walk the Slipstream/CL factory
--
-- `factory_cursor.protocol` was pinned to the two Uniswap AMM shapes, so the
-- only venue the indexer could not bookmark was the one venue it did not cover.
-- That gap is what kept `poolAppearanceSweep` alive as a "backstop":
-- measured on prod 2026-09-06 that sweep spent 289,552 physical RPC calls a day
-- (83.9% of the entire curve poll) re-asking every DEX factory "does this token
-- have a pool yet?", and produced SIX graduations in eight days — every one of
-- which `launch_candidates.pool_address` already held, from these same events,
-- at zero RPC (9/9 pool addresses identical over the last 10 days).
--
-- Up's CL factory (0x1ac9db4a…) emits the standard
--   PoolCreated(address indexed token0, address indexed token1,
--               int24 indexed tickSpacing, address pool)
-- topic0 0xab0d57f0…, verified on chain. It produced 3 logs in 200,000 blocks,
-- so indexing it costs about one getLogs per tracker tick.
--
-- 'slipstream-cl' matches PoolRef.protocol, the name the rest of the codebase
-- already uses for this venue — NOT a new spelling.
alter table "factory_cursor" drop constraint if exists "factory_cursor_protocol_check";
alter table "factory_cursor" add constraint "factory_cursor_protocol_check"
  check (protocol = any (array['uniswap-v2'::text, 'uniswap-v3'::text, 'slipstream-cl'::text]));
