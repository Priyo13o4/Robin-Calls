-- Trade-page token resolution by pool (findTokenForRender steps 3 and 4) and the home page's 24h graduation
-- count were full scans of launch_state (~500k rows) and launch_events (~300k), ~15 per minute on prod.
create index if not exists launch_state_market_pool_idx on launch_state (market_pool_address) where market_pool_address is not null;
create index if not exists launch_events_pool_ref_idx on launch_events (pool_ref) where pool_ref is not null;
create index if not exists launch_events_kind_occurred_idx on launch_events (kind, occurred_at);
