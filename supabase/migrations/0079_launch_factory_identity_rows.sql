-- 0079 — identity rows for three chain-confirmed launch factories (L25).
--
-- These are IDENTITY rows, not trust grants: `grantsLockedCredit: false`, and
-- nothing here exonerates a token. They resolve `launchpad_provenance` only —
-- 6 of L25's 32 withheld points. The other 26 need the origin to become
-- `attributable`, which requires a pad adapter writing curve_tokens.creator_address.
--
-- Each was confirmed a SHARED launch surface by counting distinct senders of
-- the factory's LAUNCH SELECTOR (derived from a known token's creation tx) —
-- not of all inbound txs, which counts traders and produced a false positive
-- on 0x27643bfe (43 senders, 0 of 100 txs actually launches). See L25.
--
-- Deliberately NOT registered, and the reasons are load-bearing (L25):
--   0xdd84fdde…, 0xc70e510e…, 0x0c37a24f… — confirmed shared surfaces, but OLI
--     returns count=0 and the explorer has no verified source, so there is no
--     defensible label. A row with a wrong label is worse than no row.
--   0x1b37d3a7… (DopplerERC20V1Factory) — transactions_count = 0 because it is
--     invoked INTERNALLY. The probe is blind, so this is UNKNOWN, not excluded (§4).
--   0xd18d70ae…, 0x3a5fd2b1…, 0x7f66f29a…, 0x958bbc3a…, 0x43e4c17b… — single-user
--     deployer contracts. The registry-miss sentence is CORRECT about these.

INSERT INTO trusted_address (address, chain_id, category, subtype, label, dex_id, verify_status, metadata)
VALUES
  ('0x2ba793fd69bf251fd1af90b576be8b9fa6be46db', 4663, 'dex-infra', 'launchpad-factory',
   'Lemon.fun Launch Factory', NULL, 'ok', '{
     "role": "launchpad-factory", "contractName": "LemonLaunchFactory",
     "site": "https://lemon.fun",
     "identifiedVia": ["blockscout-contract-name", "launched LEMON/Lemon.fun", "launch-selector-fanout"],
     "launchSelector": "0x686399cb",
     "fanout": {"launchTxs": 100, "sampled": 100, "distinctLaunchers": 68, "measuredAt": "2026-09-01"},
     "note": "Shared surface. No adapter yet — origin stays unattributable until one exists.",
     "grantsLockedCredit": false }'::jsonb),

  ('0x8660a7f019c7943b0b0a91b8e39aff3b6db6ae62', 4663, 'dex-infra', 'launchpad-factory',
   'PAIR Launch Factory', NULL, 'ok', '{
     "role": "launchpad-factory", "contractName": "PairERC1967Proxy",
     "identifiedVia": ["blockscout-verified-source", "launched PAIR", "launch-selector-fanout"],
     "launchSelector": "0x07489e0a",
     "fanout": {"launchTxs": 98, "sampled": 100, "distinctLaunchers": 47, "measuredAt": "2026-09-01"},
     "note": "Multipool RWA launchpad, announced 2026-08-31. No adapter yet.",
     "grantsLockedCredit": false }'::jsonb),

  ('0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb', 4663, 'dex-infra', 'launchpad-factory',
   'Pons V1 Launch Factory', NULL, 'ok', '{
     "role": "launchpad-factory", "contractName": "PonsLaunchFactory",
     "identifiedVia": ["blockscout-contract-name", "launch-selector-fanout"],
     "launchSelector": "0x686399cb",
     "fanout": {"launchTxs": 98, "sampled": 100, "distinctLaunchers": 37, "measuredAt": "2026-09-01"},
     "note": "Pons V1 — retired pad, still the creator of record for older tokens. 0x686399cb is a SHARED launch signature (Lemon and 0x0c37a24f use it too); it identifies a launch call, never a brand.",
     "grantsLockedCredit": false }'::jsonb)

ON CONFLICT (address, chain_id) DO NOTHING;
