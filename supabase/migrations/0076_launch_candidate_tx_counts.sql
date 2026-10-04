-- Buy/sell transaction counts for launch_candidates (lib/config/tracker.ts's
-- new minTxCount24h floor). Both DexScreener and GeckoTerminal already return
-- these in the SAME request already made for liquidity/volume — this is
-- storage for data already being fetched, not a new API call.
--
-- Nullable, and NULL means "not measured" — never coerce to 0 on write. The
-- traction gate reads it as `(buys_24h ?? 0) + (sells_24h ?? 0)`, which fails
-- the floor identically for "unmeasured" and "measured zero" on purpose
-- (this gate decides public feed visibility, not a scanner accusation).

alter table launch_candidates
  add column if not exists buys_24h  integer,
  add column if not exists sells_24h integer;
