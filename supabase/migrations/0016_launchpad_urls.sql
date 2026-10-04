-- ── Launchpad site URLs (front-end deep links) ──
-- The `name` column is a display label, not a live domain — robin.fun in
-- particular is a parked GoDaddy page. The real launchpad sites and their
-- token-page URL shapes (verified on-chain 2026-07-16) live in `config`:
--   website          — launchpad homepage
--   tokenUrlTemplate — per-token deep link, `{token}` placeholder
-- lib/data/curves.ts reads both; a missing tokenUrlTemplate falls back to the
-- homepage. Values are merged into the existing config (targetParam etc. kept).

update public.launchpads
set config = config || jsonb_build_object(
  'website', 'https://robinfun.live',
  'tokenUrlTemplate', 'https://robinfun.live/token/{token}'
)
where slug = 'robinfun';

update public.launchpads
set config = config || jsonb_build_object(
  'website', 'https://hood.fun',
  'tokenUrlTemplate', 'https://hood.fun/coin/{token}'
)
where slug = 'hoodfun';
