-- 0069 — seed the stoxes.fun launchpad row.
--
-- The adapter (lib/tracker/curves/adapters/stoxes-v1.ts, commit 0188f56) is
-- chain-verified against StoxesFunV3LaunchFactory — TokenLaunched and
-- Migrated(uint256 poolWethBalance) match byte-for-byte — but the pad could
-- never be indexed because no launchpads row existed. This seeds it
-- DISABLED: four pre-enable gaps were re-verified live on 2026-08-26 and
-- flipping enabled=true before they land ships known-silent failures:
--
--   1. The DEX_RESTRICTED market sweep is hardcoded to `adapter === "pons-v1"`
--      (lib/tracker/curves/probe.ts, lib/data/curve-live.ts). stoxes is also
--      DEX_RESTRICTED, so its tokens would stay CANDIDATE forever while the
--      pad looks wired up — the exact shape §8 #10 exists for.
--   2. Bootstrap lookback (~500k blocks) vs ~17.5M blocks of launch history:
--      most of the 174 launches would be invisible without an explicit
--      backfill decision.
--   3. Window-cap parity with flap-v1/curve-events-v1 must be confirmed on the
--      non-bootstrap branch (untracked-twin rule, §8 #8).
--   4. Stall sweep vs fill-less launches: stoxes emits few/no fills early, so
--      `last_trade_at` can stay NULL and rows die young once the stall job
--      treats NULL as stale — re-validate lib/data/curves.ts before enabling.
--
-- Risk class noted for the audit plane: stoxes launches RWA dividend tokens
-- with transfer taxes up to 10%/10% paying dividends in stock tokens. No
-- scanner check models a taxed transfer today; it interacts with the
-- honeypot sell simulation (§8 #17 family).

insert into public.launchpads (slug, name, curve_address, adapter, venue_model, config, enabled, notes)
values (
  'stoxes',
  'stoxes.fun',
  '0xf612b37d684b3eca3583121172764ab0ef8417fc',
  'stoxes-v1',
  -- DEX_RESTRICTED, not BONDING_CURVE: StoxesFunV3LaunchFactory creates the
  -- Uniswap V3 pool at launch (same family as party/cashcat in 0064). NOT NULL
  -- since 0035 with no default - omitting it is what failed the 2026-08-26 deploy.
  'DEX_RESTRICTED',
  '{}'::jsonb,
  false,
  'StoxesFunV3LaunchFactory, ABI verified byte-for-byte (commit 0188f56). 174 launches 2026-07-15..07-31, then dormant; 5afe vanity suffix. DISABLED pending 4 pre-enable gaps — see migration header.'
)
on conflict (slug) do nothing;
