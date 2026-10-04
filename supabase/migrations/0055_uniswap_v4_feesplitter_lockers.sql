-- Register the two Uniswap v4 FeeSplitter deployments as permanent LP lockers.
--
-- 0xeff166aaf189323c58dc27ed1206eb2c37faacdf  (31,954 positions held)
-- 0x222d6d4f1ce59b0d48d5505114ec8addc90a4359  ( 1,451 positions held)
--
-- Traced 2026-08-12 against prod verdict #60 (MOMO,
-- 0xe37e4a8b…43ac), which published lp_custody WARN / -9:
--
--   "The largest liquidity provider — 0xeff166aa…, a contract, NOT the
--    deployer — holds 100.0% of the liquidity holding up the price. This
--    contract is not a trusted locker … Its controller or contract logic may
--    still transfer or withdraw it."
--
-- Every number in that sentence is exact (see the L1 walk below, delta 0).
-- The contract has no controller and no withdrawal path. This is 0053's
-- failure shape one venue over: a correct measurement attached to a capability
-- that was never established. Full write-up:
-- docs/ways-of-work/plan/lp-custody/DEPLOYER-IDENTITY-HANDOFF.md
--
-- ── L1: the measurement was right ───────────────────────────────────────────
--
--   Method E adapted to v4 — position keys enumerated from ModifyLiquidity
--   logs, each read back from PoolManager state via extsload (POOLS_SLOT 6,
--   liquidity +3, positions +6), deliberately NOT through lib/dex/v4-custody.ts.
--
--   pool 0x724c52d2…3a27, 4 position keys ever opened:
--     sum(all)      = 84584844928938343804781 = the receipt's activeLiquidity
--     sum(in-range) = 84570415523238214394657 = getLiquidity(poolId), DELTA 0
--     tokenId 614101 = 84570415523238214394657 = the receipt's largestPuller
--     share 99.9829% vs published pctOfPool 0.9998
--
-- ── 0048's three tests, plus 0053's fourth ──────────────────────────────────
--
--   1. SOURCE. Uniswap Labs' src/periphery/FeeSplitter.sol, solc 0.8.26,
--      external_libraries []. PARTIAL match (is_fully_verified false,
--      is_changed_bytecode false) — weaker than 0053's full match, so every
--      test below was run against the DEPLOYED RUNTIME rather than the source
--      text, and the source is used only to name what the bytecode shows.
--
--   2. NOT UPGRADEABLE. proxy_type null, implementations []. PUSH-data-aware
--      opcode walk over the 7,260-byte runtime: zero DELEGATECALL, CALLCODE,
--      SELFDESTRUCT and CREATE2. The single CREATE is solady's
--      forceSafeTransferETH helper. positionManager and poolManager are
--      immutable; _splits is written only by the constructor.
--
--   3. NO EXIT PATH FOR THE PRINCIPAL. All 8 dispatch selectors enumerated
--      from the runtime and all 8 are declared — no undeclared entry point.
--      Only two are state-changing:
--        * collectFees(uint256[]) — DECREASE_LIQUIDITY with the delta
--          HARDCODED to 0 and TAKE_PAIR to address(this), then split to the
--          immutable recipients. Fees only; the amount is not a parameter.
--        * increaseLiquidity(...) — INCREASE_LIQUIDITY only. Its
--          TAKE_PAIR-to-msg.sender returns donated residue, and the
--          _requireNoPendingFees guard is what stops it being used to sweep
--          accrued fees ahead of the split.
--      There is no owner(), no fallback, and isValidSignature reverts, so the
--      PositionManager's ERC721Permit path cannot be used to grant an approval
--      by signature either — the same 1271 hole 0053 had to close.
--
--      Confirmed empirically as well as structurally, which matters at a
--      partial match: across the pool's full log history there are exactly two
--      negative liquidityDelta events and both belong to the third-party EOA
--      0xc31bd8a6…'s positions. Position 614101 has 18 ModifyLiquidity events
--      netting to its full current liquidity — every one an add or a
--      zero-delta fee realization. Zero Approval, zero ApprovalForAll and zero
--      outbound Transfer on the PositionManager involving either splitter.
--
--   4. NOT A SCORED SUBJECT ELSEWHERE. Unlike 0053's candidate, neither
--      splitter creates tokens. MOMO's creator_address_hash is UERC20Factory
--      (0x000000e2…), a different address, so no row here can feed
--      deployer_history, funding_lineage, funder_rug_history or the Wanted
--      board.
--
--   The second address is the SAME CONTRACT: identical 7,260-byte runtime,
--   identical codehash 0x8238e5106b3a8955…, and it binds the same canonical
--   PositionManager (0x58daec31…) and PoolManager (0x8366a39c…). The proof
--   above transfers byte for byte; only the constructor's fee-split recipients
--   differ, and those decide who receives fees, never whether principal can
--   leave.
--
-- ── What this row does NOT claim ────────────────────────────────────────────
--
--   Locked LP is not a safe token. MOMO's float was 56.6% of supply at scan
--   and holder_concentration still carries its own WARN. This row removes a
--   false claim about who can pull the pool; it says nothing else.
--
-- ═══ V2LaunchLocker 0x267444d099b10fb5ed7c3cc7b7c767adca574952 ══════════════
--
--   Launchpad-v2's locker for graduated Uniswap **v4** positions (the "V2" is
--   the pad's version, not the DEX's). 79 positions held; 4 tokens on the
--   ledger. positionManager() = 0x58daec31…, the canonical v4 PositionManager.
--
--   1. SOURCE. Partial match, is_changed_bytecode false, external_libraries [].
--      The complete source is 123 lines and every external function is in it.
--   2. NOT UPGRADEABLE. proxy_type null, implementations []. Runtime opcode
--      walk over the 1,916-byte code region: zero DELEGATECALL, CALLCODE,
--      SELFDESTRUCT, CREATE2. (The single 0xff byte sits at offset 1940,
--      inside the CBOR metadata trailer — it is not an opcode. A scan that
--      does not subtract the trailer reports a SELFDESTRUCT here that does not
--      exist.) `positionManager` is immutable.
--   3. NO EXIT PATH. Dispatch census over the runtime: 11 of 11 declared
--      selectors present, ZERO undeclared entry points — so the source's
--      function set is the deployed function set. decreaseLiquidity, burn,
--      safeTransferFrom, approve and setApprovalForAll are all absent from the
--      runtime. transferFrom IS present, which is why this row was held on the
--      first pass; the complete source resolves it — its only use is
--      `IERC20(token).safeTransferFrom(msg.sender, address(this), amount)`
--      inside lockTokenSupply, i.e. INBOUND with hardcoded args. Nothing
--      leaves. The other two state-changing functions only write mappings
--      (lockPosition) or are spent (below).
--   4. NOT A SCORED SUBJECT ELSEWHERE. It creates no tokens.
--
--   The admin surface is SPENT, proven live rather than assumed
--   (lib/audit/liveness.ts doctrine — a capability is retired only when the
--   state is READ). setFactory is the ONLY onlyOwner function and is a
--   monotone one-shot: `if (factory != address(0)) revert AlreadyInitialized`,
--   and no code path ever clears `factory`. factory() reads
--   0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e, and eth_call of
--   setFactory(0x11..) FROM the owner reverts. renounceOwnership() reverts by
--   design; pendingOwner() is zero. Ownership can still be transferred, and it
--   conveys nothing — there is no second onlyOwner function to inherit.
--   Even the factory itself cannot extract: lockPosition only writes mappings
--   and requires ownerOf == this, lockTokenSupply only pulls tokens in.
--
-- ═══ FeeLockerV2 0x2f9878d39173b9711136547ac0f84555153ce230 ══════════════════
--
--   Uniswap **v3** locker on NPM 0x73991a25… (already the registered
--   dex-position-manager row). 3 positions held; 1 token on the ledger.
--
--   Partial source, complete and read. Runtime: 3,249-byte code region, zero
--   DELEGATECALL / SELFDESTRUCT. decreaseLiquidity, burn, safeTransferFrom,
--   transferFrom, approve and setApprovalForAll are ALL absent from the
--   runtime; collect((uint256,address,uint128,uint128)) is present. That is
--   the whole argument, and it is the same one 0053 made: NPM `collect` caps
--   at position.tokensOwed, which only ever receives principal inside
--   `decreaseLiquidity`, so a contract that cannot call decreaseLiquidity can
--   move fees and never principal. transfer(address,uint256) is present and
--   is the ERC20 fee payout — source-confirmed as token0/token1 to
--   creator/treasury, never an LP token (this locker holds NFTs, not v2 pair
--   tokens).
--
--   Custody read live on all three positions (639566, 617414, 599267):
--   ownerOf = this contract, getApproved = 0x0, operator = 0x0. No approval
--   exists, and no code path can create one.
--
--   setCreatorFeeRecipient is external and ungated by a modifier, which looks
--   like a hole and is not: the body requires msg.sender == pos.creator. It
--   rotates a fee recipient, never liquidity.
--
-- ── Deliberately HELD, not registered ───────────────────────────────────────
--
--   * 0x31ca5e10…54b5 (1 token, but 1,891 v3 positions held on NPM
--     0x73991a25…). Its danger-selector profile is IDENTICAL to FeeLockerV2's
--     — decreaseLiquidity, burn, transferFrom, safeTransferFrom, approve,
--     setApprovalForAll all absent; collect and transfer present; zero
--     DELEGATECALL/SELFDESTRUCT over 4,808 bytes — and its ERC-20 balances are
--     fee dust across many tokens, not LP. But the bytecode is UNVERIFIED, so
--     a selector built dynamically (from storage or calldata) would never
--     appear as a PUSH4 literal and my census would not see it. Every other
--     row here rests on a source that closes that gap. Granting LOCKED credit
--     is an absolute all-clear, so the unverified one waits. Closing it needs
--     either source verification or an empirical sweep proving no
--     DecreaseLiquidity has ever fired for a position it holds.
--
--   And one must NEVER be registered: 0x0eea30ab…dfd8 at 56.9% is a Gnosis
--   SafeProxy — UP's team multisig, already identified in the contract-tracing
--   skill's Method G walk. It is a real concentration finding, not a locker.
--
-- ── Note for whoever adds the next one ──────────────────────────────────────
--
--   /admin/trusted CANNOT add a working locker. Its save writes
--   verify_status = probe.status, and verifyTrustedAddress has no lp-locker
--   branch, so the row lands 'unprobeable' — which primeTrustedLockers()
--   filters out (lib/config/lockers.ts). The Override tick permits the save
--   without changing the status. Use /admin/lockers, whose addLockerAction
--   writes verify_status = 'ok' explicitly, or a migration like this one.

insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0xeff166aaf189323c58dc27ed1206eb2c37faacdf',
  4663,
  'lp-locker',
  'permanent',
  'Uniswap v4 FeeSplitter',
  'uniswap',
  '{"protocol":"v4","contractName":"FeeSplitter","positionManager":"0x58daec3116aae6d93017baaea7749052e8a04fa7","poolManager":"0x8366a39cc670b4001a1121b8f6a443a643e40951","upgradeable":false,"delegatecall":false,"withdrawPath":"none","feesOnly":true,"sourceMatch":"partial","runtimeBytes":7260,"codehash":"0x8238e5106b3a8955","positionsHeld":31954,"alsoTokenCreator":false,"auditedAt":"2026-08-12","tracedVerdict":60}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0055'
),
(
  '0x222d6d4f1ce59b0d48d5505114ec8addc90a4359',
  4663,
  'lp-locker',
  'permanent',
  'Uniswap v4 FeeSplitter (2)',
  'uniswap',
  '{"protocol":"v4","contractName":"FeeSplitter","positionManager":"0x58daec3116aae6d93017baaea7749052e8a04fa7","poolManager":"0x8366a39cc670b4001a1121b8f6a443a643e40951","upgradeable":false,"delegatecall":false,"withdrawPath":"none","feesOnly":true,"sourceMatch":"bytecode-identical-to-0xeff166aaf189323c58dc27ed1206eb2c37faacdf","runtimeBytes":7260,"codehash":"0x8238e5106b3a8955","positionsHeld":1451,"alsoTokenCreator":false,"auditedAt":"2026-08-12"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0055'
),
(
  '0x267444d099b10fb5ed7c3cc7b7c767adca574952',
  4663,
  'lp-locker',
  'permanent',
  'Launchpad V2 Launch Locker',
  'uniswap',
  '{"protocol":"v4","contractName":"V2LaunchLocker","positionManager":"0x58daec3116aae6d93017baaea7749052e8a04fa7","upgradeable":false,"delegatecall":false,"withdrawPath":"none","transferFromIsInboundOnly":true,"adminSurface":"spent","factory":"0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e","owner":"0xfdde5a1e3cdf791da71e49f817d70c7ced72cc36","sourceMatch":"partial","dispatchCensus":"11/11 declared, 0 undeclared","runtimeCodeBytes":1916,"positionsHeld":79,"alsoTokenCreator":false,"auditedAt":"2026-08-12"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0055'
),
(
  '0x2f9878d39173b9711136547ac0f84555153ce230',
  4663,
  'lp-locker',
  'permanent',
  'FeeLockerV2',
  'uniswap',
  '{"protocol":"v3","contractName":"FeeLockerV2","positionManager":"0x73991a25c818bf1f1128deaab1492d45638de0d3","upgradeable":false,"delegatecall":false,"withdrawPath":"none","feesOnly":true,"decreaseLiquidityAbsent":true,"approvalsOnHeldPositions":"none","sourceMatch":"partial","runtimeCodeBytes":3249,"positionsHeld":3,"alsoTokenCreator":false,"auditedAt":"2026-08-12"}'::jsonb,
  true,
  'ok',
  now(),
  'migration-0055'
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

-- Close the two stale rows that named already-registered lockers. Both were
-- written before 0048/0053 landed (last seen 2026-08-01 and 2026-07-26), and
-- the queue has no auto-close on registration — their summaries still read
-- "isn't on the trusted-locker list", which is now false.
update scan_uncertainties
set reviewed_at = now(),
    reviewed_by = 'migration-0055',
    resolution  = 'Registered as a trusted lp-locker; row predates the registration.'
where reviewed_at is null
  and code = 'contract-custodian-unclassified'
  and subject in (
    '0x736d76699c26d0d966744cae304c000d471f7f35',
    '0xad69d8a00564f4a2365cc74594925f95281706aa',
    '0xeff166aaf189323c58dc27ed1206eb2c37faacdf',
    '0x222d6d4f1ce59b0d48d5505114ec8addc90a4359',
    '0x267444d099b10fb5ed7c3cc7b7c767adca574952',
    '0x2f9878d39173b9711136547ac0f84555153ce230'
  );
