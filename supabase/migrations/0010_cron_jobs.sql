-- ─────────────────────────────────────────────────────────────
-- 0010 — schedule the job routes that shipped after 0002.
--
-- 0002 created `public.call_robincalls_job(path)` and scheduled only
-- `robincalls-anchor`. Everything built since (The Watch, the Tracker rework,
-- log retention, Wanted ingestion) has had no cron behind it, so those routes
-- have only ever run when invoked by hand.
--
-- PREREQUISITES — this migration fails loudly if they are missing:
--   1. public.robincalls_job_config (0002) must be seeded:
--        insert into public.robincalls_job_config (key, value) values
--          ('site_url', 'http://app:3000'),
--          ('job_secret', 'YOUR_INTERNAL_JOB_SECRET')
--        on conflict (key) do update set value = excluded.value;
--      site_url is the INTERNAL docker-compose address (postgres calls the
--      app directly over the internal network — see 0002's header).
--   2. The matching env vars must be live on the deployment:
--        INTERNAL_JOB_SECRET          (all jobs — 401 without it)
--        ENABLE_SLOW_RUG_MONITOR=true (slow-rug 403s without it)
--        ENABLE_WANTED_INGESTION=true (wanted-ingest 403s without it)
--      A 403 from a disabled flag is a no-op, not a failure — the schedule is
--      safe to land before the flags flip.
--
-- Idempotent: unschedules each job if present, then schedules it. Safe to
-- re-run; safe to apply before the flags are on.
-- ─────────────────────────────────────────────────────────────

do $$
declare
  missing text[] := '{}';
begin
  if not exists (select 1 from public.robincalls_job_config where key = 'site_url') then
    missing := missing || 'site_url';
  end if;
  if not exists (select 1 from public.robincalls_job_config where key = 'job_secret') then
    missing := missing || 'job_secret';
  end if;
  if array_length(missing, 1) > 0 then
    raise exception
      'RC_CRON_CONFIG_MISSING: public.robincalls_job_config key(s) % absent. Seed them (see the header of this migration) before scheduling — pg_cron would otherwise fire requests that can never authenticate.',
      array_to_string(missing, ', ');
  end if;
end $$;

-- Re-scheduling helper: cron.unschedule throws when the job is absent, which
-- would abort the migration on a fresh database. Guard on the catalog instead.
create or replace function public.rc_schedule_job(job_name text, schedule text, path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from cron.job where jobname = job_name) then
    perform cron.unschedule(job_name);
  end if;
  perform cron.schedule(
    job_name,
    schedule,
    format('select public.call_robincalls_job(%L)', path)
  );
end;
$$;

-- No anon/authenticated roles on this self-hosted instance (see 0002) —
-- PUBLIC is the only grantee that matters here.
revoke execute on function public.rc_schedule_job(text, text, text) from public;

-- ── Security hardening (advisor finding, originally written against
--    PostgREST — kept as defense in depth even though this self-hosted
--    instance never runs PostgREST at all) ──────────────────────────────
-- call_robincalls_job (created in 0002) is SECURITY DEFINER and attaches the
-- internal job secret itself. Only pg_cron (running as postgres, which
-- bypasses grants entirely) should call it — lock everyone else out.
revoke execute on function public.call_robincalls_job(text) from public;

-- ── The Watch (§4.3) — hourly. Observes liquidity, writes one snapshot per
--    token per hourly bucket, flags drains, marks pump-and-dumps. The hourly
--    cadence IS the snapshot bucket size; changing it changes the time series.
select public.rc_schedule_job('robincalls-slow-rug', '0 * * * *', '/api/jobs/slow-rug');

-- ── Wanted Board ingestion (§7.6) — hourly at :30, deliberately offset from
--    the slow-rug job so it judges evidence The Watch has already written this
--    hour rather than racing it. Empty body = self-assembling mode.
select public.rc_schedule_job('robincalls-wanted-ingest', '30 * * * *', '/api/jobs/wanted-ingest');

-- ── Tracker poll — every 10 minutes. Resumable via factory_cursor (0009), so a
--    missed run costs latency, not coverage.
select public.rc_schedule_job('robincalls-tracker-poll', '*/10 * * * *', '/api/jobs/tracker-poll');

-- ── Log retention — daily at 03:00 UTC, off-peak.
select public.rc_schedule_job('robincalls-log-retention', '0 3 * * *', '/api/jobs/log-retention');

-- Verify what landed:
--   select jobname, schedule, active from cron.job order by jobname;
-- Inspect recent runs (each run's curl exit status, not just cron status):
--   select * from cron.job_run_details order by start_time desc limit 20;
