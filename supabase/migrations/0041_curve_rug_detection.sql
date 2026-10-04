-- Rug / pulled-liquidity detection (curve/lifecycle rebuild §5.8).
--
-- One additive column: peak_progress_bps, a curve's high-water mark. NOT
-- raised_wei — flap's raised_wei is additive/non-idempotent under a cursor
-- replay (lib/tracker/curves/types.ts), so it can inflate on a re-walk;
-- progress_bps is the authoritative figure for every unifiable preset. A
-- curve that fell sharply from its own peak (e.g. 68% -> 2%) is a dump by
-- ANY mechanism — creator sell, insider exit, or something never seen
-- before — and per CLAUDE.md §8.3 that is the strongest signal in this
-- domain, not missing data.
--
-- 'RUGGED' joins curve_tokens.status alongside CURVING/GRADUATED/STALLED.

alter table public.curve_tokens
  add column if not exists peak_progress_bps integer not null default 0
    check (peak_progress_bps >= 0 and peak_progress_bps <= 10000);

alter table public.curve_tokens drop constraint curve_tokens_status_check;
alter table public.curve_tokens add constraint curve_tokens_status_check
  check (status = ANY (ARRAY['CURVING'::text, 'GRADUATED'::text, 'STALLED'::text, 'RUGGED'::text]));

-- Backfill: a curve's current progress is itself a floor for its historical
-- peak (it can only have been at least this high) — cheap, correct, and
-- avoids every existing CURVING row starting at a peak of 0.
update public.curve_tokens set peak_progress_bps = progress_bps where peak_progress_bps = 0;
