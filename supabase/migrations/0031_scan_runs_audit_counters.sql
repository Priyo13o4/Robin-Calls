-- Additive scan_runs columns for the contract/authority audit's own resource
-- accounting (docs/ways-of-work/plan/contract-audit/full-contract-authority-audit/
-- implementation-plan.md, "Vercel Hobby Strategy"). Populated by the audit
-- check once wired in (see lib/audit/audit-check.ts); no existing column,
-- scoring, or verdict shape changes.

alter table public.scan_runs
  add column if not exists audit_cpu_ms integer,
  add column if not exists audit_extra_rpc_calls integer,
  add column if not exists audit_explorer_calls integer,
  add column if not exists audit_cache_status text,       -- 'hit' | 'miss' | 'partial'
  add column if not exists audit_targets_analyzed integer,
  add column if not exists audit_truncation_reason text;  -- 'depth-cap' | 'facet-cap' | 'cpu-budget' | 'rpc-budget' | 'explorer-unavailable' | ...
