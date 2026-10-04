-- Register the "Up" Slipstream (CL) deployment: factory, position manager, voter.
--
-- KNOWN-PROBLEMS L10. Every `up-v3` pool on this chain is an uncovered venue:
-- 21 of 104 published lp_custody rows named a deepest pool this scan could not
-- read, and every one with a 20-byte address is a CLPool. The worst row was
-- verdict #80, `86 CLEAR` over 4.3% of the token's liquidity.
--
-- Slipstream is the Aerodrome/Velodrome concentrated-liquidity family. It is
-- NOT Uniswap V3, and the two differences are the whole reason this venue was
-- unreadable rather than merely unregistered:
--
--   1. The factory keys pools on tickSpacing, not fee. getPool(address,address,
--      int24). Sweeping fee tiers returns zero pools and no error.
--   2. A position staked into a gauge has the GAUGE as its ownerOf, so custody
--      must look THROUGH it (lib/dex/slipstream.ts). Hence the voter row: it is
--      what proves an address is a real gauge rather than any contract, and
--      without it every staked position resolves to "faulted", which costs
--      coverage instead of naming the gauge as the whale.
--
-- ── Chain-verified 2026-08-18, every row round-tripped, nothing asserted ────
--
--   factory 0x1ac9db4a…b7f3   4,917 bytes
--     poolImplementation() = 0x11725976bf1f38c4ab78d1f480bc5883d70d9dc3
--     tickSpacings()       = [1,50,100,200,2000,10,60]   <- SEVEN, and the
--       hand-written list in the adapter's first draft had five. The two it
--       missed (10, 60) were pools we would never have looked for, reported as
--       a clean "no pools at this venue" (§8 #11). The set is now READ from the
--       factory and the fallback clears `complete`.
--     allPoolsLength()     = 991
--
--   npm 0x07f44c47…dcef   24,501 bytes   symbol "UP-POS"
--     factory() = 0x1ac9db4a…b7f3, so the position manager binds to THIS
--     factory rather than being assumed to.
--
--   voter 0x7f749fdd…32a7   24,489 bytes
--     isGauge(0x889d370c…66a7)  = true
--     gauge.voter()             = 0x7f749fdd…32a7   (round-trips back)
--     gauge.nft()               = 0x07f44c47…dcef   (binds the same NPM)
--
--   Pool identity, all three CLPools named in published verdicts:
--     each is an EIP-1167 clone of poolImplementation(), and
--     getPool(token0, token1, tickSpacing) returns the pool itself, while
--     getPool(token0, token1, fee) returns the zero address — trap 1, measured.
--
-- ── What this migration does NOT claim ──────────────────────────────────────
--
--   No row here is an lp-locker. These are venue infrastructure: they let the
--   scanner READ the venue. In particular the gauge 0x889d370c…66a7 is NOT
--   registered as trusted — it is a wrapper to look through, and registering it
--   would convert a false accusation into a false all-clear over the 99.9% of
--   pool 0x23d641fe…c4ba that is staked (§8 #13/#14).
--
--   The implementation is only PARTIALLY verified on the explorer
--   (is_verified true, is_fully_verified false), which has licensed a false
--   all-clear here before. Nothing in the reader trusts that: a pool is
--   accepted only when its EIP-1167 target equals the factory's own
--   poolImplementation(), so the proof is structural, not the explorer's word.

insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3',
  4663,
  'dex-factory',
  'cl',
  'Up Slipstream CL Factory',
  'up',
  '{"protocol":"cl","family":"slipstream","contractName":"CLFactory","poolImplementation":"0x11725976bf1f38c4ab78d1f480bc5883d70d9dc3","poolKeyedOn":"tickSpacing","tickSpacings":[1,10,50,60,100,200,2000],"allPoolsLength":991,"runtimeBytes":4917,"verifiedAt":"2026-08-18"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0058'
),
(
  '0x07f44c47743a2f36414a82b9f558ecfcf0eedcef',
  4663,
  'dex-position-manager',
  'cl',
  'Up Position NFT (UP-POS)',
  'up',
  '{"protocol":"cl","family":"slipstream","symbol":"UP-POS","factory":"0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3","runtimeBytes":24501,"verifiedAt":"2026-08-18"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0058'
),
(
  '0x7f749fdd351c1ceed82d76d7699cb631eb8332a7',
  4663,
  'dex-infra',
  'cl-voter',
  'Up Slipstream Voter',
  'up',
  '{"protocol":"cl","family":"slipstream","role":"voter","contractName":"Voter","provesGauges":true,"runtimeBytes":24489,"verifiedAt":"2026-08-18"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0058'
)
on conflict (address, chain_id) do update set
  category      = excluded.category,
  subtype       = excluded.subtype,
  label         = excluded.label,
  dex_id        = excluded.dex_id,
  metadata      = excluded.metadata,
  enabled       = true,
  verify_status = 'ok',
  verified_at   = now();
