-- Periodic historical backfill of Uniswap V4 PoolManager Initialize events.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-v4-pool-backfill', '*/5 * * * *', '/api/jobs/v4-pool-backfill');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-v4-pool-backfill after job configuration is available.';
  end if;
end $$;
