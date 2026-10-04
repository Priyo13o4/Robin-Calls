-- Lift wallet_stains rows whose subject address is provably a contract, not a
-- wallet — the forward-only gap DEPLOYER-IDENTITY-HANDOFF.md ("Still open")
-- names for candidateIsSafeToStain (lib/lineage/stains.ts): its CONTRACT
-- refusal only stops NEW stains from being written. Rows written before the
-- guard existed are untouched, still read by readActiveStainFor, and still
-- capable of publishing a CRITICAL hop1Stained/hop2Stained finding against a
-- launchpad, router, or other infra contract — the exact accusation the
-- guard exists to prevent, just pre-dating it.
--
-- This migration cannot call the chain, so it cannot run the same getCode
-- classification the runtime gate does (lib/scanner/entity.ts:codeKind). It
-- only lifts what stored data already proves is a contract:
--
--   * tokens.address            — every row is a deployed ERC20 token
--     contract (the scanner only inserts a token after observing its code).
--   * launchpads.curve_address  — a deployed launchpad/bonding-curve
--     contract (checked lowercase-hex by launchpads_curve_address_check).
--   * trusted_address.address, EXCLUDING category = 'burn-address' — curated
--     on-chain infra (factories, routers, quoters, position/pool managers,
--     permit2, lockers, RWA plumbing, proxies) that requires deployed code to
--     do its job. 'burn-address' rows (e.g. 0x…dEaD) hold no code and would
--     classify EOA at runtime, so excluding them keeps this predicate from
--     disagreeing with candidateIsSafeToStain in the one direction it could
--     otherwise be wrong: lifting a stain that was never a false accusation.
--
-- Deliberately NOT included: deployers.address. A deployers row can be either
-- an EOA or a contract — that ambiguity is this whole defect class (see
-- DEPLOYER-IDENTITY-HANDOFF.md §3, "the subject error"), so it is not proof
-- of contract-ness and using it here would repeat the bug being cleaned up.
-- A stain whose only contract evidence would be its presence in `deployers`
-- is left standing: a partial, provable cleanup beats a total guess.
--
-- Neutralises rather than deletes: `active = false` is the same "lift"
-- mechanism liftStainRecord() already writes (lib/data/lineage.ts), and every
-- reader already filters on it (readActiveStainFor, readWalletStainsForOrigin,
-- readActiveStainCount) — reversible, auditable via lifted_reason/lifted_by,
-- and needs no schema change. Re-running is a no-op: the WHERE clause only
-- ever matches rows still `active = true`.
update public.wallet_stains
set active = false,
    lifted_at = now(),
    lifted_reason = 'subject is a known contract (token/launchpad/trusted_address row), not a wallet -- candidateIsSafeToStain (lib/lineage/stains.ts) has refused new stains against contracts since fix/subject-error-class; this migration removes the pre-existing rows the guard could not reach',
    lifted_by = 'migration:0054_lift_contract_subject_stains'
where active = true
  and address in (
    select address from public.tokens
    union
    select curve_address from public.launchpads
    union
    select address from public.trusted_address where category <> 'burn-address'
  );
