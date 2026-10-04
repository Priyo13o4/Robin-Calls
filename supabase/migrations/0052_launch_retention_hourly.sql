-- Launch retention runs hourly, not daily.
--
-- The job has been correct and under-provisioned since 0039. Measured on
-- production 2026-08-06:
--
--   capacity  = retentionBatchSize(200) × maxBatches(25) × 1 run/day =  5,000/day
--   arrivals  = 10,495 … 15,773/day over the prior week,  mean      = ~13,700/day
--
-- So it lost roughly 9,000 rows of ground every day, forever. The result:
-- **133,401 rows past `expires_at` and undeleted — 61 MB, about a quarter of
-- the entire 236 MB database** (HANDOFF F6). Nothing alerted, because every
-- individual run succeeded; the job was never failing, only losing.
--
-- Hourly turns the same batch numbers into 120,000/day — ~8.5x the arrival
-- rate, which clears the accumulated backlog in a bit over a day and then
-- keeps a wide margin for missed runs. The margin is the point: a job sized to
-- exactly match inflow never recovers from a backlog or an outage.
--
-- Nothing else changes. `runLaunchRetentionBatch` already tombstones before
-- deleting, and `pruneExpiredLaunchTombstones` already runs in the same
-- invocation, so a more frequent schedule is purely more of the same work.
--
-- Note on `launch_tombstones` reading 0 rows: that is CORRECT, not a bug. The
-- prune deletes each tombstone in the same run that creates it, because
-- `original_created_at` is always >= 7 days old by then.

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    -- rc_schedule_job unschedules any existing job of the same name first, so
    -- this is a reschedule rather than a duplicate.
    perform public.rc_schedule_job(
      'robincalls-launch-retention', '0 * * * *', '/api/jobs/launch-retention');
  else
    raise notice 'RC_CRON_SKIPPED: rc_schedule_job or job config absent — reschedule robincalls-launch-retention to hourly manually.';
  end if;
end $$;
