-- ── flap.sh + pons per-token deep links ──
-- 0016 added tokenUrlTemplate for robinfun/hoodfun only; flapsh and pons kept
-- only `website` (their homepage — see 0026), so WatchlistTabs' launchpadUrl()
-- fell back to the launchpad homepage for every flap/pons card instead of the
-- token's own page. Verified live 2026-07-22:
--   flap.sh  — chain-scoped route [chain]/[coin]; Robinhood Chain's chain
--              slug is "robinhood" (confirmed via the site's own chain
--              switcher + a live Robinhood-chain token click-through).
--   pons     — /launchpad/{address}, address accepted lowercase (confirmed
--              by loading a real launchpad token page with a lowercased hash).

update public.launchpads
set config = config || jsonb_build_object(
  'tokenUrlTemplate', 'https://flap.sh/robinhood/{token}'
)
where slug = 'flapsh';

update public.launchpads
set config = config || jsonb_build_object(
  'tokenUrlTemplate', 'https://www.ponsfamily.com/launchpad/{token}'
)
where slug = 'pons';
