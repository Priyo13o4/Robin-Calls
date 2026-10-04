-- The app role could never write a mark.
--
-- `supabase/README.md` provisions `robincalls_app` with SELECT/INSERT/UPDATE/
-- DELETE on ALL TABLES and USAGE/SELECT on ALL SEQUENCES, plus default
-- privileges for both. It never grants EXECUTE on functions. The mark
-- subsystem is the only path that goes through a SECURITY DEFINER function
-- rather than a plain insert, so it was the only thing that broke, and it broke
-- silently: `token_marks` and `mark_events` are EMPTY, and
-- `recordPumpDumpMark` catches its own error, so the only symptom was ~22
-- RC_LEDGER_MARK_PERSIST_FAILED rows a day that nobody read.
--
-- Measured on prod 2026-09-12, as the app role:
--   ERROR: permission denied for function record_token_mark
-- SECURITY DEFINER does not help here. It sets the role the body RUNS as; you
-- still need EXECUTE to make the call at all.
--
-- Why this matters beyond a dead writer (§8 #9): the empty table does not read
-- as "we could not look". `readTokenMarks` returns [], the internal read
-- contract reports found:true, and the answer published is "no honeypot or
-- pump-dump marks stand against this token". A permission error became an
-- all-clear.
--
-- Named functions, not a blanket default privilege. `call_robincalls_job`
-- dispatches a cron job carrying the job secret, and `rc_schedule_job` edits
-- the schedule. Neither is called from the app and neither should be reachable
-- by it, so a blanket `alter default privileges ... grant execute on functions`
-- would hand the app exactly the two it must not have. pg_cron runs those as
-- postgres.
--
-- Idempotent: GRANT is a no-op when already held.

grant execute on function public.record_token_mark(text, text, bigint, jsonb, numeric) to robincalls_app;
grant execute on function public.record_honeypot_mark(text, bigint, jsonb, numeric) to robincalls_app;
grant execute on function public.lift_honeypot_mark(text, text, text) to robincalls_app;
