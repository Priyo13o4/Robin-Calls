-- Name the contracts behind CASHCAT / COCKIN / POT. IDENTITY ONLY — no row
-- here grants LOCKED credit or any other all-clear.
--
-- KNOWN-PROBLEMS L12/L13. Three scanned tokens all reported "not in the
-- registry" about contracts that are perfectly ordinary launchpad
-- infrastructure, and one of them (the CL locker) was then cleared by the
-- holder audit's own vocabulary gap.
--
-- The distinction this migration is built around: **an lp-locker row is an
-- absolute safety claim, an identity row is not.** 0055 held a locker back for
-- exactly this reason. The locker below is a much stronger case for holding
-- back than 0055's candidate was, and the reason is on chain (see below).
--
-- ═══ StonkUpLockerCL 0xc1afa59e2abc1c868c51a1f799a7578eacfea076 ════════════
--
--   Holds 60.9% of COCKIN's Slipstream CL pool — 82.98% of the token's whole
--   readable liquidity (prod verdict #108). Fully verified, is_changed_bytecode
--   false, solc 0.8.24, proxy_type null, 14,400-byte runtime.
--
--   Binds the venue registered by 0058, round-tripped rather than assumed:
--     positionManager() = 0x07f44c47…dcef   (Up NFT, 0058's row)
--     clFactory()       = 0x1ac9db4a…b7f3   (0058's factory)
--     voter()           = 0x7f749fdd…32a7   (0058's voter)
--     lockNft()         = 0x3e45e90d…422f   (registered below)
--     owner()           = 0xb668382c…7cda   (also StonkSafeLaunchpad's creator)
--
--   ── Why it is NOT registered as an lp-locker ──
--
--   Its safety is PER LOCK, not per contract. Every lock carries a caller-
--   supplied `startUnlock`/`finishUnlock` pair, and `_unlockedLiquidity`
--   releases the principal LINEARLY between them:
--
--     decreaseLockedLiquidity(lockTokenId, liquidity, …)
--       → require(liquidity <= withdrawableLiquidity(lockTokenId))
--       → NFPM.decreaseLiquidity + collect
--     releasePosition(lockTokenId)
--       → require(canRelease) → NFPM.safeTransferFrom(this, msg.sender, …)
--
--   The caller is whoever holds the lock-ownership NFT — a third party, not
--   this contract's owner. So an lp-locker row would publish "the lock is
--   permanent, so that liquidity can never be withdrawn" (kind=permanent) or
--   "it can't be pulled until the lock expires" (kind=timelock) about a lock
--   that is vesting out continuously RIGHT NOW. One contract, both sentences
--   false for some of its locks.
--
--   COCKIN's own lock happens to be permanent, and only reading it says so —
--   lockPositions(96), read 2026-08-18:
--     positionTokenId    62893
--     initialLiquidity   6116543001549805164850   <- equals verdict #108's
--                                                    largestPuller.liquidity
--     withdrawnLiquidity 0
--     startUnlock        18446744073709551614   (uint64 max - 1)
--     finishUnlock       18446744073709551615   (uint64 max)
--     closed             false      gauge  0x0 (unstaked)
--   canRelease(96) = false and withdrawableLiquidity(96) = 0, and both stay
--   that way forever at those sentinels. That is a fact about LOCK 96, and the
--   registry has no way to say so — which is the whole argument for identity
--   here and credit only once something READS the window per scan.
--
--   L13's own write-up called this a maturing timelock. It is not; it is the
--   uint64 sentinel. The correction does not change the fix — the audit still
--   cleared a contract whose ABI it could not read (`releasePosition`,
--   `decreaseLockedLiquidity` are in no selector table), and it would have
--   cleared the vesting locks identically.
--
-- ═══ StonkLockerOwnershipNFT 0x3e45e90d83d87f961561968709d5ab844eb7422f ════
--
--   Verified, 4,336 bytes. The ERC-721 whose holder is a lock's beneficiary —
--   i.e. the party `releasePosition` pays out to. Registered so a future
--   look-through has a name for "who owns this lock" instead of an address.
--
-- ═══ The three launchpad contracts ═════════════════════════════════════════
--
--   StonkSafeLaunchpad   0xeca5726d…71f9  24,456 B, partial verify
--     Created COCKIN. A bonding curve: createLaunch/buy/sell/bond/graduate.
--     Creator 0xb668382c…7cda — the locker's owner, so the pad and the locker
--     are one operator.
--   PonsV2LaunchFactory  0x7ed598bc…ec7e  24,177 B, fully verified
--     Already named in 0055 as V2LaunchLocker.factory(). Events TokenLaunched
--     + PoolGraduated.
--   PonsV2LaunchDeployer 0x3711cea4…1a42  20,906 B, fully verified
--     Created POT. Single write: deployLaunch. Same EOA creator
--     (0xfdde5a1e…cc36) as the factory above.
--
--   These rows do NOT close L12. `launchpad_provenance` and `liquidity_depth`'s
--   curve-venue SKIP both read `curve_tokens`, which is fed by the `launchpads`
--   table and its poller — and no adapter here fits: PonsV2LaunchFactory has no
--   `graduationStatus`, so the `pons-v1` preset would mis-probe it, and
--   `launchpads_adapter_check` has no name for the Stonk curve at all.
--   Registering a launchpad under a guessed adapter starts a background job
--   producing wrong data, so L12 stays open on a `pons-v2` / `stonk-v1` adapter.
--   What these rows do buy is that the review queue and the agent's
--   `get_dex_registry` stop reporting known infrastructure as unidentified.
--
-- ═══ Deliberately NOT registered ═══════════════════════════════════════════
--
--   0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb — CASHCAT's creator. A contract,
--   but UNVERIFIED on the explorer and matching no known pad shape. §9: an
--   unrecognised contract is a registry GAP until the explorer says otherwise,
--   and inventing a label for it converts a gap into a false identification.

insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0xc1afa59e2abc1c868c51a1f799a7578eacfea076',
  4663,
  'dex-infra',
  'lp-locker-per-lock',
  'Stonk Up CL Locker',
  'up',
  -- `protocol` is deliberately NOT "cl": lib/config/dex-registry.ts::clRole
  -- matches on exactly that string, and a future untagged clRole("up",
  -- "dex-infra") lookup would otherwise resolve the Up voter to this locker.
  '{"protocol":"cl-locker","family":"slipstream","contractName":"StonkUpLockerCL","role":"lp-locker-per-lock","grantsLockedCredit":false,"whyNotTrusted":"lock window is per-lock and caller-supplied; decreaseLockedLiquidity vests principal linearly between startUnlock and finishUnlock","releasePath":["releasePosition(uint256)","decreaseLockedLiquidity(uint256,uint128,uint256,uint256)"],"releaseCaller":"holder of the lock-ownership NFT","positionManager":"0x07f44c47743a2f36414a82b9f558ecfcf0eedcef","clFactory":"0x1ac9db4a2608ba45d6127b1737949b51bb54b7f3","voter":"0x7f749fdd351c1ceed82d76d7699cb631eb8332a7","lockNft":"0x3e45e90d83d87f961561968709d5ab844eb7422f","owner":"0xb668382cf44038a3e8140e789060f6a809787cda","sourceMatch":"full","runtimeBytes":14400,"writeFunctions":12,"auditedAt":"2026-08-18","tracedVerdict":108}'::jsonb,
  true, 'ok', now(), 'migration-0059'
),
(
  '0x3e45e90d83d87f961561968709d5ab844eb7422f',
  4663,
  'dex-infra',
  'lock-ownership-nft',
  'Stonk Locker Ownership NFT',
  'up',
  '{"protocol":"cl-locker","contractName":"StonkLockerOwnershipNFT","role":"lock-ownership-nft","locker":"0xc1afa59e2abc1c868c51a1f799a7578eacfea076","sourceMatch":"full","runtimeBytes":4336,"auditedAt":"2026-08-18"}'::jsonb,
  true, 'ok', now(), 'migration-0059'
),
(
  '0xeca5726dae1e53365c37ffc02369d947a91d71f9',
  4663,
  'dex-infra',
  'launchpad-curve',
  'Stonk Safe Launchpad',
  null,
  '{"role":"launchpad-curve","contractName":"StonkSafeLaunchpad","venueModel":"BONDING_CURVE","creator":"0xb668382cf44038a3e8140e789060f6a809787cda","locker":"0xc1afa59e2abc1c868c51a1f799a7578eacfea076","launchpadsRow":false,"adapterNeeded":"stonk-v1","runtimeBytes":24456,"sourceMatch":"partial","tokensSeen":["0xee3bf08b5e122b6779320c5bcda36e9f2bd42069"],"auditedAt":"2026-08-18"}'::jsonb,
  true, 'ok', now(), 'migration-0059'
),
(
  '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',
  4663,
  'dex-infra',
  'launchpad-factory',
  'Pons V2 Launch Factory',
  null,
  '{"role":"launchpad-factory","contractName":"PonsV2LaunchFactory","creator":"0xfdde5a1e3cdf791da71e49f817d70c7ced72cc36","deployer":"0x3711cea4feade896c913c68f01eda97cb06d1a42","events":["TokenLaunched","PoolGraduated"],"hasGraduationStatus":false,"launchpadsRow":false,"adapterNeeded":"pons-v2","namedInMigration":"0055","runtimeBytes":24177,"sourceMatch":"full","auditedAt":"2026-08-18"}'::jsonb,
  true, 'ok', now(), 'migration-0059'
),
(
  '0x3711cea4feade896c913c68f01eda97cb06d1a42',
  4663,
  'dex-infra',
  'launchpad-deployer',
  'Pons V2 Launch Deployer',
  null,
  '{"role":"launchpad-deployer","contractName":"PonsV2LaunchDeployer","factory":"0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e","creator":"0xfdde5a1e3cdf791da71e49f817d70c7ced72cc36","writeFunctions":["deployLaunch"],"runtimeBytes":20906,"sourceMatch":"full","tokensSeen":["0x5d4fb25c863b24602ee3602d2d193963f71846d3"],"auditedAt":"2026-08-18"}'::jsonb,
  true, 'ok', now(), 'migration-0059'
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

-- Close the review rows that asked "is this a real launchpad?" about the two
-- creators now named above. CASHCAT's 0xd9ec2db5… is left OPEN on purpose —
-- it is still unidentified, and that is what the queue is for.
update scan_uncertainties
set reviewed_at = now(),
    reviewed_by = 'migration-0059',
    resolution  = 'Identified in migration 0059 as launchpad infrastructure (identity only — no LOCKED credit, and no launchpads row: L12 still needs an adapter).'
where reviewed_at is null
  and code = 'contract-creator-holds-lp'
  and subject in (
    '0xeca5726dae1e53365c37ffc02369d947a91d71f9',
    '0x3711cea4feade896c913c68f01eda97cb06d1a42'
  );
