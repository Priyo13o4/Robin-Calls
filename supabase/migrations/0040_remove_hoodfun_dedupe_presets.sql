-- Remove hoodfun entirely (curve/lifecycle rebuild §5.6a) + de-duplicate the
-- adapter-preset list (§5.9c).
--
-- hood-v1 is being removed because the pad is dead — its newest token sits
-- at block 17,893,201 while flapsh (19,270,220) and pons (19,270,783) launch
-- continuously (~1.38M blocks / ~1.6 days of silence, verified 2026-07-26) —
-- and because curve_tokens has no retention: 10,566 hoodfun rows accumulated
-- since block 5,616,186, and the recent sample is wall-to-wall bot spam
-- (SNIPE DEVONLY / KEEPDEV / NUKE / EARLY, 2 buys + 2 sells each, clustered
-- around block 12.2M) — not a decoding bug (0 nulls of 10,566 names/symbols).
-- hood.fun's own site shows ~175 real launches. Removing hood-v1 also drops
-- one of the two Multicall3 view-read paths in the curve poll (the other,
-- pons-v1, was switched to lib/rpc/multicall.ts's batchRead in the same pass
-- this migration ships with).
--
-- Order matters: launch_candidates.launchpad_id is ON DELETE SET NULL (so a
-- straight `delete from launchpads` would leave source_kind='LAUNCHPAD' rows
-- with launchpad_id=NULL — no pad name, no tab filter match). Delete
-- dependents explicitly, in FK order, before the pad row itself.
-- curve_tokens.launchpad_id IS `ON DELETE CASCADE` already, so its explicit
-- delete below is a no-op safety net, not load-bearing.

delete from public.launch_candidates
where launchpad_id = (select id from public.launchpads where slug = 'hoodfun');

delete from public.curve_tokens
where launchpad_id = (select id from public.launchpads where slug = 'hoodfun');

delete from public.launchpads where slug = 'hoodfun';

-- Preset list de-dup (§5.9c): the DB check previously allowed only
-- ('curve-events-v1','hood-v1','flap-v1','pons-v1') — FOUR of the five
-- presets actually implemented in lib/tracker/curves/adapters/, so
-- stoxes-v1 could never be inserted even though its adapter has existed and
-- worked since before this migration. That was the actual bug; the fix is
-- to add it, not to delete working code. hood-v1 is dropped (removed above).
-- Constraint checks must be dropped and re-added, never altered in place.
alter table public.launchpads drop constraint launchpads_adapter_check;
alter table public.launchpads add constraint launchpads_adapter_check
  check (adapter = ANY (ARRAY['curve-events-v1'::text, 'flap-v1'::text, 'pons-v1'::text, 'stoxes-v1'::text]));
