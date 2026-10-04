-- Track up to 100 eligible graph pools per run while the feature flag is enabled.
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-lp-positions-graph', '25 * * * *', '/api/jobs/lp-positions?task=graph');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-lp-positions-graph after job configuration is available.';
  end if;
end $$;
