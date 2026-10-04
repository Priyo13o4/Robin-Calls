-- Optional submitter-declared banner image, first-class (not category_details
-- jsonb) because it applies to every category alike, same as `url`/`contact`.
--
-- Still routed through the SAME live-probe as the auto-discovered candidates
-- (app/api/og-proxy/route.ts) rather than trusted blindly: a declared URL
-- that starts 404ing later degrades to the normal og:image/icon scrape of
-- the platform's own site, not a broken image forever.

alter table public.directory_platforms
  add column if not exists banner_url text;
