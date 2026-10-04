-- ─────────────────────────────────────────────────────────────
-- 0011 — PRE-LAUNCH RESET. Destroys the entire scan record.
--
-- WHY: every verdict in the database was produced by formula v1.0–v1.4, before
-- the §15.9 / §15.7 scoring fixes. Those runs falsely condemned tokens (global
-- deployer history indicting unrelated launches, canonical infra judged with
-- meme-token rules, pool-scoped LP custody). The Ledger's promise is that any
-- receipt is re-derivable against the exact rules that produced it — shipping a
-- public chain full of verdicts the current engine disagrees with breaks that
-- promise on day one. Permanent `token_marks` make it worse: a false pump_dump
-- mark follows a token forever, and lifting it leaves a record implying it was
-- once true.
--
-- THIS IS ONLY SAFE BEFORE LAUNCH. It is gated twice, deliberately:
--   1. Explicit confirmation — a routine `migrate` run must never fire this.
--   2. `anchors` must be EMPTY. Once a chain head is published on-chain, the
--      record is externally committed and wiping it is no longer cleanup, it is
--      rewriting history. The guard makes that structurally impossible.
--
-- TO RUN (both statements, same session):
--   set robincalls.confirm_reset = 'RESET';
--   -- then execute the rest of this file
--
-- AFTER RUNNING — FLUSH UPSTASH. The cooldown cache holds complete verdict
-- bodies (up to SCAN_RESULT_CACHE_SECONDS, default 900s) that reference receipt
-- ids this migration just deleted. Serving those would show receipts that no
-- longer exist. Flush the Redis DB, or wait out the TTL before opening traffic:
--   redis-cli --tls -u "$UPSTASH_REDIS_REST_URL" flushdb   (or Upstash console)
--
-- PRESERVED (not test residue — do not confuse these with scan output):
--   user / session / account / verification  — Better Auth admin login
--   directory_platforms                      — human-curated listings
--   launchpads                               — admin-curated launchpad registry (0014);
--                                              rows kept, but last_processed_block is
--                                              rewound to 0 so the feed re-bootstraps
--   site_config                              — admin-curated key/value config (0017)
--   trusted_lockers                          — admin-curated LP-locker allowlist (0024)
--   registry                                 — canonical asset registry cache
--
-- CORRECTED 2026-07-19: `bytecode_templates` used to be listed above as
-- "seeded detection reference data" — that was wrong. There is no seed
-- migration for its contents; lib/scanner/clone.ts upserts a row on every
-- newly-seen bytecode hash during a live scan (verified: first_seen_token on
-- live rows points at real scanned tokens, not seed fixtures). It's test/dev
-- residue exactly like tokens/deployers/verdicts and is now truncated below.
--
-- ADDED 2026-07-19 (migrations 0012–0024 landed after this file was written
-- and introduced more scan-output tables it didn't know about):
--   curve_tokens        — per-token bonding-curve tracking state (0014), same
--                         category as tracked_launches. By far the largest
--                         table in the DB pre-launch (~7k rows / ~120MB, almost
--                         entirely TOASTed metadata_uri values).
--   scan_uncertainties  — per-scan diagnostic log (0024), same category as
--                         scan_runs/app_error_events; its last_verdict_id /
--                         last_scan_id would otherwise dangle post-reset.
--   whitelist_members,
--   whitelist_events    — whitelist onboarding (0012+). Wiped deliberately: any
--                         signups collected before the real launch are test
--                         data, not allocation-worthy entries.
--
-- NOT LISTED because it no longer exists: `formula_versions` is dropped by
-- migration 0013 (nothing read it and its drift was unrepairable). If 0013 has
-- not been applied yet, this reset leaves the table and its stale 1.0/1.1 rows
-- untouched — harmless either way, since nothing queries it.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if current_setting('robincalls.confirm_reset', true) is distinct from 'RESET' then
    raise exception
      'RC_RESET_NOT_CONFIRMED: 0011 wipes the entire scan record and is not part of a routine migration. Run `set robincalls.confirm_reset = ''RESET'';` in this session first if you truly intend this.';
  end if;

  if exists (select 1 from public.anchors) then
    raise exception
      'RC_RESET_ANCHORED: the ledger has % on-chain anchor(s). The chain head is publicly committed, so this reset would rewrite a published record. Refusing.',
      (select count(*) from public.anchors);
  end if;
end $$;

-- One statement: these tables reference each other (verdicts ← anchors,
-- mark_events, scan_runs, token_marks, token_scan_state; deployers ← tokens,
-- rugs; tokens ← rugs; rugs ← wallet_stains), and truncating them together
-- satisfies every FK at once. Deliberately NO CASCADE — if a future table
-- references one of these and is missing from this list, this must fail loudly
-- rather than silently wipe it too.
--
-- RESTART IDENTITY resets verdicts.id, so the first post-launch receipt is #1.
truncate table
  public.verdicts,
  public.anchors,
  public.mark_events,
  public.token_marks,
  public.token_scan_state,
  public.scan_runs,
  public.tokens,
  public.deployers,
  public.rugs,
  public.wallet_stains,
  public.wallet_edges,
  public.wallet_hubs,
  public.market_snapshots,
  public.slow_rug_watch,
  public.tracked_launches,
  public.factory_cursor,
  public.app_error_events,
  public.bytecode_templates,
  public.scan_uncertainties,
  public.curve_tokens,
  public.whitelist_members,
  public.whitelist_events
restart identity;

-- The launchpad registry is PRESERVED (its rows are admin-curated config, not
-- scan output), but its getLogs cursors must rewind: curve_tokens was just
-- truncated, and a cursor left at its pre-reset height would make the next poll
-- resume from there and only see NEW launches — the graduating-soon feed would
-- sit empty until fresh tokens trickle in. Zeroing last_processed_block makes
-- the first post-reset poll re-bootstrap each pad (a bounded recent-window walk,
-- per adapter), so the feed rebuilds on its own with no admin "RESET CURSOR".
update public.launchpads set last_processed_block = 0, updated_at = now();

-- Usage counters from testing. Reset the values rather than truncating: the
-- rows are well-known keys the app increments, not scan output.
update public.compare_stats set value = 0, updated_at = now();

-- Verify the slate is clean (every count must be 0):
--   select 'verdicts' t, count(*) from public.verdicts
--   union all select 'tokens', count(*) from public.tokens
--   union all select 'deployers', count(*) from public.deployers
--   union all select 'token_marks', count(*) from public.token_marks
--   union all select 'scan_runs', count(*) from public.scan_runs
--   union all select 'curve_tokens', count(*) from public.curve_tokens
--   union all select 'bytecode_templates', count(*) from public.bytecode_templates
--   union all select 'scan_uncertainties', count(*) from public.scan_uncertainties
--   union all select 'whitelist_members', count(*) from public.whitelist_members;
-- And that the keepers survived (each must be non-zero):
--   select 'admin' t, count(*) from public."user"
--   union all select 'listings', count(*) from public.directory_platforms
--   union all select 'launchpads', count(*) from public.launchpads;
