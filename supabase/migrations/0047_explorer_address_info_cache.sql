-- Read-through cache for the explorer's /addresses/:id response.
--
-- Measured on prod 2026-08-02: this ONE call costs 3.0-5.6s of wire time and is
-- the longest read in pipeline.ts's opening Promise.all, so it sets the floor
-- for that whole gather block. Every fresh scan pays it again for a token whose
-- deployer, creation tx and contract-ness cannot change.
--
-- WHAT IS AND IS NOT SAFE TO SERVE STALE
--
-- Most of the payload is immutable for a deployed contract: is_contract,
-- creation_tx_hash, creator_address_hash. Two fields are not — `is_scam` and
-- `public_tags` — and they feed checkExplorerScamFlag, a CRITICAL check. A hit
-- therefore CAN serve a scam flag raised after the entry was written.
--
-- That is a deliberate, bounded trade rather than an oversight: Blockscout's
-- scam tags are human-curated and lag the underlying event by days, so an hour
-- of cache adds little on top of the source's own latency. The TTL is env
-- tunable (EXPLORER_ADDRESS_INFO_TTL_MINUTES) precisely so it can be cut to
-- zero without a deploy if that judgement ever stops holding.
--
-- Only SUCCESSFUL, non-null reads are written. A fault must never be cached as
-- a fact (CLAUDE.md §4) — an unreachable explorer keeps returning null and the
-- pipeline's existing gate handles it exactly as before.
--
-- Plain Postgres: no RLS, no policies, no anon/authenticated grants. This
-- deployment is self-hosted and the app connects as its own role.

create table if not exists public.explorer_address_info_cache (
  address     text primary key,
  payload     jsonb not null,
  fetched_at  timestamptz not null default now()
);

-- Sweeping expired rows scans by age, never by key.
create index if not exists explorer_address_info_cache_fetched_at_idx
  on public.explorer_address_info_cache using btree (fetched_at);

comment on table public.explorer_address_info_cache is
  'Read-through cache of explorer /addresses/:id. Bounded by EXPLORER_ADDRESS_INFO_TTL_MINUTES; holds successful reads only, never faults. is_scam/public_tags can be up to one TTL stale by design — see migration 0047.';
