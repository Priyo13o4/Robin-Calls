-- robin.fun's own domain moved to robinfun.live; the launchpads.name column is
-- a display label only (config carries the real URLs — see 0016), but it was
-- still showing the stale domain in the admin UI and generated verdict copy.
update public.launchpads
set name = 'robinfun.live'
where slug = 'robinfun' and name = 'robin.fun';
