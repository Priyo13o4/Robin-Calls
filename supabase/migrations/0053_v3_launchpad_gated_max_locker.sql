-- Register V3LaunchpadGatedMax as a permanent LP locker, and record the FOURTH
-- audit test this candidate forced 0048 to grow.
--
-- 0xf441cc979fa862f2674b9188a7b529cafd3ce204. Traced 2026-08-09 against ledger
-- row #28 (BLINK, 0x7b630f08…b098): the engine published "Deployer wallet
-- (0xF441cc…) controls 92.2% of the liquidity … so the deployer can pull it at
-- will" about this contract. Every number in that sentence was exact. The noun
-- was wrong, and the verb was false — there is no withdrawal path in the
-- bytecode. Full write-up:
-- docs/ways-of-work/plan/lp-custody/DEPLOYER-IDENTITY-HANDOFF.md
--
-- ── 0048's three tests ──────────────────────────────────────────────────────
--
--   1. VERIFIED SOURCE, fully. Blockscout: is_fully_verified=true,
--      is_partially_verified=false, is_changed_bytecode=false,
--      external_libraries=[]. solc 0.8.26. The deployed bytecode IS this source.
--
--   2. NOT UPGRADEABLE, proven from the deployed bytecode rather than the
--      source alone. proxy_type null, implementations []. A PUSH-data-aware
--      opcode walk over the 10,125-byte runtime finds SSTORE 26, CALL 7,
--      CREATE 1, STATICCALL 3 and **zero DELEGATECALL / CALLCODE /
--      SELFDESTRUCT / CREATE2**. `nfpm`, `weth`, `swapRouter`, `registry`,
--      `minWindow`, `maxWindow` are all immutable. `owner` is written only in
--      the constructor and there is no `transferOwnership`.
--
--   3. NO EXIT PATH FOR THE PRINCIPAL. The full ABI is 17 entries, 13 of them
--      views. The only state-changing functions are `launch`, `claim`,
--      `exemptToken` (onlyOwner) and `setTreasury` (onlyOwner). Its only NFPM
--      calls are `createAndInitializePoolIfNecessary`, `mint` and `collect` —
--      `decreaseLiquidity`, `burn`, `transferFrom`, `safeTransferFrom`,
--      `approve` and `setApprovalForAll` are absent from the call graph. There
--      is no fallback and no receive, so `ERC721Permit.permit` cannot be used
--      to grant an approval either: the NFPM requires IERC1271
--      `isValidSignature` from a contract owner and this contract has no such
--      function (all 19 of its selectors were enumerated; 0x1626ba7e is not
--      among them). `_pay`'s low-level call hardcodes selector 0xa9059cbb and
--      its target is always token0/weth from `launches[token]`, so it can never
--      be aimed at the position manager.
--
--      Confirmed empirically as well as structurally, which matters because the
--      NFPM itself is only a PARTIAL bytecode match: `claim()` has executed 3
--      times (3 FeesClaimed logs for this token) and `positions(633028).liquidity`
--      still equals the seed Mint amount to the wei. Fees moved; principal did
--      not. A full-history sweep of the NFPM finds zero Approval and zero
--      ApprovalForAll events with owner = this contract across all 829 NFTs it
--      holds, and exactly one Transfer for token 633028 (mint, 0x0 → here).
--
-- ── The fourth test, new with this candidate ────────────────────────────────
--
--   4. THE LOCKER MUST NOT ALSO BE A SCORED SUBJECT ELSEWHERE.
--
--      Pons, Hood and Stoxes are lockers and nothing else. This contract is
--      also the `creator_address_hash` of every token it launches, and
--      `launch()` is permissionless. So one address would simultaneously earn
--      LOCKED credit here and be the scored subject of deployer_history,
--      funding_lineage, funder_rug_history and the Wanted board — where its
--      dead-launch tally is the tally of every token any stranger ever launched
--      through it. Registering it as a locker without closing that path would
--      have traded a false accusation about the LP for a worse one: one rugged
--      launch turning every sibling token CRITICAL.
--
--      That path is closed in code, and this row depends on it: a CONTRACT
--      creator now SKIPs the per-deployer history checks (`deployerIsShared`,
--      lib/scanner/checks.ts), stains cannot propagate to a contract
--      (`candidateIsSafeToStain`, lib/lineage/stains.ts), and the Wanted board
--      requires a wallet-kind holder before it will call LP "controlled"
--      (`lpWasControlled`, lib/wanted/producer.ts). Do not revert those without
--      also disabling this row.
--
-- Provenance confirmed on chain, not by name, the same rule 0048 applied:
--   * `GatedMaxToken.launchpad()` on the scanned token returns this address,
--     and `launches(token).pool` returns 0x6e31e066…50daa, which is the pool
--     the verdict is about.
--   * `nfpm()` is 0x73991a25c818bf1f1128deaab1492d45638de0d3 — already the
--     registered dex-position-manager row for Uniswap V3 — and it holds 829
--     live positions on that venue.
--   * NPM.ownerOf(633028) is still this contract; the position has never moved.
--
-- Note the share this row protects DECAYS: the pad held 92.2% of in-range
-- liquidity at scan time and 70.3% a day later, with its own stake unchanged
-- (+0.21%) while the pool's active liquidity grew 31.5%. That is why custody
-- no longer gates locked credit on a 0.9 headline threshold — protected stake
-- is excluded from every danger rung at any level (lib/dex/custody.ts).

insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values (
  '0xf441cc979fa862f2674b9188a7b529cafd3ce204',
  4663,
  'lp-locker',
  'permanent',
  'V3 Launchpad GatedMax Locker',
  null,
  '{"launchpad":"v3-launchpad-gated-max","positionManager":"0x73991a25c818bf1f1128deaab1492d45638de0d3","contractName":"V3LaunchpadGatedMax","upgradeable":false,"delegatecall":false,"withdrawPath":"none","feesOnly":true,"sourceMatch":"full","positionsHeld":829,"alsoTokenCreator":true,"auditedAt":"2026-08-09"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0053'
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
