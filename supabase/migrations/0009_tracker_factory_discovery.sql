-- 0009 — Tracker factory-event discovery (scan-capacity PRD §11.8, Wave C part 2)
--
--   * factory_cursor: per-factory last-processed block, so incremental
--     PairCreated/PoolCreated polling is resumable and never re-scans history.
--   * tracked_launches: provenance (which DiscoverySource surfaced a token) and
--     tradability (TRADABLE = a DEX pool exists; PRE_DEX = still on a launchpad
--     bonding curve, surfaced by a launchpad adapter before any pool).
--
-- Apply AFTER 0008. Independent of the receipt-policy tables (0007). The
-- existing GeckoTerminal /new_pools poller keeps working as a fallback source.

-- ── 1. factory_cursor: resumable eth_getLogs bookmark per factory ──
create table if not exists public.factory_cursor (
  factory_address text primary key,
  protocol text not null check (protocol in ('uniswap-v2', 'uniswap-v3')),
  -- Highest block whose factory events have been fully processed.
  last_processed_block bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- ── 2. tracked_launches: discovery provenance + tradability ──
alter table public.tracked_launches
  add column if not exists discovery_source text,
  add column if not exists tradability text
    check (tradability in ('TRADABLE', 'PRE_DEX'));

-- factory_cursor is operational state and only reachable through the private
-- application DB connection; no Supabase/PostgREST RLS roles are present.
