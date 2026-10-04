-- Fix KNOWN-PROBLEMS L152: job secret exposure in pg_cron logs.
--
-- In 0002_cron.sql, `public.call_robincalls_job(path)` constructed a curl
-- command interpolating `-H 'x-job-secret: <SECRET>'` directly into the
-- command string executed by `COPY ... TO PROGRAM cmd`.
-- When a job fails, pg_cron records the error in `cron.job_run_details.return_message`.
-- Postgres includes the full COPY-program command line in that error message,
-- leaking the internal job secret in plaintext to anyone with database read access.
--
-- The fix: curl supports reading headers from stdin via `-H @-` (curl >= 7.55).
-- `COPY (select ...) TO PROGRAM cmd` pipes query output into the program stdin.
-- We select `'x-job-secret: ' || job_secret` as the query, so curl receives
-- the header via stdin while the command string remains free of secrets.
--
-- Existing rows in `cron.job_run_details` carrying the secret are NOT removed
-- by this migration. Purging historical run details is an operator task,
-- not a migration, to avoid deleting history automatically.
--
-- Scheduled jobs in `cron.schedule` call `public.call_robincalls_job(path)` by
-- name and pick up the updated function definition without rescheduling.

create or replace function public.call_robincalls_job(path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  site_url text;
  job_secret text;
  cmd text;
begin
  select value into site_url from public.robincalls_job_config where key = 'site_url';
  select value into job_secret from public.robincalls_job_config where key = 'job_secret';

  if site_url is null or job_secret is null then
    raise exception 'robincalls job config missing — seed public.robincalls_job_config (see this file''s header)';
  end if;

  cmd := format(
    'curl -fsS -m 30 -X POST -H %L -H @- -d %L %L',
    'content-type: application/json',
    '{}',
    site_url || path
  );
  execute format('copy (select %L) to program %L', 'x-job-secret: ' || job_secret, cmd);
end;
$$;

revoke execute on function public.call_robincalls_job(text) from public;
