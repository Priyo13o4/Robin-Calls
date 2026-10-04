-- 0094 — identity rows for the two letscash.fun (CashCat) V4 hooks.
--
-- Without them `launchHookSet()` cannot recognise letscash pools, so pool origin
-- falls back to a transaction read. Both hooks revert `beforeInitialize` unless
-- the sender is factory 0x5bd1fbe7…, so the hook in a PoolKey proves the pad
-- opened the pool. Verified 2026-09-14: Sourcify exact_match, no proxy slot, no
-- delegatecall, `factory()` = 0x5bd1fbe7… on both, address flags 0x2aec.
--
-- IDENTITY ONLY. Both hooks also revert every removeLiquidity, but no
-- custody check reads a hook-level lock, so this grants no locked credit.
INSERT INTO trusted_address (address, chain_id, category, subtype, label, dex_id, verify_status, metadata)
VALUES
  ('0x75a54357d9c78a2db19004a5fdc76c50f9242aec', 4663, 'dex-infra', 'v4-hook',
   'letscash.fun Hook V2 (CashCatHookV2)', 'uniswap', 'unchecked', '{
     "role": "v4-hook", "factory": "0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661",
     "launchpad": "cashcat", "contractName": "CashCatHookV2", "sourceMatch": "exact_match",
     "upgradeable": false, "flags": "0x2aec", "removeLiquidity": "always-reverts",
     "owner": "0xd2defbd13aff22d6989e8c14b4517ec308079e91",
     "identifiedVia": ["letscash.fun-frontend", "factory()", "TokenLaunched.hook"], "auditedAt": "2026-09-14",
     "note": "identity only — a V4 hook is an authority surface and must still be censused by lib/audit before any claim is made about it",
     "grantsLockedCredit": false }'::jsonb),

  ('0xefe669814e5eec33406bd50ffa8331618d076aec', 4663, 'dex-infra', 'v4-hook',
   'letscash.fun Hook V1 (CashCatHook)', 'uniswap', 'unchecked', '{
     "role": "v4-hook", "factory": "0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661",
     "launchpad": "cashcat", "contractName": "CashCatHook", "sourceMatch": "exact_match",
     "upgradeable": false, "flags": "0x2aec", "removeLiquidity": "always-reverts",
     "owner": "0xd2defbd13aff22d6989e8c14b4517ec308079e91",
     "identifiedVia": ["letscash.fun-frontend", "factory()"], "auditedAt": "2026-09-14",
     "note": "identity only — a V4 hook is an authority surface and must still be censused by lib/audit before any claim is made about it",
     "grantsLockedCredit": false }'::jsonb)
ON CONFLICT (address, chain_id) DO NOTHING;
