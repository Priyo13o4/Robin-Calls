-- Track the observation window and rotate bounded daily LP store cleanup.
alter table public.lp_tracked_pools
  add column if not exists low_depth_since timestamptz,
  add column if not exists prune_checked_at timestamptz;

create index if not exists lp_tracked_pools_prune_checked_idx
  on public.lp_tracked_pools (prune_checked_at nulls first, pool);

create index if not exists verdicts_primary_pool_address_lower_idx
  on public.verdicts (lower(primary_pool_address));

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rc_schedule_job')
     and to_regclass('public.robincalls_job_config') is not null
     and exists (select 1 from public.robincalls_job_config where key = 'site_url')
     and exists (select 1 from public.robincalls_job_config where key = 'job_secret')
  then
    perform public.rc_schedule_job('robincalls-lp-positions-prune', '15 4 * * *', '/api/jobs/lp-positions?task=prune');
  else
    raise notice 'RC_CRON_SKIPPED: schedule robincalls-lp-positions-prune daily after rc_schedule_job and job configuration are available.';
  end if;
end $$;
