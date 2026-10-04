-- Migration: retire robincalls-launch-ingest cron job in favor of realtime sequencer stream
do $$
begin
  if exists (select 1 from cron.job where jobname = 'robincalls-launch-ingest') then
    perform cron.unschedule('robincalls-launch-ingest');
  end if;
end $$;
