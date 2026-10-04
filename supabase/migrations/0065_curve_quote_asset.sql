-- L33 — a curve's raise is denominated in an asset we never recorded.
--
-- The watchlist renders `raised_wei` as "N.NNNN ETH" for every row. On pons-v2
-- the quote asset is chosen PER TOKEN, not per pad: `TokenLaunched.pairToken`
-- is 0x0 for native ETH and an RWA ERC-20 otherwise. Chain-verified 2026-08-24 —
-- TRUTH COIN quotes in DJT, RILIE in GME, OBULL in MSTR. ~29% of the pad.
--
-- 0064's L30 fix corrected the NUMERATOR (progress reads balanceOf on the right
-- asset). It could not correct the UNIT, because there was nowhere to put it.
--
-- decimals is NOT assumed 18: one observed graduation threshold is 8090000000
-- (8.09 gwei), which is a 6- or 8-decimal token. Hardcoding 18 would swap a
-- wrong ticker for a wrong magnitude — §8 #11, a literal where a measurement
-- belongs.
--
-- NULL on all three = native ETH, which is also every pre-existing row. The
-- renderer must therefore treat NULL as "native", never as "unknown, print
-- ETH anyway": pons-v2 rows churn out of the table inside ~16 days
-- (CURVE_STALL_DAYS 2 + CURVE_RETENTION_DAYS 14), so the forward fix reaches
-- the whole live population without a backfill.

alter table public.curve_tokens
  add column if not exists quote_token    text,
  add column if not exists quote_symbol   text,
  add column if not exists quote_decimals smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'curve_tokens_quote_token_check'
  ) then
    alter table public.curve_tokens
      add constraint curve_tokens_quote_token_check
      check (quote_token is null or quote_token = lower(quote_token));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'curve_tokens_quote_decimals_check'
  ) then
    alter table public.curve_tokens
      add constraint curve_tokens_quote_decimals_check
      check (quote_decimals is null or (quote_decimals >= 0 and quote_decimals <= 36));
  end if;
end $$;

comment on column public.curve_tokens.quote_token is
  'ERC-20 the raise is denominated in. NULL = native ETH. L33.';
comment on column public.curve_tokens.quote_symbol is
  'Ticker for display. NULL with a non-null quote_token means symbol() was unreadable — render the address, never "ETH".';
comment on column public.curve_tokens.quote_decimals is
  'decimals() of quote_token. NULL = 18 ONLY when quote_token is also NULL.';
