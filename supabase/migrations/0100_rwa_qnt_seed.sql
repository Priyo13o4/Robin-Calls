-- ─────────────────────────────────────────────────────────────
-- RobinCalls — QNT (Quantinuum Inc. Class A) registry seed.
--
-- Official Robinhood Stock Token listed in api.robinhood.com/rhj/assets
-- Verified on Robinhood Chain (chain id 4663):
--   Beacon: 0xe10b6f6b275de231345c20d14ab812db62151b00
--   Implementation: 0x8ef0c9b740ef8c34f9a5626244f2d72f10b83e3c
-- ─────────────────────────────────────────────────────────────

insert into public.registry (asset_name, asset_symbol, address, category, verify_status, verified_at)
values (
  'Quantinuum Inc. Class A',
  'QNT',
  '0xb7edfe2f33c1ac06830a971dfb559bde8a2a3d76',
  'stock-token',
  'ok',
  now()
)
on conflict (address) do update set
  asset_name    = excluded.asset_name,
  asset_symbol  = excluded.asset_symbol,
  category      = excluded.category,
  verify_status = excluded.verify_status,
  verified_at   = excluded.verified_at;
