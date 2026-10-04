-- 0099 — L177 defect 2: rescan a token once after its drain
alter table slow_rug_watch
  add column if not exists rescan_attempts integer not null default 0,
  add column if not exists rescan_last_attempt_at timestamptz,
  add column if not exists rescan_done_at timestamptz;

do $$
begin
  if exists (select 1 from pg_proc where proname = 'rc_schedule_job') then
    perform public.rc_schedule_job(
      'robincalls-drain-rescan',
      '45 * * * *',
      '/api/jobs/drain-rescan'
    );
  end if;
end $$;
