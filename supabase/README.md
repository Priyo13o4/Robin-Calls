# RobinCalls — database schema

## Fresh self-hosted Postgres baseline

The production target is plain Postgres behind pgbouncer on the private Docker
network. It does not run PostgREST, GoTrue, or Supabase database roles; the
application is the sole database client. Migrations are intentionally applied
manually during first VPS provisioning rather than by a long-running Compose
service.

Start only Postgres, then create the application login using the password that
also appears in `APP_DB_PASSWORD` and the pgbouncer SCRAM user list:

```bash
docker compose up -d postgres
docker compose exec postgres psql -U postgres -d robincalls
```

```sql
create role robincalls_app login password 'replace-with-APP_DB_PASSWORD';
```

In a second terminal, apply `0001` through `0009`, seed the cron settings,
then apply `0010` and every later migration except `0011_pre_launch_reset`.
That file is a deliberate destructive reset, not a normal bootstrap step.

```bash
for migration in supabase/migrations/000{1,2,3,4,5,6,7,8,9}_*.sql; do
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d robincalls < "$migration" || exit 1
done

# Use the real INTERNAL_JOB_SECRET. `http://app:3000` is intentionally an
# internal Docker-network URL, never the public domain.
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d robincalls <<'SQL'
insert into public.robincalls_job_config (key, value) values
  ('site_url', 'http://app:3000'),
  ('job_secret', 'replace-with-INTERNAL_JOB_SECRET')
on conflict (key) do update set value = excluded.value;
SQL

for migration in supabase/migrations/001{0,2,3,4,5,6,7,8,9}_*.sql supabase/migrations/002{0,1,2,3,4,5,6,7,8,9}_*.sql supabase/migrations/003{0,1,2}_*.sql; do
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d robincalls < "$migration" || exit 1
done
```

After the schema is in place, grant the application role access. Re-run the
table and sequence grants after any future migration that creates a table.

```sql
grant usage on schema public to robincalls_app;
grant select, insert, update, delete on all tables in schema public to robincalls_app;
grant usage, select on all sequences in schema public to robincalls_app;
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to robincalls_app;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to robincalls_app;
```

**Functions need their own grant, and this step was missing until 2026-09-12.**
Tables and sequences above do not cover functions, so the app could not call
the mark writers at all: `token_marks` and `mark_events` sat EMPTY in
production while `recordPumpDumpMark` swallowed `permission denied for function
record_token_mark` into about 22 reported errors a day that nobody read. Being
SECURITY DEFINER does not help, because that sets the role the body runs as and
you still need EXECUTE to make the call.

```sql
grant execute on function public.record_token_mark(text, text, bigint, jsonb, numeric) to robincalls_app;
grant execute on function public.record_honeypot_mark(text, bigint, jsonb, numeric) to robincalls_app;
grant execute on function public.lift_honeypot_mark(text, text, text) to robincalls_app;
```

Grant functions BY NAME. Do not add a blanket
`alter default privileges ... grant execute on functions`: `call_robincalls_job`
dispatches a cron job carrying the job secret and `rc_schedule_job` edits the
schedule, so a blanket grant hands the app the two functions it must never
reach. `0091_grant_execute_mark_functions.sql` carries the same three grants, so
a fresh build that applies every migration is already correct; this block is for
a role provisioned by hand.

When you add a stored function the app calls, add its grant here in the same
pass. The failure mode is silent: the app sees a permission error, the table
stays empty, and an empty table reads downstream as "nothing stands against
this token" rather than "we could not write" (CLAUDE.md §8 #9).

`0011_pre_launch_reset.sql` is only for intentionally wiping scan-derived
records before launch. If that is ever required, run it in its own `psql`
session after `set robincalls.confirm_reset = 'RESET';`; it is never part of a
normal schema deployment.

## Security model

- There is no PostgREST, GoTrue, Supabase RLS policy, `anon`, or
  `authenticated` role in the self-hosted target.
- Postgres is private to the Docker network. The Next.js application connects
  as the least-privilege `robincalls_app` role through pgbouncer.
- nginx is the only HTTP service exposed to a Cloudflare Tunnel; Postgres,
  pgbouncer, Valkey, and the application container have no public ports.
- The ledger remains independently tamper-evident because entries are
  hash-chained and periodically anchored on-chain.

`0002_cron.sql` and later migrations use `public.robincalls_job_config` for
the job URL and secret; seed it in the bootstrap command above, not in a
Supabase Vault.

## Registry sync

`docs.robinhood.com/chain/contracts` is HTML, so the sync is a curated push:
POST the parsed asset list to `/api/jobs/registry-sync` with the
`x-job-secret` header (see the route's docblock for the JSON shape).
