-- Register the trusted permanent LP lockers (KNOWN-PROBLEMS L-c).
--
-- Two rows: PonsLaunchLocker (2026-08-04) and HoodBurnLocker (2026-08-06).
-- Each one carries its own L1 audit below; a locker is blessed individually or
-- not at all.
--
-- Before this migration `trusted_address` held exactly ONE `lp-locker` row
-- (StoxesFun V3 Locker) on a chain with three enabled launchpads. Every other
-- launchpad's locker was therefore invisible to `lib/config/lockers.ts`, which
-- means `exemptOwners()` did not exempt it and `decideCustodyState` could not
-- count its stake toward `lockedPct`. An unregistered locker holding a
-- controlling share reads to the engine as an unidentified contract — the
-- §15.10 WARN path — so the registry gap does not merely lose a safety fact,
-- it manufactures an accusation against liquidity that provably cannot move.
--
-- Audited on L1 2026-08-04 against the three tests a locker must pass before it
-- is blessed. All three are load-bearing; see the SnuggleVault note below for
-- what happens when a candidate passes only the first.
--
--   1. VERIFIED SOURCE. `PonsLaunchLocker`, solc v0.8.30, verified on
--      Blockscout. An unverified contract can never be registered: "we cannot
--      read it" is not "it is safe" (CLAUDE.md §4).
--
--   2. NOT UPGRADEABLE. No proxy, no implementation slot — the bytecode that
--      was audited is the bytecode that will run. A locker behind a proxy is a
--      promise its admin can revoke, so it can never be `permanent`.
--
--   3. NO EXIT PATH FOR THE PRINCIPAL. The contract's only calls against the
--      position manager are `ownerOf` (a view) and `collect` (fees). The
--      interface it is compiled against (`INonfungiblePositionManagerLike`)
--      does not even DECLARE `transferFrom`, `safeTransferFrom` or
--      `decreaseLiquidity`, so there is no ABI through which a position could
--      leave or shrink — not for a user, not for the owner. Its own NatSpec
--      states the intent: it exposes no position withdrawal or arbitrary-call
--      function. Owner powers (`setFeeRedirect`, `setProtocolFeeRecipient`,
--      `setProtocolFeeShare`, capped by `MAX_PROTOCOL_FEE_SHARE = 50`) route
--      FEES only and cannot touch principal.
--
-- Provenance confirmed on chain rather than by name: `factory()` returns
-- 0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb, which is exactly the
-- `PonsLaunchFactory` address in `public.launchpads` for slug 'pons'. This is
-- Method C step 5 in the contract-tracing skill — a contract that merely calls
-- itself a locker proves nothing.
--
-- `subtype = 'permanent'` is read by `primeTrustedLockers()`
-- (`subtype?.includes("permanent")`) and drives `lockerPhrase()` in
-- lib/scanner/checks.ts, which will publish "the lock is permanent — that
-- liquidity can never be withdrawn, only its trading fees collected". Test 3
-- above is what makes that sentence true; do not set 'permanent' on any
-- contract that has not passed it.
--
-- `dex_id` is null on purpose: lockers are protocol-neutral (lib/config/
-- lockers.ts — "a locker is a locker whichever pool it holds"), unlike the
-- dex-* rows whose `role()` lookup keys on dex_id + protocol.
--
-- DELIBERATELY NOT REGISTERED, recorded here so the next audit does not repeat
-- the work: 0x1195c074f898b7644ba732407619c9804dfe6dce, the largest
-- unregistered holder across the two affected tokens (≥22% of one pool). It is
-- a TransparentUpgradeableProxy over `SnuggleVaultUpgradeable` and it is NOT a
-- locker — it is a yield vault. It fails tests 2 and 3: the implementation is
-- swappable, `withdraw(tokenId, returnNFT)` is callable by the depositor after
-- `MIN_POSITION_HOLD_TIME = 1 minutes` and calls `decreaseLiquidity` to send
-- the principal out, and `rescueERC721` lets `onlyAdminSatellite` move a
-- position NFT to an arbitrary address. Registering it would have exempted a
-- withdrawable stake from the whale scan AND published "can never be
-- withdrawn" over liquidity that can leave in sixty seconds — converting a
-- true WARN into a false all-clear. The existing WARN naming that address is
-- CORRECT and must not be suppressed.
--
-- ── HoodBurnLocker, audited on L1 2026-08-06 ────────────────────────────────
--
-- 0xad69d8a00564f4a2365cc74594925f95281706aa, hood.fun's locker for migrated
-- coins. Same three tests, and it passes each one in a stronger form than Pons.
--
--   1. VERIFIED SOURCE — and *fully*, which is now a distinction we can make.
--      Blockscout reports is_verified=true, is_fully_verified=true,
--      is_partially_verified=FALSE, is_verified_via_eth_bytecode_db=FALSE,
--      solc v0.8.28. A full match means the metadata hash agrees, so the
--      deployed bytecode is provably this source rather than source found at
--      some other address that happened to compile to the same code. A partial
--      match would not have been enough to bless anything.
--
--   2. NOT UPGRADEABLE — proven from the deployed bytecode, not just the
--      source. No proxy_type, no implementations, and a PUSH-aware opcode walk
--      over all 3,583 bytes finds NO DELEGATECALL. `nfpm` and `WETH` are
--      `immutable`. There is also no owner and no admin at all: the contract
--      declares no ownership, so unlike Pons there are no owner powers to
--      bound.
--
--   3. NO EXIT PATH FOR THE PRINCIPAL — the interface it compiles against,
--      `ILockerPositionManager`, declares exactly two functions: `collect`
--      (fees) and `positions` (a view). `transferFrom`, `safeTransferFrom`,
--      `decreaseLiquidity`, `burn`, `approve` and `setApprovalForAll` are not
--      merely unused, they are not in the ABI the locker can call. There is no
--      rescue function, no arbitrary-call function and nobody to authorise one.
--      `collectRewards` is permissionless and splits the exact collected
--      amounts — WETH side to creator/protocol at a share fixed at lock time,
--      launch-token side 80% burned to 0x…dEaD — so no caller can redirect it
--      and no fee path touches principal.
--
-- Provenance confirmed on chain rather than by name, the same rule Pons was
-- held to. Pons could be tied to its launchpad through `factory()`; this
-- contract has no factory, so the equivalent evidence is:
--   * `nfpm()` returns 0x73991a25c818bf1f1128deaab1492d45638de0d3, which is
--     already the registered `dex-position-manager` row for Uniswap V3, and
--     `WETH()` returns the registered `infra-asset` row. It locks positions on
--     a venue this scanner already knows, not on an NFT of its own invention.
--   * It holds **19 live V3 positions** at the 1% fee tier, every one paired
--     against WETH — matching the NatSpec's "1% pool fee" exactly. Those 19
--     tokens are the population this row is about.
--
-- NOTE ON THE PROD ROW. This address is ALREADY in production's
-- `trusted_address` (added by hand at /admin/lockers) with
-- subtype 'hood.fun permanent'. That value works — `primeTrustedLockers()`
-- tests `subtype?.includes("permanent")` — and this migration normalises it to
-- 'permanent' so all three locker rows agree, moving the launchpad into
-- `metadata` where the other rows keep it. Behaviour is unchanged either way.
--
-- It was ALSO inert. `primeTrustedLockers()` had no caller until the L3 fix, so
-- `trustedLockerMap()` was empty on every scan and the row could not be read —
-- which is why 0x72081adc…600d, one of the 19, still carries a WARN from
-- 2026-07-26 whose evidence names this locker as an unidentified holder. The
-- row is necessary and was never sufficient; see KNOWN-PROBLEMS L3.
--
-- Idempotent: ON CONFLICT (address, chain_id) re-enables and re-labels, so this
-- also repairs a half-saved row from an /admin/lockers attempt.

insert into public.trusted_address
  (address, chain_id, category, subtype, label, dex_id, metadata, enabled, verify_status, verified_at, created_by)
values
  (
    '0x736d76699c26d0d966744cae304c000d471f7f35',
    4663,
    'lp-locker',
    'permanent',
    'Pons Launch Locker',
    null,
    '{"launchpad":"pons","factory":"0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb","contractName":"PonsLaunchLocker","upgradeable":false,"withdrawPath":"none","feesOnly":true,"auditedAt":"2026-08-04"}'::jsonb,
    true,
    'ok',
    now(),
    'migration-0048'
  ),
  (
    '0xad69d8a00564f4a2365cc74594925f95281706aa',
    4663,
    'lp-locker',
    'permanent',
    'Hood Burn Locker',
    null,
    '{"launchpad":"hood.fun","positionManager":"0x73991a25c818bf1f1128deaab1492d45638de0d3","contractName":"HoodBurnLocker","upgradeable":false,"delegatecall":false,"ownerless":true,"withdrawPath":"none","feesOnly":true,"sourceMatch":"full","positionsHeld":19,"auditedAt":"2026-08-06"}'::jsonb,
    true,
    'ok',
    now(),
    'migration-0048'
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
