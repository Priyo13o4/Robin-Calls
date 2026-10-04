-- Curve/lifecycle rebuild §5.7 — collapse the duplicate state representations
-- that 0035 (unified_launch_lifecycle) deliberately left in place "additive
-- only" while the Watchlist migrated over. Now that migration's own
-- call-site audit is done and confirms:
--
--   * curve_token_state (7 columns) was always a strict subset of
--     curve_tokens (19 columns — same 7 plus launchpad_id, name, symbol,
--     creator_address, created_block, peak_progress_bps, creator_buy_wei,
--     status, dex_pool_address, graduated_at). curve_tokens is the table the
--     curve poll actually writes every tick (updateCurveFill); curve_token_state
--     was a second, redundant write on top of it (runMergeTransaction's
--     upsertCurveState) purely to feed the Watchlist join. That join now
--     reads curve_tokens directly instead (lib/data/launch-candidates.ts's
--     readLaunchFeed) — same columns, one fewer table, one fewer write.
--
--   * tracked_launches (the pre-unified-feed shortlist) had exactly one
--     surviving reader anywhere in the app: a bare count() in
--     lib/data/observability.ts's admin stats — readTrackedLaunches itself
--     had zero callers. Every write to it in lib/tracker/poll.ts's
--     pollTracker was already a pure duplicate of the same call's
--     mergeLaunchCandidate (the unified table). The admin stats count now
--     reads launch_candidates (SURFACED/GRADUATED) instead.
--
-- Both tables' writers were removed from the app in the same change as this
-- migration — do not apply this without that deploy, or pollTracker/
-- runMergeTransaction will error against tables that no longer exist.

drop table if exists public.curve_token_state;
drop table if exists public.tracked_launches;

-- The unified walker (§5.5) was gated to one RPC-only eth_getLogs call per
-- tick specifically so this interval could drop safely — verified clean
-- (shared cursor across all 3 pads, zero sync failures/cursor floors) on
-- 2026-07-26 after the §5.5 deploy. Guarded exactly like 0014/0039 so this
-- lands cleanly regardless of whether 0010's cron prerequisites exist.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job(
      'robincalls-curve-poll', '* * * * *', '/api/jobs/curve-poll');
  else
    raise notice 'RC_CRON_SKIPPED: rc_schedule_job or job config absent — reschedule robincalls-curve-poll manually once cron prerequisites (0010) exist.';
  end if;
end $$;
