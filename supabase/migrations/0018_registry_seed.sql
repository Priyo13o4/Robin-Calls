-- ─────────────────────────────────────────────────────────────
-- RobinCalls — canonical registry seed (§6).
--
-- Populates public.registry (created in 0001) with the official Robinhood Chain
-- asset list from docs.robinhood.com/chain/contracts (fetched 2026-07-17). This
-- is the "not yet synced" gap noted in STATUS.md §B6: the registry feeds the
-- impersonation + brand-squatting checks (a scanned token whose symbol/name
-- collides with one of these at a DIFFERENT address is flagged), so until it's
-- populated those checks return "Canonical registry not yet synced."
--
-- A migration seed is the reproducible bootstrap. The /api/jobs/registry-sync
-- endpoint can still refresh/extend this later without a migration (it upserts
-- on address). ON CONFLICT here keeps a re-run idempotent and self-healing.
--
-- VERIFY BEFORE RELYING ON IT: addresses are copied verbatim from the docs page;
-- WETH matches the address already used across the codebase. Company names are
-- for admin/display readability — the impersonation match keys on asset_symbol.
-- ─────────────────────────────────────────────────────────────

insert into public.registry (asset_name, asset_symbol, address, category) values
  -- Infrastructure / settlement
  ('Wrapped Ether',              'WETH', '0x0bd7d308f8e1639fab988df18a8011f41eacad73', 'infra'),
  ('USD Governance',             'USDG', '0x5fc5360d0400a0fd4f2af552add042d716f1d168', 'stablecoin'),
  -- Tokenized stocks
  ('Apple',                      'AAPL', '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9', 'stock-token'),
  ('Advanced Micro Devices',     'AMD',  '0x86923f96303d656e4aa86d9d42d1e57ad2023fdc', 'stock-token'),
  ('Amazon',                     'AMZN', '0x12f190a9f9d7d37a250758b26824b97ce941bf54', 'stock-token'),
  ('Alibaba',                    'BABA', '0xad25ac6c84d497db898fa1e8387bf6af3532a1c4', 'stock-token'),
  ('Bloom Energy',               'BE',   '0x822cc93ffd030293e9842c30bbd678f530701867', 'stock-token'),
  ('Coinbase',                   'COIN', '0x6330d8c3178a418788df01a47479c0ce7ccf450b', 'stock-token'),
  ('Circle',                     'CRCL', '0xdf0992e440dd0be65bd8439b609d6d4366bf1cb5', 'stock-token'),
  ('CoreWeave',                  'CRWV', '0x5f10a1c971b69e47e059e1dc91901b59b3fb49c3', 'stock-token'),
  ('Alphabet',                   'GOOGL','0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3', 'stock-token'),
  ('Intel',                      'INTC', '0xc72b96e0e48ecd4dc75e1e45396e26300bc39681', 'stock-token'),
  ('Meta Platforms',             'META', '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', 'stock-token'),
  ('Microsoft',                  'MSFT', '0xe93237c50d904957cf27e7b1133b510c669c2e74', 'stock-token'),
  ('Micron Technology',          'MU',   '0xff080c8ce2e5feadaca0da81314ae59d232d4afd', 'stock-token'),
  ('NVIDIA',                     'NVDA', '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 'stock-token'),
  ('Oracle',                     'ORCL', '0xb0992820e760d836549ba69bc7598b4af75dee03', 'stock-token'),
  ('Palantir',                   'PLTR', '0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a', 'stock-token'),
  ('SanDisk',                    'SNDK', '0xb90a19ff0af67f7779aff50a882a9cff42446400', 'stock-token'),
  ('SpaceX',                     'SPCX', '0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', 'stock-token'),
  ('Tesla',                      'TSLA', '0x322f0929c4625ed5bad873c95208d54e1c003b2d', 'stock-token'),
  ('USA Rare Earth',             'USAR', '0xd917b029c761d264c6a312bbbcda868658ef86a6', 'stock-token'),
  -- Tokenized ETFs
  ('Invesco QQQ Trust',          'QQQ',  '0xd5f3879160bc7c32ebb4dc785f8a4f505888de68', 'etf'),
  ('iShares 0-3M Treasury Bond', 'SGOV', '0x92fd66527192e3e61d4ddd13322aa222de86f9b5', 'etf'),
  ('iShares Silver Trust',       'SLV',  '0x411efb0e7f985935daec3d4c3ebaea0d0ad7d89f', 'etf'),
  ('SPDR S&P 500 ETF Trust',     'SPY',  '0x117cc2133c37b721f49de2a7a74833232b3b4c0c', 'etf'),
  ('CUSO',                       'CUSO', '0xa30fa36db767ad9ed3f7a60fc79526fb4d56d344', 'etf')
on conflict (address) do update set
  asset_name   = excluded.asset_name,
  asset_symbol = excluded.asset_symbol,
  category     = excluded.category,
  fetched_at   = now();
