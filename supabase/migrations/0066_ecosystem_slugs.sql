-- /directory/3 becomes /ecosystem/flap-sh.
--
-- A numeric id is a database detail leaking into a URL. It carries no keyword,
-- so the page cannot rank for the platform's own name — which is the entire
-- reason to have per-listing pages: the query "flap.sh robinhood chain" should
-- reach us the way "bitcoin price" reaches CoinGecko before it reaches any
-- exchange's own site.
--
-- The slug is a COLUMN, not something derived from `name` at render time.
-- Deriving it would repoint the URL whenever an admin fixes a typo in a name,
-- silently 404ing every link and inbound citation that had accumulated. A URL
-- is a promise; keep it in a column where changing it has to be deliberate.
--
-- Backfill rule: slugify(name); on collision, append the id. The id suffix only
-- appears where two published platforms genuinely share a name, which is a
-- review problem, not a URL problem.

alter table public.directory_platforms add column if not exists slug text;

update public.directory_platforms p
   set slug = base.candidate
  from (
    select id,
           case
             when count(*) over (partition by s.stem) > 1 then s.stem || '-' || s.id
             else s.stem
           end as candidate
      from (
        select id,
               nullif(
                 trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')),
                 ''
               ) as stem
          from public.directory_platforms
      ) s
     where s.stem is not null
  ) base
 where p.id = base.id
   and p.slug is null;

-- A name that slugifies to nothing (all punctuation, or non-Latin) still needs
-- a URL. `listing-<id>` is ugly and that is fine: it is rare, and an ugly URL
-- that resolves beats a null that 500s the route.
update public.directory_platforms
   set slug = 'listing-' || id
 where slug is null;

alter table public.directory_platforms alter column slug set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'directory_platforms_slug_key') then
    alter table public.directory_platforms
      add constraint directory_platforms_slug_key unique (slug);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'directory_platforms_slug_check') then
    alter table public.directory_platforms
      add constraint directory_platforms_slug_check
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
end $$;

comment on column public.directory_platforms.slug is
  'URL segment for /ecosystem/<slug>. Stable across name edits — changing it breaks every inbound link, so treat it as a rename, not an update.';
