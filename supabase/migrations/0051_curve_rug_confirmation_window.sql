-- Debounce the RUGGED accusation.
--
-- A bonding curve drains when it graduates and it drains when it is rugged.
-- From the curve's own side those look identical, which is why `applyFills`
-- carries the `alreadyGraduatedOrPooled` guard. But the fact that guard reads —
-- `dex_pool_address` — is written by the factory-event reconcile, which depends
-- on `tracker-poll` (every 10 min) having indexed the pool, while `curve-poll`
-- evaluates the accusation every minute. A graduation can therefore be accused
-- in the window before its own pool is on file. See KNOWN-PROBLEMS M1 and
-- docs/ways-of-work/plan/curve-graduation/PLAN.md §3.2.
--
-- The fix is not to poll harder. It is that **a rug is never urgent.** Nothing
-- is gained by publishing an accusation within 60 seconds of the drain, and
-- CLAUDE.md §9's asymmetry says everything about which error to prefer: a
-- delayed accusation costs nothing, a wrong one is the published harm.
--
-- So the first tick that sees a qualifying drop records WHEN it saw it, and
-- says nothing. The accusation is only written once the drop has survived
-- `CURVE_RUG_CONFIRM_MINUTES`, which must stay longer than the indexer's
-- period. A graduation resolves itself inside that window and is never
-- accused; a real rug is published a few minutes later than it used to be.
--
-- NULL means "no drop currently suspected" — the column is cleared whenever a
-- row stops qualifying, so a recovered curve does not carry an old suspicion
-- forward into a later, unrelated drop.

alter table curve_tokens
  add column if not exists rug_suspected_at timestamptz;

-- The confirmation sweep reads exactly this shape: suspected, still bonding,
-- still no pool on file. Partial because a suspicion is rare and short-lived —
-- this indexes tens of rows out of ~190k, not the table.
create index if not exists curve_tokens_rug_suspected_idx
  on curve_tokens (rug_suspected_at)
  where rug_suspected_at is not null
    and status = 'CURVING'
    and dex_pool_address is null;
