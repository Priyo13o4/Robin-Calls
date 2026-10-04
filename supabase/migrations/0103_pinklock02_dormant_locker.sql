-- 0103 — KNOWN-PROBLEMS L219: PinkLock02 recorded DORMANT (enabled=false, unchecked).
-- An `ok` lp-locker row credits its WHOLE balance as locked, but PinkLock holds vesting locks that are
-- partly claimable and expired locks nobody has withdrawn. Arm it only with a getLockById terms adapter.
-- Chain and explorer facts read 2026-09-30 are in `metadata`; the admin lp-locker "verify" passes on
-- bytecode alone, so do not use it to arm this row.
insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0xbe0b139abc90723af76a89d3051f60ba1b64c8d9',
  4663,
  'lp-locker',
  'timelock',
  'PinkLock02 (PinkSale)',
  null,
  '{"role":"lp-locker","contractName":"PinkLock02","protocol":"pinksale","holds":"lp-and-normal-tokens","sourceMatch":"partial","compiler":"v0.8.4+commit.c7e474f2","explorerVerifiedAt":"2026-07-08","upgradeable":false,"proxySlotsEmpty":true,"delegatecall":false,"selfdestruct":false,"create":false,"ownerless":true,"editLockRule":"lock owner may only extend tgeDate or raise amount, never shorten or shrink","withdrawPath":"unlock(lockId) by lock owner: tgeDate for plain locks, tgeBps then cycleBps per cycle seconds for vesting locks","termsGetter":"getLockById(uint256) returns (id,token,owner,amount,lockDate,tgeDate,tgeBps,cycle,cycleBps,unlockedAmount,description); percentages in basis points","grantsLockedCredit":false,"blockedOn":"a pinklock terms adapter reading per-lock withdrawable amount; until then this row must stay disabled","codehash":"0x88172df766517edffa7d598d05205119ce584cf79509cfa6c7db228921dfb82f","codehashVerifiedAt":"2026-09-30","runtimeCodeBytes":20622,"creator":"0x802651539e977410002803279e2f64c8f0dd5605","creationTx":"0x2e2cbfe712993d8a1d7eb5e23219633ba26526638964bf79388822cdad224e76","lpLocksAt":69,"normalLocksAt":695,"locksCountedAt":"2026-09-30","recordUrlTemplate":"https://www.pinksale.finance/pinklock/robinhood/record/{lockId}","auditedAt":"2026-09-30"}'::jsonb,
  false, 'unchecked', null, 'migration-0103'
)
on conflict (address, chain_id) do nothing;
