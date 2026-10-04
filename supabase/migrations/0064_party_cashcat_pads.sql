-- Party and CashCat: the last two live launchpads nobody indexed.
--
-- Both are DIRECT launchers, not bonding curves. A token is deployed straight
-- into a DEX pool and is tradeable from its first block, so there is no raise,
-- no progress and nothing to put in the Bonding tab. They earn a row for ONE
-- reason: `creator_address`. It is the only input that can make a launch origin
-- `attributable: true` (lib/scanner/launch-origin.ts), so without a row every
-- token from these pads falls back to the creation-tx sender and stays
-- unattributable — the withheld points in L25.
--
-- LAUNCH RATES, measured on chain 2026-08-23 over 360,000 blocks (~10h):
--   Party    0x626c3d09…   2 launches  (~5/day)   -> SushiSwap V3, LP in PartyLocker
--   CashCat  0x5bd1fbe7…   4 launches  (~10/day)  -> Uniswap V4 + hook
-- The ecosystem map's "395 logs/day" and "285 logs/day" count EVERY event these
-- factories emit. Do not size anything off those numbers.
--
-- venue_model = DEX_RESTRICTED, which is what routes them through
-- `fakeBondClearsTractionGate` rather than promoting unconditionally. That
-- distinction is not cosmetic: promoting a direct-launch pad unconditionally is
-- what produced the 43,908-row pons flood (§5.1b).
--
-- `config` is left EMPTY on both. Neither front end has been verified, and
-- since migration 0063 removed `launchpadUrl`'s `https://${slug}` fallback an
-- empty config costs a link rather than producing a broken one (L32). Fill them
-- in when someone confirms the URLs.
--
-- ENABLED, both: they are live, the adapters are built against fully-verified
-- ABIs, and every token they index gains an attributable creator.

alter table launchpads drop constraint if exists launchpads_adapter_check;
alter table launchpads add constraint launchpads_adapter_check
  check (adapter = any (array[
    'curve-events-v1'::text, 'flap-v1'::text, 'pons-v1'::text, 'pons-v2'::text,
    'stonk-v1'::text, 'stoxes-v1'::text, 'party-v1'::text, 'cashcat-v1'::text
  ]));

insert into launchpads (slug, name, curve_address, adapter, venue_model, enabled, config, notes)
values
  ('party', 'Party', '0x626c3d09b65bf5d1d40e0d5f25e19fa49783b3d4', 'party-v1', 'DEX_RESTRICTED', true, '{}'::jsonb,
   'PartyFactory. DIRECT SushiSwap V3 launcher — no bonding curve, no raise; tokens trade from block 0 and the LP sits in PartyLocker. Indexed for creator attribution (L25), not for the Bonding tab. ~5 launches/day measured 2026-08-23. TokenLaunched carries pool + creator + metadataUri.'),
  ('cashcat', 'CashCat', '0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661', 'cashcat-v1', 'DEX_RESTRICTED', true, '{}'::jsonb,
   'CashCat Factory (vNext), an ERC1967 PROXY — the launch events live in implementation 0x3dfd73a63e15920add4b6c5c6a4b1b4b768b2c1a, not in the ABI Blockscout serves at this address. DIRECT Uniswap V4 launcher: a poolId, no pool address. Two events fire per launch and only TokenLaunched carries `creator`; TokenLaunchedVNext does not, so keying on the newer-sounding name would index every launch and attribute none. ~10 launches/day measured 2026-08-23.')
on conflict (slug) do nothing;
