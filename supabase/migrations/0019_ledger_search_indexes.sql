-- ─────────────────────────────────────────────────────────────
-- 0019 — Ledger search indexes.
--
-- The public Ledger (/ledger) gains a contract search bar that matches on
-- token_address (prefix/substring), token_symbol, and token_name via ILIKE.
-- Plain B-tree indexes (verdicts_token_address_idx) only serve equality and
-- left-anchored LIKE under C-collation — they cannot serve the case-insensitive
-- substring match the search box does. pg_trgm GIN indexes make all three
-- columns fast for ILIKE '%q%'.
--
-- The performance advisor reports NO missing/unindexed-FK problems on this
-- schema, so this migration adds ONLY what the new search feature needs.
-- Every statement is idempotent (if not exists) so a re-run is a no-op.
-- ─────────────────────────────────────────────────────────────

create extension if not exists pg_trgm;

create index if not exists verdicts_token_address_trgm_idx
  on public.verdicts using gin (token_address gin_trgm_ops);

create index if not exists verdicts_token_symbol_trgm_idx
  on public.verdicts using gin (token_symbol gin_trgm_ops);

create index if not exists verdicts_token_name_trgm_idx
  on public.verdicts using gin (token_name gin_trgm_ops);
