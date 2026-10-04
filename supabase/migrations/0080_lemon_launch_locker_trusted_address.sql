-- 0080 — L94: LemonLaunchLocker in trusted_address
--
-- 0xC10309Cf…6903 holds 51.6% of LEMON.FUN's V3 pool and was published twice
-- (#214, #218, both 1.39) as "not a trusted locker, so this liquidity is not
-- considered locked" — a −9 WARN. The whale audit returned INCONCLUSIVE with
-- `unclassified-mutating-surface`, which was OUR recognition gap, not a fact
-- about the contract (§8 #16). Blockscout has it FULLY verified, exact match.
--
-- Audited on chain 2026-09-03 against the bar the `LpLockerV3` row states in
-- its own `earnsLpLockerRowWhen`, because this row grants a permanent
-- all-clear and sibling trust does not transfer:
--
--   · dispatcher census — 25 entries, EXACTLY the 25 declared ABI functions,
--     zero undeclared. (Method: PUSH4 followed by EQ = a dispatch comparison;
--     every other PUSH4 sits in a function body.)
--   · `decreaseLiquidity` (0x0c49ccbe) does not appear ANYWHERE in the 5,416
--     bytes — the NPM principal can never be reduced.
--   · no NFT egress at all: `transferFrom`, `safeTransferFrom`, `approve`,
--     `setApprovalForAll`, `burn` are absent from the whole bytecode. The
--     position arrives via onERC721Received and has no path out.
--   · only outbound calls are NPM `collect` (0xfc6f7865) and ERC20 `transfer`
--     — fee payout, matching `collectFees(address)`. Fees only.
--   · zero DELEGATECALL / CALLCODE / SELFDESTRUCT / CREATE / CREATE2, so the
--     no-upgrade-path claim does NOT rest on blockscout's `proxy_type`.
--   · positionManager round-trip: holds 511 positions on Uniswap V3 NPM
--     0x73991a25c818bf1f1128deaab1492d45638de0d3, the same NPM the existing
--     trusted V3 locker rows name.
--   · `factory()` = 0x2ba793fd…46db, which is exactly the address our own
--     lp_custody evidence records as LEMON.FUN's deployer. Coherent.
--
-- Owner surface is fee plumbing only (setFeeCollector / setFeeRedirect /
-- setProtocolFeeRecipient / setProtocolFeeShare, capped by
-- MAX_PROTOCOL_FEE_SHARE = 50, currently 30). An owner can redirect FEES; it
-- cannot reach principal. That is why `feesOnly` is true and the label says so.
--
-- L66 — carries its codehash, so the day this bytecode changes the row can
-- notice (L65's re-verify job reads it).
insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0xc10309cf03bc81c121a8270e3a28e159a9296903',
  4663,
  'lp-locker',
  'permanent',
  'Lemon Launch Locker',
  null,
  '{"role":"lp-locker","contractName":"LemonLaunchLocker","protocol":"v3","launchpad":"lemon","feesOnly":true,"withdrawPath":"none","sourceMatch":"full","upgradeable":false,"delegatecall":false,"grantsLockedCredit":true,"auditedAt":"2026-09-03","codehash":"0x22211f2d836a45a0f6636dc127e2581f027128f401f37e0add32fb2532bb7d39","codehashVerifiedAt":"2026-09-03","runtimeCodeBytes":5416,"dispatchCensus":"25/25 declared, 0 undeclared","decreaseLiquidityAbsent":true,"nftEgressAbsent":true,"positionsHeld":511,"positionManager":"0x73991a25c818bf1f1128deaab1492d45638de0d3","factory":"0x2ba793fd69bf251fd1af90b576be8b9fa6be46db","owner":"0xef2c099803fff879443009722aa2b9c46e020ab6","ownerSurface":"fee-plumbing-only","maxProtocolFeeShare":50}'::jsonb,
  true, 'ok', now(), 'migration-0080'
)
on conflict (address, chain_id) do update
  set category = excluded.category,
      subtype = excluded.subtype,
      label = excluded.label,
      metadata = excluded.metadata,
      enabled = excluded.enabled,
      verify_status = excluded.verify_status,
      verified_at = now(),
      updated_at = now();
