-- 0067: per-provider RPC usage on scan_runs (docs/KNOWN-PROBLEMS.md L40).
--
-- `recordRpcAttempt` has always been handed a providerId and always thrown it
-- away — it used the value once, to compare against firstProviderId and bump
-- rpc_provider_switches. So no column, table or log said WHO served a call, and
-- "is goldsky getting used at all?" had to be answered by inference.
--
-- The only per-provider trace we kept is `provider_states`, and provider-pool
-- writes that EXCLUSIVELY on denial (SATURATED / THROTTLED). That is correct
-- for its own purpose but makes absence meaningless: a provider missing from it
-- is either perfectly healthy or completely unused, and the map cannot tell you
-- which. The two columns are complements, never substitutes — reading one for
-- the other is the mistake this migration exists to end.
--
-- Shape: {"<provider-id>": {"n": attempts, "err": transport-errors, "ms": latency}}
-- mirroring rpc_method_counts / explorer_endpoint_counts rather than inventing
-- a fourth convention.
--
-- NULL vs {} is load-bearing (CLAUDE.md §4). NULL means this scan made no RPC
-- attempt at all — we never looked. A non-null map means attempts happened, so
-- a provider ABSENT from it served nothing, which is now an unambiguous
-- reading rather than the two-meaning absence `provider_states` has.

alter table scan_runs add column if not exists provider_calls jsonb;

comment on column scan_runs.provider_calls is
  'Per-provider RPC usage {id:{n,err,ms}} for attempts that were SERVED. Complements provider_states, which records only denials. NULL = no RPC attempted this scan; absent key in a non-null map = that provider served nothing.';
