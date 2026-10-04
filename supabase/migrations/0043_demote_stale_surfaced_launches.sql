-- Curve/lifecycle rebuild §5.2e — one-off cleanup, gated on the env fix
-- (CURVE_BONDING_SURFACE_BPS 100 -> 5000) having gone live in production
-- (confirmed live 2026-07-26 05:24:32 UTC).
--
-- lifecycle_state is monotonic by design (resolveUpdate's LIFECYCLE_RANK
-- never regresses GRADUATED/SURFACED back to CANDIDATE on the normal merge
-- path) — that is correct for a real demotion decision, but it also means a
-- row that was WRONGLY surfaced by a bug can never self-correct through
-- ordinary polling. Two such backlogs exist, both predating tonight's fixes:
--
--   * BONDING_CURVE rows surfaced under the old 100bps bar (or the
--     pre-rebuild code's unconditional-SURFACED-at-creation bug) that never
--     cleared the real 5000bps bar. Verified 2026-07-26: 93 of 101 currently
--     SURFACED bonding rows have progress_bps < 5000.
--   * DEX_RESTRICTED (pons) rows surfaced unconditionally at creation before
--     the §5.1b fake-bond traction gate existed — the "43,908-row pons
--     flood." Verified 2026-07-26: 21,221 rows still SURFACED without ever
--     clearing TRACKER_THRESHOLDS (liquidity_usd >= 5000 OR
--     volume_24h_usd >= 10000).
--
-- Demotes both backlogs to CANDIDATE in one statement, using the same
-- bypass demoteLaunchCandidate uses (a raw UPDATE, not the monotonic merge).
-- GRADUATED rows are untouched — this only ever matches lifecycle_state =
-- 'SURFACED'. Not destructive: rows stay in launch_candidates and are free
-- to re-surface the moment real activity clears the bar again.
update public.launch_candidates
set lifecycle_state = 'CANDIDATE', updated_at = now()
where lifecycle_state = 'SURFACED'
  and (
    (venue_model = 'BONDING_CURVE' and progress_bps < 5000)
    or (
      venue_model = 'DEX_RESTRICTED'
      and coalesce(liquidity_usd, 0) < 5000
      and coalesce(volume_24h_usd, 0) < 10000
    )
  );
