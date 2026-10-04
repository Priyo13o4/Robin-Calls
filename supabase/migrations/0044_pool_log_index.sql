-- Durable store for the full-history log index (log-index rework §7 step 2).
--
-- The index has lived in Valkey under a 7-day TTL. Event history is append-only
-- and immutable, so a TTL on it is a category error — and that TTL was the
-- entire source of the RPC blow-up: every key expired on a 7-day cycle, and by
-- the time it did, the "incremental" top-up spanned millions of blocks. Measured
-- live 2026-08-01: all 69 rc:v2:logidx:* keys were 101-164h old, and one gap was
-- 5,209,532 blocks = 512 sequential eth_getLogs windows.
--
-- Durable rows mean the genesis->head fill happens ONCE PER POOL, EVER. They
-- also downgrade an explorer outage from fatal to degraded: today a cold read
-- with no cache and no explorer is RC_EXPLORER_UNAVAILABLE -> 503 with no
-- verdict (667 occurrences in 21 days); with a stored prefix the scan serves
-- what it has and flags complete:false.
--
-- This is NOT an indexer pipeline. It adds one table on the Postgres we already
-- run, back up and migrate — no new service, stream or daemon. The Goldsky
-- Mirror landing DB remains dead by decision.
--
-- Storage, measured off the live Valkey corpus rather than estimated: 69
-- indexes = 1.3 MB raw JSON, ~0.4 MB once TOASTed and pglz-compressed. The
-- database is 185 MB today. Projected ~150 MB at ~10k tokens scanned.

create table if not exists public.pool_log_index (
  -- The call site's own key, e.g. 'v3mint:0x…' / 'v4mod:0x…'. Stable per
  -- (site, subject); the schema version that used to be baked into the Valkey
  -- key prefix is now this table's identity.
  cache_key   text primary key,
  -- Inclusive upper bound of verified coverage. numeric, not bigint: block
  -- numbers are bigint-safe today but this column is written from a JS BigInt
  -- and read back through fromNumericString, matching how every other chain
  -- quantity in this schema is stored.
  last_block  numeric not null,
  -- The call site's already-mapped rows, NOT raw logs. Callers re-derive
  -- everything mutable (current owners, live liquidity) on every scan, so this
  -- can only ever save the append-only event read — it can never freeze a
  -- stale conclusion (CLAUDE.md §4).
  -- jsonb (not json/text): it compresses and it is the shape we want. Note it
  -- normalizes OBJECT KEY ORDER — array order and values survive, key order
  -- does not. No consumer depends on key order; keep it that way.
  rows        jsonb   not null,
  updated_at  timestamptz not null default now()
);

-- Supports the future retention sweep ("drop indexes for pools not scanned in
-- N months"); a dropped index costs exactly one explorer call to refill. Not
-- needed at current magnitudes, but the index is free to add now and awkward to
-- add later against a large table.
create index if not exists pool_log_index_updated_at_idx
  on public.pool_log_index (updated_at);

-- Plain Postgres: no RLS, no policies, no anon/authenticated grants. This runs
-- on our own Postgres, reached only by the server through lib/data/log-index —
-- there is no client role to defend against here. (The pgPolicy lines still
-- visible in lib/db/schema.ts are dead introspection output from before the
-- move; do not copy them into new tables.) Adding RLS would at best be a no-op
-- and at worst silently return zero rows on every read — the invisible failure
-- this table exists to end.
