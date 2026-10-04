-- ─────────────────────────────────────────────────────────────
-- pg_cron jobs (PRD §6): everything serverless, nothing runs 24/7.
--
-- Self-hosted revision (2026-07-20): originally used pg_net + Vault (both
-- ship on hosted Supabase). Self-hosting them meant compiling a Rust
-- toolchain + pgrx from source for pg_net and pgsodium/vault — Supabase's
-- own bespoke extensions, not the mainstream, prebuilt-package kind (unlike
-- e.g. pgvector) — and pgrx didn't even support PG18 yet when this was
-- tried. Not worth it for what it bought: `COPY ... TO PROGRAM` does the
-- same HTTP call with zero extensions (just curl, installed in
-- docker/postgres/Dockerfile), and a plain settings table replaces the 2
-- secrets Vault "encrypted" — the job secret already sits in the app's own
-- env var unencrypted, so a second encrypted copy wasn't real protection.
--
-- BEFORE APPLYING, seed the 2 settings this function reads (site_url should
-- be the INTERNAL docker-compose address, http://app:3000 — postgres calls
-- the app directly over the internal network, no need to round-trip through
-- nginx/cloudflared for its own cron calls):
--   insert into public.robincalls_job_config (key, value) values
--     ('site_url', 'http://app:3000'),
--     ('job_secret', 'YOUR_INTERNAL_JOB_SECRET')
--   on conflict (key) do update set value = excluded.value;
-- ─────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

create table if not exists public.robincalls_job_config (
  key text primary key,
  value text not null
);
-- No `anon`/`authenticated` roles on this self-hosted instance — those were
-- Supabase-platform roles for PostgREST callers, and this deployment never
-- runs PostgREST. PUBLIC always exists and is the only grantee that matters
-- here: nothing but pg_cron (running as postgres) should touch this table.
revoke all on public.robincalls_job_config from public;

-- helper: POST to a RobinCalls job route with the shared secret, via a
-- shelled-out curl rather than an HTTP-capable extension. Safe here because
-- both interpolated values are operator-set (this migration's INSERT above),
-- never user input — but they must not contain a single quote, since %L's
-- SQL-literal quoting isn't shell quoting (doubles embedded ' for SQL, not
-- the \' shell needs). A hex job secret and a plain http:// URL never do.
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
    'curl -fsS -m 30 -X POST -H %L -H %L -d %L %L',
    'content-type: application/json',
    'x-job-secret: ' || job_secret,
    '{}',
    site_url || path
  );
  execute format('copy (select 1) to program %L', cmd);
end;
$$;

-- revoke public execution — cron runs as postgres. No anon/authenticated
-- roles here (see robincalls_job_config's revoke above) — PUBLIC covers it.
revoke execute on function public.call_robincalls_job(text) from public;

-- anchor the ledger head every 6 hours (gas ≈ free, PRD budget ~$25/yr)
select cron.schedule(
  'robincalls-anchor',
  '0 */6 * * *',
  $$select public.call_robincalls_job('/api/jobs/anchor')$$
);

-- market poller cadence (§6 says 60s; start at 5 min until GeckoTerminal
-- free-tier limits are verified — PRD open item §11.4, then tighten)
-- select cron.schedule(
--   'robincalls-market-poll',
--   '*/5 * * * *',
--   $$select public.call_robincalls_job('/api/jobs/market-poll')$$
-- );
