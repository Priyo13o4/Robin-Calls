-- 0085 — per-phase RPC attribution for the curve poll
--
-- curve_poll_runs already records the tick TOTAL (physical_attempts,
-- multicall_batches, multicall_batched_calls). Measured 2026-09-05 those say:
-- 1,273 logical → 371 physical per tick, of which 28 are Multicall batches
-- carrying 930 subcalls and 343 are unbatched 1:1 calls — i.e. ~92% of the
-- physical cost is unbatched, ~296 of it direct eth_call.
--
-- What no column can say is WHICH of the ten phases spends it, so the largest
-- remaining optimisation cannot be aimed. This adds that, keyed by the same
-- phase names `isolate()` already uses for the `degraded` array.
--
-- Shape: {"poolAppearanceSweep": {"physical": 31, "logical": 402, "batches": 28}, ...}
alter table "curve_poll_runs" add column if not exists "phase_calls" jsonb;

comment on column "curve_poll_runs"."phase_calls" is
  'Per-phase RPC spend for this tick, keyed by the phase names used in `degraded`. Written by lib/tracker/curves/poll.ts. Diagnostic only — nothing reads it in a code path.';
