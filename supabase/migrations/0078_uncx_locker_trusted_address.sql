-- 0078 — L56: UNCX V3 locker in trusted_address
--
-- UNCX_LiquidityLocker_UniV3 (0xf287...ce0f) was added to locker_adapters in 0072;
-- this registers it in trusted_address with category 'lp-locker', subtype 'timelock'.

-- KNOWN-PROBLEMS L66 — a locker row seeded `verify_status = 'ok'` with no
-- `codehash` is an all-clear that cannot say WHICH bytecode earned it, and so
-- can never notice the day that bytecode changes (L65). Six of the eight locker
-- rows in prod are in exactly that state; this one must not be the seventh.
--
-- Chain-read 2026-09-01 against 0xf287…ce0f: 23,902 bytes of deployed code,
-- keccak256 = 0x325ad147a61d60ecaee0e60d066043f956c789a14a341c93429e966f9371d210.
-- `grantsLockedCredit: true` is a direct all-clear, which is precisely why the
-- row has to carry the fingerprint it is granting credit to.
insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0xf28704c691290547924e2129d407da36bda8ce0f',
  4663,
  'lp-locker',
  'timelock',
  'UNCX_LiquidityLocker_UniV3',
  null,
  '{"role":"lp-locker","contractName":"UNCX_LiquidityLocker_UniV3","adapterFamily":"uncx-v3","sourceMatch":"full","grantsLockedCredit":true,"auditedAt":"2026-08-28","codehash":"0x325ad147a61d60ecaee0e60d066043f956c789a14a341c93429e966f9371d210","codehashVerifiedAt":"2026-09-01"}'::jsonb,
  true, 'ok', now(), 'migration-0078'
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
