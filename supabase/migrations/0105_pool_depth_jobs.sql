-- Migration 0105: schedule pool depth refresh jobs (route graph phase 2).
-- robincalls-pool-depth-hot runs every 5 minutes for active and recently touched pools.
-- robincalls-pool-depth-full runs weekly: a safety net, since the recorder queues every pool whose liquidity changes.

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-pool-depth-hot', '*/5 * * * *', '/api/jobs/pool-depth?tier=hot');
    perform public.rc_schedule_job('robincalls-pool-depth-full', '41 3 * * 0', '/api/jobs/pool-depth?tier=full');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-pool-depth-hot and robincalls-pool-depth-full after rc_schedule_job and job configuration are available.';
  end if;
end $$;
