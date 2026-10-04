-- 0098 — KNOWN-PROBLEMS L173: GAGE's CompoundingSeedTimelock as a timelock locker
--
-- GAGE verdict 339 called this contract "not proven locked" while it held 33.35% of
-- the creator-opened pool 0xf81fda45. Read from the chain and the explorer on
-- 2026-09-15, never hand-entered:
--   source verified (partial match), compiler 0.8.28, no proxy, 11,839 bytes,
--   codehash 0xb2221c8c…; created by 0x71b41cf9… in the pool-open tx 0xff87fd93…
--   tokenId 2126377 (ownerOf = this contract), releaseAt 1820345126
--   (2027-09-07 19:25:26 UTC), released false, TREASURY 0x86514e45… (the creator),
--   POSM = the configured V4 PositionManager, position pool = 0xf81fda45….
--   release() reverts StillLocked before releaseAt; compound() is TREASURY-only and
--   only re-adds collected fees to the same NFT. No other exit.
--
-- Subtype 'timelock': the credit lapses at releaseAt through the lock-terms adapter
-- (`compounding-seed-timelock`), which re-reads the date and the pool on every scan.

insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0x93cf65e925ba231a32358a59f6d97d948cd0674e',
  4663,
  'lp-locker',
  'timelock',
  'GAGE seed timelock (CompoundingSeedTimelock)',
  null,
  '{"role":"lp-locker","contractName":"CompoundingSeedTimelock","protocol":"v4","token":"0x7163ae1b5aea2f09ebc609c52b4dcac0a7a4bc2d","pool":"0xf81fda45e69648fa1fe7202a7a296cf532223d478d5a61872acba2e07cb1bfe8","tokenId":"2126377","releaseAt":1820345126,"treasury":"0x86514e45293fcf111ed8a6bda7c8bca4a64dd9e5","positionManager":"0x58daec3116aae6d93017baaea7749052e8a04fa7","withdrawPath":"release() after releaseAt, to TREASURY","compoundPath":"TREASURY-only, fees re-added to the same NFT","sourceMatch":"partial","upgradeable":false,"grantsLockedCredit":true,"auditedAt":"2026-09-15","codehash":"0xb2221c8cbee9f6adf8e22593a49eb51dcdd3e936f4b3bbaeb603aefba79bcbe6","codehashVerifiedAt":"2026-09-15","runtimeCodeBytes":11839}'::jsonb,
  true, 'ok', now(), 'migration-0098'
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

insert into locker_adapters (address, family, label, notes) values
  ('0x93cf65e925ba231a32358a59f6d97d948cd0674e', 'compounding-seed-timelock', 'GAGE seed timelock (CompoundingSeedTimelock)',
   'tokenId/releaseAt/released/TREASURY/POSM plus the position''s pool via getPoolAndPositionInfo. Chain-verified 2026-09-15.')
on conflict (address) do update
  set family = excluded.family, label = excluded.label, notes = excluded.notes, updated_at = now();
