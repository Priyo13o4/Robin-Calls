-- Schedule the launch-retention job (curve/lifecycle rebuild §5.3).
--
-- app/api/jobs/launch-retention/route.ts and runLaunchRetentionBatch
-- (lib/data/launch-candidates.ts) have existed, and ENABLE_LAUNCH_RETENTION=true
-- has been set, since the unified-lifecycle migration (0035) — but no
-- migration ever scheduled the cron row. Verified against production
-- cron.job 2026-07-26: six rows exist (robincalls-anchor, slow-rug,
-- wanted-ingest, tracker-poll, log-retention, curve-poll), none named
-- robincalls-launch-retention, and all six that DO exist are active:true
-- (docs/KNOWN-PROBLEMS.md and docs/prds/launchpad-aggregator-prd.md both claim
-- active:false for the existing rows — that claim is wrong and is corrected
-- alongside this migration, not by it).
--
-- Guarded exactly like 0014's curve-poll schedule so this lands cleanly on a
-- database where 0010's cron prerequisites are absent. Runs daily, offset an
-- hour from log-retention (0 3 * * *) to avoid any contention.
--
-- Before this job can delete anything meaningful, the 7-day clock itself has
-- to be real (curve/lifecycle rebuild §5.2c) — today it would only catch the
-- 4 already-expired rows out of 84,214 (§3.5). Scheduling it here is safe
-- regardless: an empty batch is a no-op (runLaunchRetentionBatch returns
-- immediately when nothing is past expires_at).
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job(
      'robincalls-launch-retention', '0 4 * * *', '/api/jobs/launch-retention');
  else
    raise notice 'RC_CRON_SKIPPED: rc_schedule_job or job config absent — schedule robincalls-launch-retention manually once cron prerequisites (0010) exist.';
  end if;
end $$;

-- launch_tombstones grows forever with no prior index on the column the new
-- pruning pass filters by — add one before the prune job starts running
-- daily deletes against it.
create index if not exists launch_tombstones_original_created_at_idx
  on public.launch_tombstones (original_created_at);
