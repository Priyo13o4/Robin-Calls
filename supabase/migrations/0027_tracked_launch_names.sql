-- Persist both halves of token identity. token_symbol is the ticker ($MONK);
-- token_name is the human-readable project name (Meme Monk). Metadata is
-- resolved once by the tracker and reused by every watchlist visitor.
alter table public.tracked_launches
  add column if not exists token_name text;
