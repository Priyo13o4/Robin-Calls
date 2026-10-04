-- Additive scan_runs columns for Multicall3 batch observability
-- (docs/ways-of-work/plan/contract-audit/full-contract-authority-audit/
-- implementation-plan.md's observability requirement; tracked unfulfilled as
-- docs/KNOWN-PROBLEMS.md C5). Populated by lib/observability/context.ts's
-- `recordMulticallBatch`/`recordMulticallFallback`, wired from
-- lib/rpc/multicall.ts's `batchRead`. Nullable, no data migration, no
-- existing column/scoring/verdict shape changes.

alter table public.scan_runs
  add column if not exists multicall_batches integer,          -- physical batches that landed
  add column if not exists multicall_batched_calls integer,     -- sum of calls those batches carried (batch size = this / multicall_batches)
  add column if not exists multicall_subcall_failures integer,  -- reverted (not faulted) subcalls inside a landed batch
  add column if not exists multicall_fallback_count integer;    -- chunks that fell back to individual eth_calls
