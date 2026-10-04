-- Merged before any database recorded them (2026-09-29): prod's ledger ends at 0099, the local
-- smoke DB applied these by hand and never ledgered them. Every section is idempotent, so a
-- re-run anywhere is safe. Each section keeps its original file verbatim under its old name.

-- ============================================================================
-- was 0102_lp_lockers_trusted_address.sql
-- ============================================================================
-- 0102_lp_lockers_trusted_address.sql
-- Comprehensive registration of verified LP lockers (timelocks and permanent lockers)
-- on Robinhood Chain (chain id 4663), adapter bindings for UNCX V4/V2, and explicit
-- failed/untrusted audit records for backdoored/unsafe custody contracts.
--
-- AUDIT REFERENCE: docs/audits/2026-09-27-lp-lockers-audit.md
-- KNOWN-PROBLEMS: L209
--
-- ---------------------------------------------------------------------------------
-- SECTION A: APPROVED GO LOCKERS (lp-locker / timelock or permanent)
-- ---------------------------------------------------------------------------------
-- 1. UNCX Uniswap V4 Locker: 0x128a800cbc615cc110bff16e475865c67631603a
--    Contract: UniV4LiquidityLockerV3 (codehash: 0x29de8d4c8c3a0042ced8847ac2d9679849a645f8b4892720f5cc1414c95f1ca8)
--    Verdict: GO (Timelock). unlockLiquidity enforces unlockTime. CannotRescueNFTs() on rescue.
--
-- 2. UNCX Uniswap V2 Locker: 0xb560307e7e02a58dbb03562aab32700255140e37
--    Contract: UniswapV2Locker (codehash: 0x26e18528f18d99142763dcd44649df8e504d06b567a25fe4060e432a69b590ed)
--    Verdict: GO (Timelock). withdraw enforces unlockDate & owner. No admin drain.
--
-- 3. Algola Uniswap V4 Locker: 0x01fe99a8a904b97d923bca39bd62b8e2003baf74
--    Contract: AlgolaV4LpLocker (codehash: 0x48f9cfca599b055e9430f900fc6785f1e6f334053b1f903cffd7ca05403ea0f6)
--    Verdict: GO (Timelock). withdrawPosition requires unlockTime. Monotone unlock extension only.
--
-- 4. Nasdank Uniswap V4 Locker: 0x5a1102b701a5ca7d1f2c7050ab130df4a38aa2a7
--    Contract: LpLockerV4 (codehash: 0x24f1b43dce127a197ad2a0f22699d03751557cb991c3cacf91b05bd1253351f2)
--    Verdict: GO (Permanent Burn). Zero withdraw or rescue functions. Holds PLTR LP permanently.
--
-- 5. Pair Uniswap V4 Locker: 0xefcf476e8870fb3eb8680f039414fdcce6c2a117
--    Contract: PairV4Locker (codehash: 0x6cd85bafb67baf6abd2b724f453ec311cd476fc1768a7ec1398ef61121d5e9aa)
--    Verdict: GO (Permanent Burn). Dedicated splitter without transfer or exit functions.
--
-- 6. LaunchLocker Uniswap V3 Locker: 0x9a6931e371b62048c7543c7002c99d83685bd44d
--    Contract: LaunchLocker (codehash: 0xb7219bf75c18c5c622e0fc832c1b863588c1d1995a4fe018749c44871c1663b3)
--    Verdict: GO (Permanent Burn). V3 launchpad locker; traps LP NFT permanently.
--
-- 7. LiquidityLock Uniswap V4 Locker: 0x382a6e2f7feb67b7347c29a8f4a01264bd85055d
--    Contract: LiquidityLock (codehash: 0x66362c24d780fa1fdd3b452153879d001821cc144cddc0d77be69a68e46e65a7)
--    Verdict: GO (Permanent Burn). Promoted from dex-infra; sealed vault without exit functions.
--
-- 8. LpLockerV3 Uniswap V3 Locker: 0xa496a35a9fa24b388fe4affa013c106a3ae54bd9
--    Contract: LpLockerV3 (codehash: 0xcc2413818cece4d1f6bb8c73aa3887e20506527da6909c136e689450748165f7)
--    Verdict: GO (Permanent Burn). Promoted from dex-infra; locked = true permanently.
--
-- ---------------------------------------------------------------------------------
-- SECTION B: DISAPPROVED / UNTRUSTWORTHY CONTRACTS (NO-GO)
-- ---------------------------------------------------------------------------------
-- - 0xd8f88486aad2f57ad557f00cd8e237f703694b40: PrivateVault (PEPONS) -> sweepERC721 backdoor
-- - 0x3a7de5f29557405f5d9fd06b570a53b966a78e8e: LockToken (musebook) -> ERC1967 upgradeable + recoverAssets
-- - 0xc1afa59e2abc1c868c51a1f799a7578eacfea076: StonkUpLockerCL (COCKIN) -> releasePosition pull path
-- - 0xb21bb2473c1523d966337e6a6374a75e4a7181fb: RevenueEscrow (LPAD) -> sweepExpired admin drain
-- - 0x5e1485137e025bf7774f52de4e33fa6e498f6ede: RavenhoodVault (RVH) -> unverified timelock enforcement
-- - 0x2f08437cd724d76bd6489fc27d0edfdff68110e0: SafeProxy (ARROW) -> multisig team custody, not locker
-- - 0x042fed6722e57093d97a4527ad622472ccc8a7be: FeeFloor (GAGE) -> fee infrastructure, not locker
-- ---------------------------------------------------------------------------------

-- 1. UNCX Uniswap V4 Locker
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x128a800cbc615cc110bff16e475865c67631603a',
  4663,
  'lp-locker',
  'timelock',
  'UNCX_LiquidityLocker_UniV4',
  null,
  '{"role":"lp-locker","contractName":"UniV4LiquidityLockerV3","adapterFamily":"uncx-v4","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-26","codehash":"0x29de8d4c8c3a0042ced8847ac2d9679849a645f8b4892720f5cc1414c95f1ca8","codehashVerifiedAt":"2026-09-26"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

INSERT INTO locker_adapters (
  address,
  chain_id,
  family,
  label,
  enabled,
  notes
) VALUES (
  '0x128a800cbc615cc110bff16e475865c67631603a',
  4663,
  'uncx-v4',
  'UNCX Uniswap V4 Locker',
  true,
  'UNCX V4 Lock (ERC-721 receipt over V4 PositionManager). getLockInfo(lockId) reads unlockTime, pool, and position.'
)
ON CONFLICT (address) DO UPDATE
  SET family = EXCLUDED.family,
      label = EXCLUDED.label,
      enabled = EXCLUDED.enabled,
      notes = EXCLUDED.notes,
      updated_at = now();

-- 2. UNCX Uniswap V2 Locker
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0xb560307e7e02a58dbb03562aab32700255140e37',
  4663,
  'lp-locker',
  'timelock',
  'UNCX_LiquidityLocker_UniV2',
  null,
  '{"role":"lp-locker","contractName":"UniswapV2Locker","adapterFamily":"uncx-v2","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0x26e18528f18d99142763dcd44649df8e504d06b567a25fe4060e432a69b590ed","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

INSERT INTO locker_adapters (
  address,
  chain_id,
  family,
  label,
  enabled,
  notes
) VALUES (
  '0xb560307e7e02a58dbb03562aab32700255140e37',
  4663,
  'uncx-v2',
  'UNCX Uniswap V2 Locker',
  true,
  'UNCX V2 Lock. getNumLocksForToken(lpToken) + TOKEN_LOCKS(lpToken, index) + LOCKS(lockID).'
)
ON CONFLICT (address) DO UPDATE
  SET family = EXCLUDED.family,
      label = EXCLUDED.label,
      enabled = EXCLUDED.enabled,
      notes = EXCLUDED.notes,
      updated_at = now();

-- 3. Algola Uniswap V4 Locker
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x01fe99a8a904b97d923bca39bd62b8e2003baf74',
  4663,
  'lp-locker',
  'timelock',
  'Algola_LiquidityLocker_UniV4',
  null,
  '{"role":"lp-locker","contractName":"AlgolaV4LpLocker","subtype":"timelock","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0x48f9cfca599b055e9430f900fc6785f1e6f334053b1f903cffd7ca05403ea0f6","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- 4. Nasdank Uniswap V4 Locker (Permanent Burn)
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x5a1102b701a5ca7d1f2c7050ab130df4a38aa2a7',
  4663,
  'lp-locker',
  'permanent',
  'Nasdank_LpLocker_UniV4',
  null,
  '{"role":"lp-locker","contractName":"LpLockerV4","subtype":"permanent","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0x24f1b43dce127a197ad2a0f22699d03751557cb991c3cacf91b05bd1253351f2","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- 5. Pair Uniswap V4 Locker (Permanent Burn)
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0xefcf476e8870fb3eb8680f039414fdcce6c2a117',
  4663,
  'lp-locker',
  'permanent',
  'Pair_LiquidityLocker_UniV4',
  null,
  '{"role":"lp-locker","contractName":"PairV4Locker","subtype":"permanent","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0x6cd85bafb67baf6abd2b724f453ec311cd476fc1768a7ec1398ef61121d5e9aa","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- 6. LaunchLocker Uniswap V3 Locker (Permanent Burn)
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x9a6931e371b62048c7543c7002c99d83685bd44d',
  4663,
  'lp-locker',
  'permanent',
  'LaunchLocker_UniV3',
  null,
  '{"role":"lp-locker","contractName":"LaunchLocker","subtype":"permanent","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0xb7219bf75c18c5c622e0fc832c1b863588c1d1995a4fe018749c44871c1663b3","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- 7. LiquidityLock Uniswap V4 Locker (Promotion from dex-infra to lp-locker permanent)
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x382a6e2f7feb67b7347c29a8f4a01264bd85055d',
  4663,
  'lp-locker',
  'permanent',
  'LiquidityLock_PACK_UniV4',
  null,
  '{"role":"lp-locker","contractName":"LiquidityLock","subtype":"permanent","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0x66362c24d780fa1fdd3b452153879d001821cc144cddc0d77be69a68e46e65a7","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- 8. LpLockerV3 Uniswap V3 Locker (Promotion from dex-infra to lp-locker permanent)
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0xa496a35a9fa24b388fe4affa013c106a3ae54bd9',
  4663,
  'lp-locker',
  'permanent',
  'LpLockerV3_WIZARD_UniV3',
  null,
  '{"role":"lp-locker","contractName":"LpLockerV3","subtype":"permanent","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-09-27","codehash":"0xcc2413818cece4d1f6bb8c73aa3887e20506527da6909c136e689450748165f7","codehashVerifiedAt":"2026-09-27"}'::jsonb,
  true, 'ok', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- ---------------------------------------------------------------------------------
-- SECTION C: DISAPPROVED LOCKERS (Persisted audit records: verify_status = failed)
-- ---------------------------------------------------------------------------------
-- Note: enabled = false and verify_status = 'failed' ensures these NEVER receive
-- locker credit while permanently recording the audit finding in the database.

-- PrivateVault (PEPONS) -> sweepERC721 backdoor
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0xd8f88486aad2f57ad557f00cd8e237f703694b40',
  4663,
  'dex-infra',
  'untrusted-locker',
  'PrivateVault_PEPONS_Unsafe',
  null,
  '{"role":"untrusted-locker","contractName":"PrivateVault","whyNotTrusted":"sweepERC721 and sweepToken callable by vaultOwner with no timelock constraints; owner can withdraw LP at any time","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- LockToken (musebook) -> ERC1967 upgradeable + recoverAssets backdoor
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x3a7de5f29557405f5d9fd06b570a53b966a78e8e',
  4663,
  'dex-infra',
  'untrusted-locker',
  'LockToken_musebook_Unsafe',
  null,
  '{"role":"untrusted-locker","contractName":"LockToken","whyNotTrusted":"ERC1967 upgradeable proxy; implementation exposes recoverAssets callable by owner","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- StonkUpLockerCL (COCKIN) -> releasePosition pull path
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0xc1afa59e2abc1c868c51a1f799a7578eacfea076',
  4663,
  'dex-infra',
  'untrusted-locker',
  'StonkUpLockerCL_COCKIN_Unsafe',
  null,
  '{"role":"untrusted-locker","contractName":"StonkUpLockerCL","whyNotTrusted":"releasePosition and decreaseLockedLiquidity callable by team; team can withdraw LP at will (KNOWN-PROBLEMS L13)","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- RevenueEscrowAutoSwapFeeLockerV1843 (LPAD) -> sweepExpired admin drain
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0xb21bb2473c1523d966337e6a6374a75e4a7181fb',
  4663,
  'dex-infra',
  'untrusted-locker',
  'RevenueEscrow_LPAD_Unsafe',
  null,
  '{"role":"untrusted-locker","contractName":"RevenueEscrowAutoSwapFeeLockerV1843","whyNotTrusted":"Revenue escrow with sweepExpired admin drain mechanism; does not provide an immutable LP lock guarantee","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- RavenhoodVault (RVH) -> unverified timelock enforcement
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x5e1485137e025bf7774f52de4e33fa6e498f6ede',
  4663,
  'dex-infra',
  'untrusted-locker',
  'RavenhoodVault_RVH_Unsafe',
  null,
  '{"role":"untrusted-locker","contractName":"RavenhoodVault","whyNotTrusted":"Custom project vault without verifiable monotone timelock constraints on the underlying LP NFT","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- SafeProxy (ARROW) -> multisig team custody
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x2f08437cd724d76bd6489fc27d0edfdff68110e0',
  4663,
  'dex-infra',
  'multisig-custody',
  'SafeProxy_ARROW_Multisig',
  null,
  '{"role":"multisig-custody","contractName":"SafeProxy","whyNotTrusted":"Gnosis Safe multisig wallet holding LP; belongs in team custody / dex-infra, not lp-locker","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- FeeFloor (GAGE) -> fee infrastructure
INSERT INTO trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) VALUES (
  '0x042fed6722e57093d97a4527ad622472ccc8a7be',
  4663,
  'dex-infra',
  'fee-floor',
  'FeeFloor_GAGE_Infra',
  null,
  '{"role":"fee-floor","contractName":"FeeFloor","whyNotTrusted":"Protocol fee floor contract; not an LP timelock or permanent burn locker","grantsLockedCredit":false,"auditedAt":"2026-09-27"}'::jsonb,
  false, 'failed', now(), 'migration-0102'
)
ON CONFLICT (address, chain_id) DO UPDATE
  SET category = EXCLUDED.category,
      subtype = EXCLUDED.subtype,
      label = EXCLUDED.label,
      metadata = EXCLUDED.metadata,
      enabled = EXCLUDED.enabled,
      verify_status = EXCLUDED.verify_status,
      verified_at = now(),
      updated_at = now();

-- ============================================================================
-- was 0103_sequencer_ingestion.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS sequencer_work (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('tx', 'gap', 'pons')),
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sequencer_work_ready_idx ON sequencer_work (available_at, created_at);

CREATE TABLE IF NOT EXISTS sequencer_checkpoints (
  stream text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sequencer_metrics (
  hour timestamptz NOT NULL,
  provider text NOT NULL,
  event text NOT NULL,
  reason text NOT NULL DEFAULT '',
  count bigint NOT NULL DEFAULT 0 CHECK (count >= 0),
  credits bigint NOT NULL DEFAULT 0 CHECK (credits >= 0),
  latency_ms bigint NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  PRIMARY KEY (hour, provider, event, reason)
);
CREATE INDEX IF NOT EXISTS sequencer_metrics_hour_idx ON sequencer_metrics (hour);

CREATE TABLE IF NOT EXISTS sequencer_budgets (
  day date NOT NULL,
  account_id text NOT NULL,
  credits bigint NOT NULL DEFAULT 0 CHECK (credits >= 0),
  PRIMARY KEY (day, account_id)
);
CREATE INDEX IF NOT EXISTS sequencer_budgets_day_idx ON sequencer_budgets (day);

CREATE TABLE IF NOT EXISTS sequencer_explorer_spend (
  day date NOT NULL,
  account_id text NOT NULL,
  credits bigint NOT NULL DEFAULT 0 CHECK (credits >= 0),
  PRIMARY KEY (day, account_id)
);
CREATE INDEX IF NOT EXISTS sequencer_explorer_spend_day_idx ON sequencer_explorer_spend (day);

-- ============================================================================
-- was 0104_launch_refresh_job.sql
-- ============================================================================
-- Keep mutable launch state and market readings fresh after broad launch discovery is retired.
-- The hourly launch-maintenance job remains scheduled independently.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-launch-refresh', '*/5 * * * *', '/api/jobs/launch-refresh');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-launch-refresh every five minutes after rc_schedule_job and job configuration are available.';
  end if;
end $$;

-- ============================================================================
-- was 0105_erc4337_and_infra_addresses.sql
-- ============================================================================
-- Name shared infrastructure (4337 EntryPoints, CREATE2 deployers, Safe factories and
-- singletons, Multicall3) so a scan never reports them as an unknown holder or funder.
-- dex-infra is a labelling bucket only: no holder exclusion, never used for routing.
-- All 11 addresses were confirmed to have code on 4663 (eth_getCode, 2026-09-28).

insert into public.trusted_address
  (address, chain_id, category, subtype, label, dex_id, metadata, enabled, verify_status, verified_at, created_by)
values
  -- ERC-4337 EntryPoint (v0.6, v0.7, v0.8)
  ('0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789', 4663, 'dex-infra', null, 'ERC-4337 EntryPoint v0.6', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0x0000000071727de22e5e9d8baf0edac6f37da032', 4663, 'dex-infra', null, 'ERC-4337 EntryPoint v0.7', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0x4337084d9e255ff0702461cf8895ce9e3b5ff108', 4663, 'dex-infra', null, 'ERC-4337 EntryPoint v0.8', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),

  -- Deterministic deployment infrastructure
  ('0x4e59b44847b379578588920ca78fbf26c0b4956c', 4663, 'dex-infra', null, 'CREATE2 deterministic deployer', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed', 4663, 'dex-infra', null, 'CreateX (deterministic deployer)', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),

  -- Safe Smart Account infrastructure
  ('0x914d7fec6aac8cd542e72bca78b30650d45643d7', 4663, 'dex-infra', null, 'Safe singleton factory', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0xa6b71e26c5e0845f74c812102ca7114b6a896ab2', 4663, 'dex-infra', null, 'Safe factory v1.3.0', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67', 4663, 'dex-infra', null, 'Safe factory v1.4.1', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0x41675c099f32341bf84bfc5382af534df5c7461a', 4663, 'dex-infra', null, 'Safe singleton v1.3.0', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),
  ('0x29fcb43b46531bca003ddc8fcb67ffe91900c762', 4663, 'dex-infra', null, 'Safe singleton v1.4.1', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105'),

  -- Multicall3: already the batcher in lib/dex/pool-origin.ts, never registered
  ('0xca11bde05977b3631167028862be2a173976ca11', 4663, 'dex-infra', null, 'Multicall3', null, '{}'::jsonb, true, 'ok', now(), 'migration-0105')

on conflict (address, chain_id) do nothing;

-- ============================================================================
-- was 0106_rpc_endpoints_swap_pool.sql
-- ============================================================================
-- Swap-only RPC keys (operator decision 2026-09-28). A row with pool = 'swap'
-- serves /api/swap/plan first and is never used by scans, so neither side can
-- spend the other's monthly budget. With every swap row off or over budget,
-- the swap falls back to the shared pool (lib/rpc/provider-pool.ts).
alter table rpc_endpoints add column if not exists pool text not null default 'shared';

do $$
begin
  alter table rpc_endpoints add constraint rpc_endpoints_pool check (pool in ('shared', 'swap'));
exception when duplicate_object then null;
end $$;

create or replace view rpc_endpoints_public as
  select id, enabled, sort_order, max_cu_per_second, max_requests_per_second,
         max_concurrent_requests, prefer_methods, max_log_span,
         deny_methods, allow_methods, note, disabled_at, updated_at, updated_by,
         pool
  from rpc_endpoints;

-- ============================================================================
-- was 0107_uniswap_hooklist.sql
-- ============================================================================
-- Uniswap's public hook list (github.com/Uniswap/hooklist), Robinhood Chain entries only.
-- Reference text shown next to a hook; never an input to a verdict, a score or a fingerprint.
-- Refreshed daily by /api/jobs/hooklist-sync.
CREATE TABLE IF NOT EXISTS uniswap_hooks (
  chain_id integer NOT NULL,
  address text NOT NULL CHECK (address ~ '^0x[0-9a-f]{40}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  deployer text NOT NULL DEFAULT '',
  verified_source boolean,
  audit_url text NOT NULL DEFAULT '',
  flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, address)
);

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-hooklist-sync', '17 4 * * *', '/api/jobs/hooklist-sync');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-hooklist-sync daily after rc_schedule_job and job configuration are available.';
  end if;
end $$;

-- ============================================================================
-- was 0108_sync_cursor_indexes.sql
-- ============================================================================
-- Change cursors for the keyed prod -> local-smoke sync (/api/sync/v1/*, lib/sync/).
-- Each sync page is `where (cursor, key) > ($1, $2) order by cursor, key limit n`; without
-- these it is a seq scan of up to 1.1M rows on prod every 15 s.
--
-- launches, launch_events and v4_pools are insert-only (onConflictDoNothing), so recorded_at
-- is when the row appeared. launch_state is updated in place; the later of its two read
-- times is when it last changed (greatest() skips a null).
--
-- CONCURRENTLY is not allowed in the deploy's transaction (tests/deploy-migrations.test.ts);
-- the brief write lock at deploy is accepted, as in 0082.
create index if not exists launches_recorded_idx on launches (recorded_at, token_address);
create index if not exists launch_events_recorded_idx on launch_events (recorded_at, id);
create index if not exists v4_pools_recorded_idx on v4_pools (recorded_at, pool_id);
create index if not exists launch_state_touched_idx
  on launch_state ((greatest(state_read_at, market_read_at)), token_address);
