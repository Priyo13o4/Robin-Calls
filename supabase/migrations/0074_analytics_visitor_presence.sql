-- Fix: unique_visitors on analytics_rollups_hourly / analytics_pages_daily /
-- analytics_countries_daily was an additive sum of each 1-minute ingest
-- tick's LOCAL distinct-hash count (lib/data/analytics.ts upsertHourlyRollup
-- / upsertPageDaily / upsertCountryDaily). A real visitor whose session
-- spans 2+ ticks got counted once per tick. These presence tables let the
-- write path ask "has this hash already been counted for this period" so
-- the stored count becomes a true distinct count instead of a running sum.
-- One row per (period, dimension, hash) ever seen; ON CONFLICT DO NOTHING
-- makes re-seeing a hash within a period free — see HANDOFF.md.

create table if not exists public.analytics_visitor_hours (
  bucket_hour timestamptz not null,
  visitor_hash text not null,
  primary key (bucket_hour, visitor_hash)
);

create table if not exists public.analytics_visitor_pages (
  bucket_date date not null,
  normalized_path text not null,
  visitor_hash text not null,
  primary key (bucket_date, normalized_path, visitor_hash)
);

create table if not exists public.analytics_visitor_countries (
  bucket_date date not null,
  country_code text not null,
  visitor_hash text not null,
  primary key (bucket_date, country_code, visitor_hash)
);
