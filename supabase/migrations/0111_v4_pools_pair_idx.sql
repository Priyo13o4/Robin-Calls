-- Pair lookup for the swap catalogue (readSwapV4Pools). Native ETH is currency0 of a large share of pools,
-- so the planner assumes independence, estimates ~38k rows for a 570-row pair and seq-scans 950k rows.
-- The pair index plus MCV statistics on the pair bring the read to ~2 ms (measured locally 2026-10-03).
create index if not exists v4_pools_pair_idx on v4_pools (currency0, currency1);
create statistics if not exists v4_pools_pair_stats (mcv) on currency0, currency1 from v4_pools;
alter statistics v4_pools_pair_stats set statistics 2000;
analyze v4_pools;
